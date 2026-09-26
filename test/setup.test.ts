import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { OPERATOR_ID, startTestBot, type TestBot } from "./harness.ts";

let bot: TestBot;
afterEach(() => bot.close());

const operator = { id: OPERATOR_ID, first_name: "Lena" };

test("the Operator's first /start makes them the first Admin and starts guided setup", async () => {
  bot = await startTestBot();

  await bot.sendPrivateMessage(operator, "/start");

  expect(bot.messagesTo(operator.id)).toEqual([
    "👋 Welcome, Lena! You're the first Admin of this Apartment. Two steps and it's ready.\n\n" +
      "Step 1 of 2: the Rooms. Send me their names, one per line. " +
      "The order you type them in becomes the Room Order, which every Rotation follows. " +
      "You can reorder them before confirming.",
  ]);
});

test("the Operator's first message starts guided setup even when it isn't /start", async () => {
  bot = await startTestBot();

  await bot.sendPrivateMessage(operator, "hello");

  expect(bot.messagesTo(operator.id)).toHaveLength(1);
  expect(bot.lastMessageTo(operator.id).text).toMatch(/^👋 Welcome, Lena! You're the first Admin/);
});

test("typed Room names are listed in typed order, across messages, ready to confirm", async () => {
  bot = await startTestBot();
  await bot.sendPrivateMessage(operator, "/start");

  await bot.sendPrivateMessage(operator, "Room 1\nRoom 2");
  await bot.sendPrivateMessage(operator, "  Attic  ");

  expect(bot.lastMessageTo(operator.id)).toEqual({
    id: expect.any(Number),
    text:
      "Room Order:\n1. Room 1\n2. Room 2\n3. Attic\n\n" +
      "Send more names to add Rooms, or confirm when the order is right.",
    buttons: [["✅ Confirm Room Order"], ["↕️ Reorder", "🗑 Start over"]],
  });
});

test("a Room name already on the list, or too long, is left out and the Admin is told why", async () => {
  bot = await startTestBot();
  await bot.sendPrivateMessage(operator, "/start");
  await bot.sendPrivateMessage(operator, "Room 1");

  await bot.sendPrivateMessage(operator, `room 1\nRoom 2\n${"A".repeat(33)}`);

  expect(bot.lastMessageTo(operator.id).text).toBe(
    "“room 1” is already on the list.\n" +
      `“${"A".repeat(33)}” is too long: Room names have at most 32 characters.\n\n` +
      "Room Order:\n1. Room 1\n2. Room 2\n\n" +
      "Send more names to add Rooms, or confirm when the order is right.",
  );
});

test("starting over clears the typed Rooms", async () => {
  bot = await startTestBot();
  await bot.sendPrivateMessage(operator, "/start");
  await bot.sendPrivateMessage(operator, "Room 1\nRoom 2");

  await bot.tap(operator, "🗑 Start over");
  expect(bot.lastMessageTo(operator.id)).toEqual({
    id: expect.any(Number),
    text: "Cleared. Send me the Room names again, one per line.",
    buttons: [],
  });

  await bot.sendPrivateMessage(operator, "Attic");
  expect(bot.lastMessageTo(operator.id).text).toMatch(/^Room Order:\n1\. Attic\n\n/);
});

test("confirming the Room Order asks the Admin which Room is theirs", async () => {
  bot = await startTestBot();
  await bot.sendPrivateMessage(operator, "/start");
  await bot.sendPrivateMessage(operator, "Room 1\nRoom 2\nAttic");

  await bot.tap(operator, "✅ Confirm Room Order");

  const [, confirmed, ownRoom] = bot.messagesTo(operator.id);
  expect(confirmed).toBe("✅ Room Order confirmed:\n1. Room 1\n2. Room 2\n3. Attic");
  expect(ownRoom).toBe("Step 2 of 2: which Room is yours?");
  expect(bot.lastMessageTo(operator.id).buttons).toEqual([["Room 1"], ["Room 2"], ["Attic"]]);
});

test("the Admin reorders the Rooms by tapping them in their new order before confirming", async () => {
  bot = await startTestBot();
  await bot.sendPrivateMessage(operator, "/start");
  await bot.sendPrivateMessage(operator, "Room 1\nRoom 2\nAttic");

  await bot.tap(operator, "↕️ Reorder");
  expect(bot.lastMessageTo(operator.id)).toEqual({
    id: expect.any(Number),
    text: "Tap the Rooms in their new order.",
    buttons: [["Room 1"], ["Room 2"], ["Attic"], ["↩️ Cancel"]],
  });

  await bot.tap(operator, "Attic");
  expect(bot.lastMessageTo(operator.id)).toEqual({
    id: expect.any(Number),
    text: "Tap the Rooms in their new order.\n1. Attic",
    buttons: [["Room 1"], ["Room 2"], ["↩️ Cancel"]],
  });

  await bot.tap(operator, "Room 1");
  await bot.tap(operator, "Room 2");
  expect(bot.lastMessageTo(operator.id).text).toMatch(/^Room Order:\n1\. Attic\n2\. Room 1\n3\. Room 2\n/);

  await bot.tap(operator, "✅ Confirm Room Order");
  expect(bot.lastMessageTo(operator.id).buttons).toEqual([["Attic"], ["Room 1"], ["Room 2"]]);
});

test("cancelling a reorder keeps the typed order", async () => {
  bot = await startTestBot();
  await bot.sendPrivateMessage(operator, "/start");
  await bot.sendPrivateMessage(operator, "Room 1\nRoom 2");

  await bot.tap(operator, "↕️ Reorder");
  await bot.tap(operator, "Room 2");
  await bot.tap(operator, "↩️ Cancel");

  expect(bot.lastMessageTo(operator.id).text).toMatch(/^Room Order:\n1\. Room 1\n2\. Room 2\n/);
});

test("picking their own Room makes the Admin a Resident from today in the Apartment time zone", async () => {
  // 23:30 in UTC is already 26 September in Berlin.
  bot = await startTestBot({ now: new Date("2026-09-25T23:30:00Z") });
  await confirmRooms("Room 1\nRoom 2\nAttic");

  await bot.tap(operator, "Room 2");

  expect(bot.messagesTo(operator.id)).toContain("✅ You live in Room 2, from today, 26 Sep 2026.");
  expect(bot.keyboardOf(operator.id)).toEqual([
    ["🛒 Shopping list", "⚠️ Something ran out"],
    ["📷 Scan", "➕ Add item"],
  ]);
});

test("after setup, linking the Apartment Group and creating Invites are offered as optional", async () => {
  bot = await startTestBot();
  await confirmRooms("Room 1\nRoom 2");
  await bot.tap(operator, "Room 1");

  expect(bot.lastMessageTo(operator.id)).toEqual({
    id: expect.any(Number),
    text:
      "Two more steps are optional. Do them now or whenever you like:\n" +
      "• Link the Apartment Group, so everyone hears when something runs out.\n" +
      "• Create Invites, so the other Residents can join their Rooms.",
    buttons: [["👥 Link the Apartment Group"], ["✉️ Create an Invite"], ["⏭ Skip for now"]],
  });

  await bot.tap(operator, "⏭ Skip for now");

  expect(bot.lastMessageTo(operator.id)).toEqual({
    id: expect.any(Number),
    text: "Skipped. You can link the Apartment Group and create Invites later.",
    buttons: [],
  });
});

test("the optional Link the Apartment Group step explains how to link it", async () => {
  bot = await startTestBot();
  await confirmRooms("Room 1");
  await bot.tap(operator, "Room 1");

  await bot.tap(operator, "👥 Link the Apartment Group");

  expect(bot.lastMessageTo(operator.id).text).toMatch(
    /^👥 No Apartment Group is linked yet\. To link it, add me to the group: open it, tap Add members/,
  );
});

test("the optional Create an Invite step starts creating an Invite", async () => {
  bot = await startTestBot();
  await confirmRooms("Room 1\nRoom 2");
  await bot.tap(operator, "Room 1");

  await bot.tap(operator, "✉️ Create an Invite");

  expect(bot.lastMessageTo(operator.id)).toEqual({
    id: expect.any(Number),
    text: "Which Room is the Invite for?",
    buttons: [["Room 1"], ["Room 2"], ["↩️ Cancel"]],
  });
});

test("mid-setup, /start shows the Rooms typed so far, even after the bot restarts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rooms76-"));
  try {
    const databasePath = join(dir, "rooms76.sqlite");
    bot = await startTestBot({ databasePath });
    await bot.sendPrivateMessage(operator, "/start");
    await bot.sendPrivateMessage(operator, "Room 1\nRoom 2");
    bot.close();

    bot = await startTestBot({ databasePath });
    await bot.sendPrivateMessage(operator, "/start");

    const [welcome, draft] = bot.messagesTo(operator.id);
    expect(welcome).toMatch(/^👋 Welcome, Lena!/);
    expect(draft).toMatch(/^Room Order:\n1\. Room 1\n2\. Room 2\n/);
    expect(bot.lastMessageTo(operator.id).buttons).toEqual([["✅ Confirm Room Order"], ["↕️ Reorder", "🗑 Start over"]]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a Rooms button tapped twice, or left over from an older message, only says it's out of date", async () => {
  bot = await startTestBot();
  await bot.sendPrivateMessage(operator, "/start");
  await bot.sendPrivateMessage(operator, "Room 1\nRoom 2");
  await bot.sendPrivateMessage(operator, "Attic"); // a newer draft message
  const messageCount = bot.messagesTo(operator.id).length;

  await bot.tap(operator, "🗑 Start over"); // on the newer draft
  await bot.tap(operator, "🗑 Start over"); // on the older draft
  await bot.tap(operator, "✅ Confirm Room Order"); // on the older draft, with nothing to confirm

  expect(bot.toastsTo(operator.id)).toEqual(["This button is out of date.", "This button is out of date."]);
  expect(bot.messagesTo(operator.id)).toHaveLength(messageCount);
});

