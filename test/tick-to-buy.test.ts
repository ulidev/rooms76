import { afterEach, expect, test } from "vitest";
import { OPERATOR_ID, startTestBot, type TelegramUser, type TestBot } from "./harness.ts";

let bot: TestBot;
afterEach(() => bot.close());

const lena = { id: OPERATOR_ID, first_name: "Lena" };
const ana = { id: 2002, first_name: "Ana" };
const tomas = { id: 2003, first_name: "Tomás" };
const group = { id: -4001, title: "Flat 76" };

/**
 * A fresh Apartment with Room Order Room A→B→C and a linked Apartment Group, set up by
 * Lena, the Operator and only Admin, who lives in Room A. Ana lives in Room B and Tomás in Room C.
 */
async function threeOccupiedRooms(): Promise<void> {
  bot = await startTestBot();
  await bot.sendPrivateMessage(lena, "/start");
  await bot.sendPrivateMessage(lena, "Room A\nRoom B\nRoom C");
  await bot.tap(lena, "✅ Confirm Room Order");
  await bot.tap(lena, "Room A");
  await bot.addBotToGroup(lena, group);
  await join(ana, "Room B");
  await join(tomas, "Room C");
}

/** Lena invites this person to a Room and they open the Invite, moving in today. */
async function join(person: TelegramUser, room: string): Promise<void> {
  await bot.sendPrivateMessage(lena, "/invites");
  await bot.tap(lena, "✉️ New Invite");
  await bot.tap(lena, room);
  await bot.tap(lena, bot.lastMessageTo(lena.id).buttons.flat().find((text) => text.startsWith("Today, "))!);
  const token = bot.lastMessageTo(lena.id).text.match(/\?start=(\S+)$/)![1];
  await bot.sendPrivateMessage(person, `/start ${token}`);
}

/** Adds a Common Item through ➕ Add item, skipping the rough guess. */
async function addItem(person: TelegramUser, name: string): Promise<void> {
  await bot.sendPrivateMessage(person, "➕ Add item");
  await bot.sendPrivateMessage(person, name);
  await bot.tap(person, "Skip");
}

/**
 * Coffee and Milk, bought once by Lena, so it's Room B's Turn for both; Coffee ran out.
 * Tea was bought by Ana, so it's Room C's Turn. Nobody has bought Bin bags yet.
 */
async function anaGoesShopping(): Promise<void> {
  await threeOccupiedRooms();
  for (const item of ["Coffee", "Milk", "Tea", "Bin bags"]) await addItem(lena, item);
  await bot.sendPrivateMessage(lena, "bought coffee");
  await bot.sendPrivateMessage(lena, "bought milk");
  await bot.sendPrivateMessage(ana, "bought tea");
  await bot.sendPrivateMessage(tomas, "coffee ran out");
}

/** Opens this Resident's shopping list. */
async function openShoppingList(person: TelegramUser): Promise<void> {
  await bot.sendPrivateMessage(person, "🛒 Shopping list");
}

test("the shopping list has a box to tick for each line", async () => {
  await anaGoesShopping();

  await openShoppingList(ana);

  expect(bot.lastMessageTo(ana.id)).toEqual({
    id: expect.any(Number),
    text: "🛒 Shopping list\n\nYour Turn\n☐ Coffee · ran out\n\nYour Turn later: Milk (no estimate yet)",
    buttons: [["☐ Coffee"], ["➕ Something else…"], ["✔️ Done shopping"]],
  });
});

test("ticking a line records a Purchase, edits the list in place and tells whoever should hear", async () => {
  await anaGoesShopping();
  await openShoppingList(ana);
  const list = bot.lastMessageTo(ana.id);
  const tomasBefore = bot.messagesTo(tomas.id).length;

  await bot.tap(ana, "☐ Coffee");

  expect(bot.lastMessageTo(ana.id)).toEqual({
    id: list.id,
    text: "🛒 Shopping list\n\nYour Turn\n☑ Coffee\n\nYour Turn later: Milk (no estimate yet)",
    buttons: [["☑ Coffee"], ["➕ Something else…"], ["✔️ Done shopping"]],
  });
  expect(bot.toastsTo(ana.id)).toEqual([
    "✅ Recorded: you bought Coffee.\nThe Run Out is cleared.\nNext Turn: Room C (Tomás).",
  ]);
  expect(bot.lastMessageTo(group.id).text).toBe("✅ Coffee bought by Ana.");
  expect(bot.messagesTo(tomas.id).slice(tomasBefore)).toEqual(["🔁 Ana bought Coffee. It's now your Turn for it."]);

  // The Purchase counts like any other: it's Tomás's Turn now.
  await bot.sendPrivateMessage(lena, "coffee");
  expect(bot.lastMessageTo(lena.id).text).toBe("Coffee\nTurn: Room C (Tomás).");
});

