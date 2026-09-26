import { afterEach, expect, test } from "vitest";
import { OPERATOR_ID, startTestBot, type TelegramUser, type TestBot } from "./harness.ts";

let bot: TestBot;
afterEach(() => bot.close());

const lena = { id: OPERATOR_ID, first_name: "Lena" };
const ana = { id: 2002, first_name: "Ana" };
const tomas = { id: 2003, first_name: "Tomás" };
const aiko = { id: 2004, first_name: "Aiko" };
const group = { id: -4001, title: "Flat 76" };

const LINKED =
  "📌 This is now the Apartment Group. I'll post here only when something runs out, and when it's bought. " +
  "Everything else happens in your private chat with me.";

/**
 * A fresh Apartment with Room Order Room A→B→C, set up by Lena, the Operator and only
 * Admin, who lives in Room A. Ana lives in Room B and Tomás in Room C. Unless told
 * otherwise, Lena links the Apartment Group.
 */
async function threeOccupiedRooms({ linkGroup = true } = {}): Promise<void> {
  bot = await startTestBot();
  await bot.sendPrivateMessage(lena, "/start");
  await bot.sendPrivateMessage(lena, "Room A\nRoom B\nRoom C");
  await bot.tap(lena, "✅ Confirm Room Order");
  await bot.tap(lena, "Room A");
  if (linkGroup) await bot.addBotToGroup(lena, group);
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

/** Coffee, bought once by Lena: Room A is the Rotation Start and it's Room B's Turn. */
async function coffeeOnRoomBsTurn(): Promise<void> {
  await addItem(lena, "Coffee");
  await bot.sendPrivateMessage(lena, "bought coffee");
}

/** The chats that received a message or an edit since this many Bot API calls. */
function recipientsSince(callCount: number): Set<unknown> {
  return new Set(
    bot.calls
      .slice(callCount)
      .filter((call) => call.method === "sendMessage" || call.method === "editMessageText")
      .map((call) => call.payload.chat_id),
  );
}

test("⚠️ Something ran out lists the Common Items, and reporting one tells the group and the Turn Room", async () => {
  await threeOccupiedRooms();
  await coffeeOnRoomBsTurn();
  await addItem(lena, "Bin bags");
  const before = bot.calls.length;

  await bot.sendPrivateMessage(tomas, "⚠️ Something ran out");
  expect(bot.lastMessageTo(tomas.id)).toEqual({
    id: expect.any(Number),
    text: "⚠️ What ran out?",
    buttons: [["Bin bags"], ["Coffee"]],
  });

  await bot.tap(tomas, "Coffee");
  expect(bot.lastMessageTo(tomas.id)).toEqual({
    id: expect.any(Number),
    text: "⚠️ Reported: Coffee ran out.\nTurn: Room B (Ana).",
    buttons: [["↩️ Retract"]],
  });
  expect(bot.messagesTo(group.id)).toEqual([LINKED, "⚠️ Coffee ran out.\nTurn: Room B (Ana)."]);
  expect(bot.lastMessageTo(ana.id)).toEqual({
    id: expect.any(Number),
    text: "⚠️ Tomás reported that Coffee ran out. It's your Turn to buy it.",
    buttons: [["✅ I bought it"]],
  });
  expect(recipientsSince(before)).toEqual(new Set([tomas.id, group.id, ana.id]));
});

test("a Run Out reported through free text, before anyone has bought the Common Item, is for anyone to buy", async () => {
  await threeOccupiedRooms();
  await addItem(lena, "Dish soap");
  const before = bot.calls.length;

  await bot.sendPrivateMessage(ana, "dish soap ran out");

  expect(bot.lastMessageTo(ana.id)).toEqual({
    id: expect.any(Number),
    text: "⚠️ Reported: Dish soap ran out.\nNo Turn yet: nobody has bought it, so anyone can.",
    buttons: [["✅ I bought it"], ["↩️ Retract"]],
  });
  expect(bot.messagesTo(group.id)).toEqual([LINKED, "⚠️ Dish soap ran out.\nNo Turn yet — anyone can buy it."]);
  expect(recipientsSince(before)).toEqual(new Set([ana.id, group.id]));
});

test("a Resident reporting a Run Out on their own Room's Turn isn't alerted, but their roommate is", async () => {
  await threeOccupiedRooms();
  await join(aiko, "Room B");
  await coffeeOnRoomBsTurn();

  await bot.sendPrivateMessage(ana, "we're out of coffee");

  expect(bot.lastMessageTo(ana.id)).toEqual({
    id: expect.any(Number),
    text: "⚠️ Reported: Coffee ran out.\nTurn: your Room.",
    buttons: [["✅ I bought it"], ["↩️ Retract"]],
  });
  expect(bot.messagesTo(group.id).at(-1)).toBe("⚠️ Coffee ran out.\nTurn: Room B (Ana, Aiko).");
  expect(bot.lastMessageTo(aiko.id).text).toBe("⚠️ Ana reported that Coffee ran out. It's your Turn to buy it.");
  expect(bot.messagesTo(ana.id).filter((text) => text.includes("reported that"))).toEqual([]);
});

test("✅ I bought it on the alert records a Purchase, which clears the Run Out and tells the group", async () => {
  await threeOccupiedRooms();
  await coffeeOnRoomBsTurn();
  await bot.sendPrivateMessage(tomas, "coffee ran out");
  const before = bot.calls.length;

  await bot.tap(ana, "✅ I bought it");

  expect(recipientsSince(before)).toEqual(new Set([ana.id, group.id, tomas.id]));
  expect(bot.lastMessageTo(ana.id)).toEqual({
    id: expect.any(Number),
    text: "✅ Recorded: you bought Coffee.\nThe Run Out is cleared.\nNext Turn: Room C (Tomás).",
    buttons: [],
  });
  expect(bot.messagesTo(group.id).at(-1)).toBe("✅ Coffee bought by Ana.");
  expect(bot.lastMessageTo(tomas.id).text).toBe("🔁 Ana bought Coffee. It's now your Turn for it.");
});

test("any Purchase clears the Run Out, even out of turn, and the Common Item can run out again", async () => {
  await threeOccupiedRooms();
  await coffeeOnRoomBsTurn();
  await bot.sendPrivateMessage(tomas, "coffee ran out");

  await bot.sendPrivateMessage(lena, "bought coffee");
  expect(bot.lastMessageTo(lena.id).text).toBe(
    "✅ Recorded: you bought Coffee.\n" +
      "The Run Out is cleared.\n" +
      "That was out of turn: Room B (Ana) still holds the Turn, so Room A will be skipped later.",
  );
  expect(bot.messagesTo(group.id).at(-1)).toBe("✅ Coffee bought by Lena.");

  await bot.sendPrivateMessage(tomas, "coffee ran out");
  expect(bot.lastMessageTo(tomas.id).text).toBe("⚠️ Reported: Coffee ran out.\nTurn: Room B (Ana).");
  expect(bot.messagesTo(group.id).at(-1)).toBe("⚠️ Coffee ran out.\nTurn: Room B (Ana).");
});

test("a Common Item already reported as Run Out isn't reported twice; its reporter and Admins may retract it", async () => {
  await threeOccupiedRooms();
  await coffeeOnRoomBsTurn();
  await bot.sendPrivateMessage(tomas, "coffee ran out");
  const before = bot.calls.length;

  await bot.sendPrivateMessage(ana, "coffee ran out");
  expect(bot.lastMessageTo(ana.id)).toEqual({
    id: expect.any(Number),
    text: "⚠️ Coffee is already reported as Run Out, by Tomás.",
    buttons: [],
  });
  await bot.sendPrivateMessage(tomas, "coffee ran out");
  expect(bot.lastMessageTo(tomas.id)).toEqual({
    id: expect.any(Number),
    text: "⚠️ Coffee is already reported as Run Out, by you.",
    buttons: [["↩️ Retract"]],
  });
  await bot.sendPrivateMessage(lena, "coffee ran out");
  expect(bot.lastMessageTo(lena.id).buttons).toEqual([["↩️ Retract"]]);
  expect(recipientsSince(before)).toEqual(new Set([ana.id, tomas.id, lena.id]));
});

test("⚠️ Something ran out leaves out what already ran out and what's archived", async () => {
  await threeOccupiedRooms();
  await addItem(lena, "Coffee");
  await addItem(lena, "Bin bags");
  await addItem(lena, "Dish soap");
  await bot.sendPrivateMessage(lena, "coffee ran out");
  await bot.sendPrivateMessage(lena, "dish soap");
  await bot.tap(lena, "⋯ More");
  await bot.tap(lena, "🗄 Archive");
  await bot.tap(lena, "Yes, archive it");

  await bot.sendPrivateMessage(ana, "⚠️ Something ran out");
  expect(bot.lastMessageTo(ana.id).buttons).toEqual([["Bin bags"]]);

  await bot.sendPrivateMessage(ana, "bin bags ran out");
  await bot.sendPrivateMessage(ana, "⚠️ Something ran out");
  expect(bot.lastMessageTo(ana.id)).toEqual({
    id: expect.any(Number),
    text: "⚠️ Everything is already reported as Run Out. To report something new, tap ➕ Add item first.",
    buttons: [],
  });

  await bot.sendPrivateMessage(ana, "dish soap ran out");
  expect(bot.lastMessageTo(ana.id).text).toBe("🗄 Dish soap is archived. Ask an Admin to restore it.");
});

test("⚠️ Something ran out with no Common Items yet points to ➕ Add item", async () => {
  await threeOccupiedRooms();

  await bot.sendPrivateMessage(ana, "⚠️ Something ran out");

  expect(bot.lastMessageTo(ana.id).text).toBe(
    "⚠️ There are no Common Items yet. To report something, tap ➕ Add item first.",
  );
});

test("a Run Out of something that isn't a Common Item is pointed to ⚠️ Something ran out and ➕ Add item", async () => {
  await threeOccupiedRooms();

  await bot.sendPrivateMessage(ana, "oat milk ran out");

  expect(bot.lastMessageTo(ana.id)).toEqual({
    id: expect.any(Number),
    text: "I don't know what ran out in “oat milk ran out”. Tap ⚠️ Something ran out to pick it, or ➕ Add item to add it.",
    buttons: [],
  });
  expect(bot.messagesTo(group.id)).toEqual([LINKED]);
});

test("a picked Common Item reported by someone else meanwhile isn't reported twice", async () => {
  await threeOccupiedRooms();
  await addItem(lena, "Coffee");
  await bot.sendPrivateMessage(ana, "⚠️ Something ran out");
  await bot.sendPrivateMessage(tomas, "coffee ran out");

  await bot.tap(ana, "Coffee");

  expect(bot.lastMessageTo(ana.id).text).toBe("⚠️ Coffee is already reported as Run Out, by Tomás.");
  expect(bot.messagesTo(group.id).filter((text) => text.startsWith("⚠️ Coffee ran out"))).toHaveLength(1);
});

test("the reporter retracts a Run Out, and the group hears it hasn't run out after all", async () => {
  await threeOccupiedRooms();
  await coffeeOnRoomBsTurn();
  await bot.sendPrivateMessage(tomas, "coffee ran out");
  const before = bot.calls.length;

  await bot.tap(tomas, "↩️ Retract");

  expect(recipientsSince(before)).toEqual(new Set([tomas.id, group.id]));
  expect(bot.lastMessageTo(tomas.id)).toEqual({
    id: expect.any(Number),
    text: "↩️ Retracted the Run Out of Coffee.",
    buttons: [],
  });
  expect(bot.messagesTo(group.id).at(-1)).toBe("↩️ Coffee hasn't run out after all — retracted by Tomás.");

  await bot.sendPrivateMessage(ana, "coffee ran out");
  expect(bot.lastMessageTo(ana.id).text).toBe("⚠️ Reported: Coffee ran out.\nTurn: your Room.");
});

test("an Admin retracts someone else's Run Out", async () => {
  await threeOccupiedRooms();
  await coffeeOnRoomBsTurn();
  await bot.sendPrivateMessage(tomas, "coffee ran out");

  await bot.sendPrivateMessage(lena, "coffee ran out");
  const before = bot.calls.length;
  await bot.tap(lena, "↩️ Retract");

  expect(recipientsSince(before)).toEqual(new Set([lena.id, group.id]));
  expect(bot.lastMessageTo(lena.id).text).toBe("↩️ Retracted the Run Out of Coffee.");
  expect(bot.messagesTo(group.id).at(-1)).toBe("↩️ Coffee hasn't run out after all — retracted by Lena.");
});

test("a Retract button is out of date once the Run Out is cleared", async () => {
  await threeOccupiedRooms();
  await coffeeOnRoomBsTurn();
  await bot.sendPrivateMessage(tomas, "coffee ran out");
  await bot.sendPrivateMessage(ana, "bought coffee");

  await bot.tap(tomas, "↩️ Retract");

  expect(bot.toastsTo(tomas.id)).toEqual(["This button is out of date."]);
  expect(bot.messagesTo(group.id).at(-1)).toBe("✅ Coffee bought by Ana.");
});

/** Tomás reports that Coffee ran out, and Ana buys it on her Turn, which clears the Run Out. */
async function runOutClearedByAna(): Promise<void> {
  await coffeeOnRoomBsTurn();
  await bot.sendPrivateMessage(tomas, "coffee ran out");
  await bot.tap(ana, "✅ I bought it");
}

test("undoing the Purchase that cleared a Run Out reopens it, and the group hears it's out again", async () => {
  await threeOccupiedRooms();
  await runOutClearedByAna();
  await bot.sendPrivateMessage(ana, "coffee");
  await bot.tap(ana, "⋯ More");
  await bot.tap(ana, "↩️ Undo my last Purchase");
  const before = bot.calls.length;

  await bot.tap(ana, "Yes, undo it");

  expect(recipientsSince(before)).toEqual(new Set([ana.id, group.id]));
  expect(bot.lastMessageTo(ana.id).text).toBe(
    "↩️ Undone: your Purchase of Coffee no longer counts.\nCoffee is Run Out again.\nTurn: your Room.",
  );
  expect(bot.messagesTo(group.id).at(-1)).toBe("⚠️ Coffee is out again — Ana undid their Purchase.");
  await bot.sendPrivateMessage(lena, "coffee ran out");
  expect(bot.lastMessageTo(lena.id).text).toBe("⚠️ Coffee is already reported as Run Out, by Tomás.");
});

test("voiding the Purchase that cleared a Run Out reopens it too", async () => {
  await threeOccupiedRooms();
  await runOutClearedByAna();

  await bot.sendPrivateMessage(lena, "coffee");
  await bot.tap(lena, "⋯ More");
  await bot.tap(lena, "🗑 Void a Purchase");
  await bot.tap(lena, bot.lastMessageTo(lena.id).buttons[0]![0]!); // Ana's, the newest
  const before = bot.calls.length;
  await bot.tap(lena, "Yes, void it");

  expect(recipientsSince(before)).toEqual(new Set([lena.id, group.id]));
  expect(bot.lastMessageTo(lena.id).text).toBe(
    "🗑 Voided: Ana's Purchase of Coffee no longer counts.\nCoffee is Run Out again.\nTurn: Room B (Ana).",
  );
  expect(bot.messagesTo(group.id).at(-1)).toBe("⚠️ Coffee is out again — Lena voided Ana's Purchase.");
});

test("undoing the Purchase that cleared a Run Out doesn't reopen it once the Common Item was bought again", async () => {
  await threeOccupiedRooms();
  await runOutClearedByAna();
  await bot.sendPrivateMessage(tomas, "bought coffee");
  const groupMessages = bot.messagesTo(group.id);

  await bot.sendPrivateMessage(ana, "coffee");
  await bot.tap(ana, "⋯ More");
  await bot.tap(ana, "↩️ Undo my last Purchase");
  await bot.tap(ana, "Yes, undo it");

  expect(bot.lastMessageTo(ana.id).text).toBe("↩️ Undone: your Purchase of Coffee no longer counts.\nTurn: your Room.");
  expect(bot.messagesTo(group.id)).toEqual(groupMessages);
});

test("nothing but Run Outs and their resolution reaches the Apartment Group", async () => {
  await threeOccupiedRooms();
  await coffeeOnRoomBsTurn();
  await bot.sendPrivateMessage(ana, "bought coffee");
  await bot.sendPrivateMessage(tomas, "coffee");
  await bot.tap(tomas, "⋯ More");
  await bot.tap(tomas, "⏱ Change rough guess");
  await bot.tap(tomas, "~1 month");
  await bot.sendPrivateMessage(ana, "coffee");
  await bot.tap(ana, "⋯ More");
  await bot.tap(ana, "↩️ Undo my last Purchase");
  await bot.tap(ana, "Yes, undo it");
  await bot.sendPrivateMessage(lena, "coffee");
  await bot.tap(lena, "⋯ More");
  await bot.tap(lena, "🗑 Void a Purchase");
  await bot.tap(lena, bot.lastMessageTo(lena.id).buttons[0]![0]!);
  await bot.tap(lena, "Yes, void it");
  await bot.sendPrivateMessage(lena, "coffee");
  await bot.tap(lena, "⋯ More");
  await bot.tap(lena, "🗄 Archive");
  await bot.tap(lena, "Yes, archive it");

  expect(bot.messagesTo(group.id)).toEqual([LINKED]);
});

test("with no group linked, Run Outs send nothing to any group, but the private messages still go out", async () => {
  await threeOccupiedRooms({ linkGroup: false });
  await coffeeOnRoomBsTurn();

  await bot.sendPrivateMessage(tomas, "coffee ran out"); // Reported
  expect(bot.lastMessageTo(tomas.id).text).toBe("⚠️ Reported: Coffee ran out.\nTurn: Room B (Ana).");
  expect(bot.lastMessageTo(ana.id).text).toBe("⚠️ Tomás reported that Coffee ran out. It's your Turn to buy it.");

  await bot.tap(ana, "✅ I bought it"); // Resolved
  expect(bot.lastMessageTo(ana.id).text).toBe(
    "✅ Recorded: you bought Coffee.\nThe Run Out is cleared.\nNext Turn: Room C (Tomás).",
  );
  expect(bot.lastMessageTo(tomas.id).text).toBe("🔁 Ana bought Coffee. It's now your Turn for it.");

  await bot.sendPrivateMessage(ana, "coffee");
  await bot.tap(ana, "⋯ More");
  await bot.tap(ana, "↩️ Undo my last Purchase");
  await bot.tap(ana, "Yes, undo it"); // Reopened
  expect(bot.lastMessageTo(ana.id).text).toBe(
    "↩️ Undone: your Purchase of Coffee no longer counts.\nCoffee is Run Out again.\nTurn: your Room.",
  );

  await bot.sendPrivateMessage(tomas, "coffee ran out");
  await bot.tap(tomas, "↩️ Retract"); // Retracted
  expect(bot.lastMessageTo(tomas.id).text).toBe("↩️ Retracted the Run Out of Coffee.");

  const toGroups = bot.calls.filter((call) => call.method === "sendMessage" && (call.payload.chat_id as number) < 0);
  expect(toGroups).toEqual([]);
  expect(bot.logs.filter((line) => line.includes("Apartment Group"))).toEqual([]);
});

test("once the bot is removed from the Apartment Group, Run Outs aren't posted there any more", async () => {
  await threeOccupiedRooms();
  await coffeeOnRoomBsTurn();
  await bot.removeBotFromGroup(lena, group);
  const before = bot.calls.length;

  await bot.sendPrivateMessage(tomas, "coffee ran out");
  await bot.tap(ana, "✅ I bought it");

  expect(bot.lastMessageTo(ana.id).text).toBe(
    "✅ Recorded: you bought Coffee.\nThe Run Out is cleared.\nNext Turn: Room C (Tomás).",
  );
  expect(bot.calls.slice(before).filter((call) => call.payload.chat_id === group.id)).toEqual([]);
});