test("a second tap on Confirm Room Order doesn't ask for the own Room twice", async () => {
  bot = await startTestBot();
  await bot.sendPrivateMessage(operator, "/start");
  await bot.sendPrivateMessage(operator, "Room 1");
  await bot.sendPrivateMessage(operator, "Room 2"); // two draft messages, both with Confirm
  await bot.tap(operator, "✅ Confirm Room Order");

  await bot.tap(operator, "✅ Confirm Room Order");

  expect(bot.messagesTo(operator.id).filter((text) => text.includes("which Room is yours?"))).toHaveLength(1);
  expect(bot.toastsTo(operator.id)).toEqual(["This button is out of date."]);
});

test("until the Admin has picked their own Room, anything else steers them back to it", async () => {
  bot = await startTestBot();
  await confirmRooms("Room 1\nRoom 2");

  for (const text of ["/start", "🛒 Shopping list", "hello"]) {
    await bot.sendPrivateMessage(operator, text);
    expect(bot.lastMessageTo(operator.id)).toEqual({
      id: expect.any(Number),
      text: "Setup isn't finished yet.\n\nStep 2 of 2: which Room is yours?",
      buttons: [["Room 1"], ["Room 2"]],
    });
  }
  expect(bot.keyboardOf(operator.id)).toBeUndefined();
});

test("only the Operator can set up the Apartment", async () => {
  bot = await startTestBot();
  const stranger = { id: 4242, first_name: "Mallory" };

  await bot.sendPrivateMessage(stranger, "/start");

  expect(bot.messagesTo(stranger.id)).toEqual([
    "Hi Mallory! This bot is only for the Residents of this apartment. To join, ask an Admin for an Invite link.",
  ]);
});

test("setup buttons tapped after setup is done only say so", async () => {
  bot = await startTestBot();
  await confirmRooms("Room 1\nRoom 2");
  await bot.sendPrivateMessage(operator, "hello"); // steered back: a second picker
  await bot.tap(operator, "Room 1");

  await bot.tap(operator, "Room 2"); // on the first picker

  expect(bot.toastsTo(operator.id)).toEqual(["Setup is already done."]);
  expect(bot.messagesTo(operator.id)).toContain("✅ You live in Room 1, from today, 25 Sep 2026.");
});

async function confirmRooms(names: string): Promise<void> {
  await bot.sendPrivateMessage(operator, "/start");
  await bot.sendPrivateMessage(operator, names);
  await bot.tap(operator, "✅ Confirm Room Order");
}