test("unticking a line undoes its Purchase", async () => {
  await anaGoesShopping();
  await openShoppingList(ana);
  const list = bot.lastMessageTo(ana.id);
  await bot.tap(ana, "☐ Coffee");

  await bot.tap(ana, "☑ Coffee");

  expect(bot.lastMessageTo(ana.id)).toEqual({
    id: list.id,
    text: "🛒 Shopping list\n\nYour Turn\n☐ Coffee · ran out\n\nYour Turn later: Milk (no estimate yet)",
    buttons: [["☐ Coffee"], ["➕ Something else…"], ["✔️ Done shopping"]],
  });
  expect(bot.toastsTo(ana.id).at(-1)).toBe(
    "↩️ Undone: your Purchase of Coffee no longer counts.\nCoffee is Run Out again.\nTurn: your Room.",
  );
  expect(bot.lastMessageTo(group.id).text).toBe("⚠️ Coffee is out again — Ana undid their Purchase.");
  await bot.sendPrivateMessage(lena, "coffee");
  expect(bot.lastMessageTo(lena.id).text).toBe("Coffee\nTurn: Room B (Ana).");
});

test("➕ Something else… shows every other Common Item with whose Turn it is, to tick any of them", async () => {
  await anaGoesShopping();
  await openShoppingList(ana);
  const list = bot.lastMessageTo(ana.id);

  await bot.tap(ana, "➕ Something else…");

  expect(bot.lastMessageTo(ana.id)).toEqual({
    id: list.id,
    text: [
      "🛒 Shopping list",
      "",
      "Your Turn",
      "☐ Coffee · ran out",
      "",
      "Something else",
      "☐ Bin bags · no Turn yet",
      "☐ Milk · Turn: your Room",
      "☐ Tea · Turn: Room C (Tomás)",
    ].join("\n"),
    buttons: [["☐ Coffee", "☐ Bin bags"], ["☐ Milk", "☐ Tea"], ["✔️ Done shopping"]],
  });

  await bot.tap(ana, "☐ Bin bags");
  expect(bot.lastMessageTo(ana.id).text).toContain("☑ Bin bags\n");
  expect(bot.toastsTo(ana.id)).toEqual([
    "✅ Recorded: you bought Bin bags.\nYou're the first to buy it, so Room B starts its Rotation.\nNext Turn: Room C (Tomás).",
  ]);
});

test("with nothing to buy, ➕ Something else… still lets a Resident tick anything", async () => {
  await threeOccupiedRooms();
  await addItem(lena, "Bin bags");
  await openShoppingList(ana);
  expect(bot.lastMessageTo(ana.id)).toEqual({
    id: expect.any(Number),
    text: "🛒 Nothing to buy right now.",
    buttons: [["➕ Something else…"], ["✔️ Done shopping"]],
  });

  await bot.tap(ana, "➕ Something else…");
  expect(bot.lastMessageTo(ana.id).text).toBe("🛒 Shopping list\n\nSomething else\n☐ Bin bags · no Turn yet");
});

test("✔️ Done shopping closes the list with a count of what was bought", async () => {
  await anaGoesShopping();
  await openShoppingList(ana);
  const list = bot.lastMessageTo(ana.id);
  await bot.tap(ana, "☐ Coffee");
  await bot.tap(ana, "➕ Something else…");
  await bot.tap(ana, "☐ Milk");
  await bot.tap(ana, "☐ Tea");
  await bot.tap(ana, "☑ Tea");

  await bot.tap(ana, "✔️ Done shopping");

  expect(bot.lastMessageTo(ana.id)).toEqual({
    id: list.id,
    text: [
      "🛒 Shopping list",
      "",
      "Your Turn",
      "☑ Coffee",
      "",
      "Something else",
      "☐ Bin bags · no Turn yet",
      "☑ Milk",
      "☐ Tea · Turn: Room C (Tomás)",
      "",
      "✔️ Done shopping: 2 Purchases recorded.",
    ].join("\n"),
    buttons: [],
  });
});

