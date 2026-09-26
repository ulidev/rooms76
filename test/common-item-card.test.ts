import { afterEach, expect, test } from "vitest";
import { OPERATOR_ID, startTestBot, type TelegramUser, type TestBot } from "./harness.ts";

let bot: TestBot;
afterEach(() => bot.close());

const lena = { id: OPERATOR_ID, first_name: "Lena" };
const ana = { id: 2002, first_name: "Ana" };
const tomas = { id: 2003, first_name: "Tomás" };

/**
 * A fresh Apartment with Room Order Room A→B→C, set up by Lena, the Operator and only
 * Admin, who lives in Room A. Ana lives in Room B and Tomás in Room C.
 */
async function threeOccupiedRooms(): Promise<void> {
  bot = await startTestBot();
  await bot.sendPrivateMessage(lena, "/start");
  await bot.sendPrivateMessage(lena, "Room A\nRoom B\nRoom C");
  await bot.tap(lena, "✅ Confirm Room Order");
  await bot.tap(lena, "Room A");
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

/** Adds a Common Item through ➕ Add item, with this rough guess. */
async function addItem(person: TelegramUser, name: string, roughGuess = "Skip"): Promise<void> {
  await bot.sendPrivateMessage(person, "➕ Add item");
  await bot.sendPrivateMessage(person, name);
  await bot.tap(person, roughGuess);
}

/** Moves the clock to this time on 25 Sep 2026, in the Apartment time zone (Berlin, UTC+2). */
function at(time: string): void {
  bot.setNow(new Date(`2026-09-25T${time}:00+02:00`));
}

/** Opens a Common Item's card by typing its name, then taps ⋯ More. */
async function more(person: TelegramUser, name: string): Promise<void> {
  await bot.sendPrivateMessage(person, name);
  await bot.tap(person, "⋯ More");
}

test("a Resident undoes their own last Purchase, and their Room's count goes back down", async () => {
  await threeOccupiedRooms();
  await addItem(lena, "Coffee");
  at("09:00");
  await bot.sendPrivateMessage(lena, "bought coffee"); // Start A: now it's B's Turn
  at("10:30");
  await bot.sendPrivateMessage(ana, "bought coffee"); // Now it's C's Turn

  await more(ana, "coffee");
  expect(bot.lastMessageTo(ana.id)).toEqual({
    id: expect.any(Number),
    text: "More for Coffee:",
    buttons: [["↩️ Undo my last Purchase"], ["⏱ Change rough guess"], ["🗄 Archive"], ["← Back"]],
  });

  await bot.tap(ana, "↩️ Undo my last Purchase");
  expect(bot.lastMessageTo(ana.id)).toEqual({
    id: expect.any(Number),
    text: "↩️ Undo your Purchase of Coffee from 25 Sep 2026, 10:30?",
    buttons: [["Yes, undo it", "No, keep it"]],
  });

  await bot.tap(ana, "Yes, undo it");
  expect(bot.lastMessageTo(ana.id)).toEqual({
    id: expect.any(Number),
    text: "↩️ Undone: your Purchase of Coffee no longer counts.\nTurn: your Room.",
    buttons: [],
  });
});

test("undoing the only Purchase leaves no Turn, and the next Purchase starts the Rotation again", async () => {
  await threeOccupiedRooms();
  await addItem(lena, "Coffee");
  await bot.sendPrivateMessage(lena, "bought coffee");

  await more(lena, "coffee");
  await bot.tap(lena, "↩️ Undo my last Purchase");
  await bot.tap(lena, "Yes, undo it");
  expect(bot.lastMessageTo(lena.id).text).toBe(
    "↩️ Undone: your Purchase of Coffee no longer counts.\nNo Turn yet: nobody has bought it, so anyone can.",
  );

  await bot.sendPrivateMessage(ana, "bought coffee");
  expect(bot.lastMessageTo(ana.id).text).toBe(
    "✅ Recorded: you bought Coffee.\n" +
      "You're the first to buy it, so Room B starts its Rotation.\n" +
      "Next Turn: Room C (Tomás).",
  );
});

test("only the last Purchase can be undone, so an undo asked before a newer Purchase is out of date", async () => {
  await threeOccupiedRooms();
  await addItem(lena, "Coffee");
  at("09:00");
  await bot.sendPrivateMessage(ana, "bought coffee");
  await more(ana, "coffee");
  await bot.tap(ana, "↩️ Undo my last Purchase");
  at("10:30");
  await bot.sendPrivateMessage(ana, "bought coffee");

  await bot.tap(ana, "Yes, undo it");
  expect(bot.toastsTo(ana.id)).toEqual(["This button is out of date."]);

  await more(ana, "coffee");
  await bot.tap(ana, "↩️ Undo my last Purchase");
  expect(bot.lastMessageTo(ana.id).text).toBe("↩️ Undo your Purchase of Coffee from 25 Sep 2026, 10:30?");
});

test("a Resident without a Purchase of the Common Item isn't offered an undo", async () => {
  await threeOccupiedRooms();
  await addItem(lena, "Coffee");
  await bot.sendPrivateMessage(lena, "bought coffee");

  await more(tomas, "coffee");

  expect(bot.lastMessageTo(tomas.id).buttons).toEqual([["⏱ Change rough guess"], ["🗄 Archive"], ["← Back"]]);
  await bot.tap(tomas, "← Back");
  expect(bot.lastMessageTo(tomas.id)).toEqual({
    id: expect.any(Number),
    text: "Coffee\nTurn: Room B (Ana).",
    buttons: [["✅ I bought it"], ["⋯ More"]],
  });
});

test("an Admin voids someone else's Purchase, and it no longer counts", async () => {
  await threeOccupiedRooms();
  await addItem(lena, "Coffee");
  at("09:00");
  await bot.sendPrivateMessage(lena, "bought coffee"); // Start A: now it's B's Turn
  at("10:30");
  await bot.sendPrivateMessage(ana, "bought coffee"); // Now it's C's Turn

  await more(lena, "coffee");
  expect(bot.lastMessageTo(lena.id).buttons).toEqual([
    ["↩️ Undo my last Purchase"],
    ["🗑 Void a Purchase"],
    ["⏱ Change rough guess"],
    ["🗄 Archive"],
    ["← Back"],
  ]);

  await bot.tap(lena, "🗑 Void a Purchase");
  expect(bot.lastMessageTo(lena.id)).toEqual({
    id: expect.any(Number),
    text: "🗑 Which Purchase of Coffee should no longer count?",
    buttons: [["25 Sep 2026, 10:30 · Ana (Room B)"], ["25 Sep 2026, 09:00 · Lena (Room A)"], ["← Back"]],
  });

  await bot.tap(lena, "25 Sep 2026, 10:30 · Ana (Room B)");
  expect(bot.lastMessageTo(lena.id)).toEqual({
    id: expect.any(Number),
    text: "🗑 Void Ana's Purchase of Coffee from 25 Sep 2026, 10:30? It will no longer count.",
    buttons: [["Yes, void it", "No, keep it"]],
  });

  await bot.tap(lena, "Yes, void it");
  expect(bot.lastMessageTo(lena.id).text).toBe(
    "🗑 Voided: Ana's Purchase of Coffee no longer counts.\nTurn: Room B (Ana).",
  );
  await bot.sendPrivateMessage(ana, "coffee");
  expect(bot.lastMessageTo(ana.id).text).toBe("Coffee\nTurn: your Room.");
});

test("a Resident changes a Common Item's rough guess, or drops it", async () => {
  await threeOccupiedRooms();
  await addItem(lena, "Coffee", "~1 week");

  await more(tomas, "coffee");
  await bot.tap(tomas, "⏱ Change rough guess");
  expect(bot.lastMessageTo(tomas.id)).toEqual({
    id: expect.any(Number),
    text:
      "Roughly how long does one Purchase of Coffee last for the 3 of you?\n" +
      "A rough guess is fine; I'll learn from real Purchases.",
    buttons: [["~1 week", "~2 weeks"], ["~1 month", "~3 months"], ["No guess"], ["← Back"]],
  });

  await bot.tap(tomas, "~1 month");
  expect(bot.lastMessageTo(tomas.id)).toEqual({
    id: expect.any(Number),
    text: "⏱ Rough guess for Coffee: ~1 month for the 3 of you.",
    buttons: [],
  });

  await more(tomas, "coffee");
  await bot.tap(tomas, "⏱ Change rough guess");
  await bot.tap(tomas, "No guess");
  expect(bot.lastMessageTo(tomas.id).text).toBe("⏱ Coffee has no rough guess now; I'll learn from real Purchases.");
});

test("a Resident archives a Common Item: it can't be bought any more, but keeps its history for an Admin to restore", async () => {
  await threeOccupiedRooms();
  await addItem(lena, "Coffee");
  await bot.sendPrivateMessage(lena, "bought coffee"); // Start A: now it's B's Turn
  await bot.sendPrivateMessage(ana, "coffee");

  await more(tomas, "coffee");
  await bot.tap(tomas, "🗄 Archive");
  expect(bot.lastMessageTo(tomas.id)).toEqual({
    id: expect.any(Number),
    text:
      "🗄 Archive Coffee? It leaves the lists and nobody can record Purchases of it, " +
      "but its history stays. An Admin can restore it.",
    buttons: [["Yes, archive it", "No, keep it"]],
  });
  await bot.tap(tomas, "Yes, archive it");
  expect(bot.lastMessageTo(tomas.id)).toEqual({ id: expect.any(Number), text: "🗄 Archived Coffee.", buttons: [] });

  await bot.tap(ana, "✅ I bought it");
  expect(bot.toastsTo(ana.id)).toEqual(["This button is out of date."]);
  await bot.sendPrivateMessage(ana, "bought coffee");
  expect(bot.lastMessageTo(ana.id)).toEqual({
    id: expect.any(Number),
    text: "🗄 Coffee is archived. Ask an Admin to restore it.",
    buttons: [],
  });

  await bot.sendPrivateMessage(lena, "coffee");
  expect(bot.lastMessageTo(lena.id)).toEqual({
    id: expect.any(Number),
    text: "🗄 Coffee is archived.",
    buttons: [["♻️ Restore"]],
  });
  await bot.tap(lena, "♻️ Restore");
  expect(bot.lastMessageTo(lena.id)).toEqual({
    id: expect.any(Number),
    text: "♻️ Restored Coffee.\nTurn: Room B (Ana).",
    buttons: [["✅ I bought it"], ["⋯ More"]],
  });
});

test("a new Common Item can't take an archived one's name", async () => {
  await threeOccupiedRooms();
  await addItem(lena, "Coffee");
  await more(lena, "coffee");
  await bot.tap(lena, "🗄 Archive");
  await bot.tap(lena, "Yes, archive it");

  await bot.sendPrivateMessage(lena, "➕ Add item");
  await bot.sendPrivateMessage(lena, "coffee");

  expect(bot.lastMessageTo(lena.id).text).toBe(
    "There's already a Common Item called Coffee, but it's archived: an Admin can restore it. Send me another name.",
  );
});

test("undos, voids and archiving send nothing to anyone but the Resident acting", async () => {
  await threeOccupiedRooms();
  await addItem(lena, "Coffee");
  await bot.sendPrivateMessage(lena, "bought coffee");
  await bot.sendPrivateMessage(ana, "bought coffee"); // The Turn passes to Room C
  await bot.sendPrivateMessage(tomas, "bought coffee"); // And back to Room A
  const before = bot.calls.length;

  await more(tomas, "coffee");
  await bot.tap(tomas, "↩️ Undo my last Purchase"); // The Turn goes back to Room C
  await bot.tap(tomas, "Yes, undo it");
  await more(lena, "coffee");
  await bot.tap(lena, "🗑 Void a Purchase");
  await bot.tap(lena, bot.lastMessageTo(lena.id).buttons[0]![0]!); // Ana's: the Turn goes to Room B
  await bot.tap(lena, "Yes, void it");
  await more(lena, "coffee");
  await bot.tap(lena, "🗄 Archive");
  await bot.tap(lena, "Yes, archive it");

  const recipients = bot.calls
    .slice(before)
    .filter((call) => call.method === "sendMessage" || call.method === "editMessageText")
    .map((call) => call.payload.chat_id);
  expect(new Set(recipients)).toEqual(new Set([tomas.id, lena.id]));
  expect(bot.lastMessageTo(ana.id).text).toBe("✅ Recorded: you bought Coffee.\nNext Turn: Room C (Tomás).");
});

test("voiding the first Purchase makes the Room of the next one the Rotation Start", async () => {
  await threeOccupiedRooms();
  await addItem(lena, "Coffee");
  at("09:00");
  await bot.sendPrivateMessage(lena, "bought coffee"); // Start A: now it's B's Turn
  at("10:30");
  await bot.sendPrivateMessage(ana, "bought coffee"); // Now it's C's Turn

  await more(lena, "coffee");
  await bot.tap(lena, "🗑 Void a Purchase");
  await bot.tap(lena, "25 Sep 2026, 09:00 · Lena (Room A)");
  await bot.tap(lena, "Yes, void it");

  // Room B made the first Purchase that counts, so ties go B→C→A: Room C before Room A.
  expect(bot.lastMessageTo(lena.id).text).toBe(
    "🗑 Voided: Lena's Purchase of Coffee no longer counts.\nTurn: Room C (Tomás).",
  );
});