test("✔️ Done shopping without ticking anything says nothing was bought", async () => {
  await anaGoesShopping();
  await openShoppingList(ana);

  await bot.tap(ana, "✔️ Done shopping");

  expect(bot.lastMessageTo(ana.id).text).toBe(
    "🛒 Shopping list\n\nYour Turn\n☐ Coffee · ran out\n\nYour Turn later: Milk (no estimate yet)\n\n✔️ Done shopping: nothing bought.",
  );
});

test("opening a new shopping list puts the previous one out of date", async () => {
  await anaGoesShopping();
  await openShoppingList(ana);
  const old = bot.lastMessageTo(ana.id);
  await openShoppingList(ana);
  const tickOld = bot.calls.length;

  // The harness taps the newest message with a button, so close the new list first.
  await bot.tap(ana, "✔️ Done shopping");
  await bot.tap(ana, "☐ Coffee");

  expect(bot.toastsTo(ana.id)).toEqual(["This button is out of date."]);
  expect(bot.lastMessageTo(ana.id).text).toContain("✔️ Done shopping: nothing bought.");
  expect(bot.calls.slice(tickOld).some((call) => call.payload.message_id === old.id)).toBe(false);
});

test("a line whose Purchase can no longer be undone stays ticked", async () => {
  await anaGoesShopping();
  await openShoppingList(ana);
  await bot.tap(ana, "☐ Coffee");
  await bot.sendPrivateMessage(ana, "bought coffee");

  await bot.tap(ana, "☑ Coffee");

  expect(bot.toastsTo(ana.id).at(-1)).toBe("That Purchase is no longer your last of Coffee, so it can't be unticked.");
  expect(bot.lastMessageTo(ana.id).text).not.toContain("☐ Coffee");
});

test("a shopping list survives other flows in between", async () => {
  await anaGoesShopping();
  await openShoppingList(ana);
  await bot.sendPrivateMessage(ana, "➕ Add item");
  await bot.sendPrivateMessage(ana, "/start");

  await bot.tap(ana, "☐ Coffee");

  expect(bot.toastsTo(ana.id)[0]).toMatch(/^✅ Recorded: you bought Coffee\./);
});

test("a shopping list is out of date after one shopping trip", async () => {
  await anaGoesShopping();
  bot.setNow(new Date("2026-09-25T10:00:00Z"));
  await openShoppingList(ana);

  bot.setNow(new Date("2026-09-25T21:59:00Z"));
  await bot.tap(ana, "➕ Something else…");
  bot.setNow(new Date("2026-09-25T22:00:00Z"));
  await bot.tap(ana, "☐ Coffee");

  expect(bot.toastsTo(ana.id)).toEqual(["This button is out of date."]);
  await bot.sendPrivateMessage(lena, "coffee");
  expect(bot.lastMessageTo(lena.id).text).toBe("Coffee\nTurn: Room B (Ana).");
});

test("a line whose Purchase was voided since is unticked, and isn't counted", async () => {
  await anaGoesShopping();
  await openShoppingList(ana);
  await bot.tap(ana, "☐ Coffee");
  await bot.sendPrivateMessage(lena, "coffee");
  await bot.tap(lena, "⋯ More");
  await bot.tap(lena, "🗑 Void a Purchase");
  await bot.tap(lena, bot.lastMessageTo(lena.id).buttons.flat().find((text) => text.includes("Ana"))!);
  await bot.tap(lena, "Yes, void it");

  await bot.tap(ana, "✔️ Done shopping");

  expect(bot.lastMessageTo(ana.id).text).toBe(
    "🛒 Shopping list\n\nYour Turn\n☐ Coffee · ran out\n\nYour Turn later: Milk (no estimate yet)\n\n✔️ Done shopping: nothing bought.",
  );
});
