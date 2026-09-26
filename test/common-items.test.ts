import { afterEach, expect, test } from "vitest";
import { OPERATOR_ID, startTestBot, type TelegramUser, type TestBot } from "./harness.ts";

let bot: TestBot;
afterEach(() => bot.close());

const lena = { id: OPERATOR_ID, first_name: "Lena" };
const ana = { id: 2002, first_name: "Ana" };
const tomas = { id: 2003, first_name: "Tomás" };
const aiko = { id: 2004, first_name: "Aiko" };

/** A fresh Apartment with Room Order Room A→B→C→D, set up by Lena, the Operator, who lives in Room A. */
async function apartmentSetUpByLena(): Promise<void> {
  bot = await startTestBot();
  await bot.sendPrivateMessage(lena, "/start");
  await bot.sendPrivateMessage(lena, "Room A\nRoom B\nRoom C\nRoom D");
  await bot.tap(lena, "✅ Confirm Room Order");
  await bot.tap(lena, "Room A");
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

test("➕ Add item asks for the Common Item's name, then roughly how long one Purchase lasts", async () => {
  await apartmentSetUpByLena();
  await join(ana, "Room B");

  await bot.sendPrivateMessage(lena, "➕ Add item");
  expect(bot.lastMessageTo(lena.id).text).toBe(
    "➕ What's the new Common Item? Describe the need, not the brand, e.g. “kitchen paper”.",
  );

  await bot.sendPrivateMessage(lena, "kitchen paper");
  expect(bot.lastMessageTo(lena.id)).toEqual({
    id: expect.any(Number),
    text:
      "Roughly how long does one Purchase of Kitchen paper last for the 2 of you?\n" +
      "A rough guess is fine; I'll learn from real Purchases.",
    buttons: [["~1 week", "~2 weeks"], ["~1 month", "~3 months"], ["Skip"]],
  });

  await bot.tap(lena, "~2 weeks");
  expect(bot.lastMessageTo(lena.id)).toEqual({
    id: expect.any(Number),
    text: "➕ Added Kitchen paper. Nobody has bought it yet, so there's no Turn: anyone can buy it first.",
    buttons: [["✅ I just bought it"]],
  });
});

/** Adds a Common Item through ➕ Add item, with this rough guess. */
async function addItem(person: TelegramUser, name: string, roughGuess = "Skip"): Promise<void> {
  await bot.sendPrivateMessage(person, "➕ Add item");
  await bot.sendPrivateMessage(person, name);
  await bot.tap(person, roughGuess);
}

test("a Common Item's name must be new, ignoring case, and is asked for again", async () => {
  await apartmentSetUpByLena();
  await addItem(lena, "Dish soap");

  await bot.sendPrivateMessage(lena, "➕ Add item");
  await bot.sendPrivateMessage(lena, "DISH SOAP");
  expect(bot.lastMessageTo(lena.id).text).toBe("There's already a Common Item called Dish soap. Send me another name.");

  await bot.sendPrivateMessage(lena, "dishwasher tabs");
  expect(bot.lastMessageTo(lena.id).text).toBe(
    "Roughly how long does one Purchase of Dishwasher tabs last for you?\n" +
      "A rough guess is fine; I'll learn from real Purchases.",
  );
  await bot.tap(lena, "Skip");
  expect(bot.lastMessageTo(lena.id).text).toBe(
    "➕ Added Dishwasher tabs. Nobody has bought it yet, so there's no Turn: anyone can buy it first.",
  );
});

test("the first Purchase makes the buyer's Room the Rotation Start and passes the Turn on", async () => {
  await apartmentSetUpByLena();
  await join(ana, "Room B");
  await addItem(lena, "Kitchen paper");

  await bot.sendPrivateMessage(lena, "bought kitchen paper");

  expect(bot.lastMessageTo(lena.id).text).toBe(
    "✅ Recorded: you bought Kitchen paper.\n" +
      "You're the first to buy it, so Room A starts its Rotation.\n" +
      "Next Turn: Room B (Ana).",
  );
  expect(bot.lastMessageTo(ana.id).text).toBe("🔁 Lena bought Kitchen paper. It's now your Turn for it.");
});

/** Lena in Room A, Ana in Room B, Tomás in Room C and Aiko in Room D. */
async function fourOccupiedRooms(): Promise<void> {
  await apartmentSetUpByLena();
  await join(ana, "Room B");
  await join(tomas, "Room C");
  await join(aiko, "Room D");
}

test("a Purchase out of turn counts, and that Room is skipped once the others catch up", async () => {
  await fourOccupiedRooms();
  await addItem(lena, "Kitchen paper");
  await bot.sendPrivateMessage(lena, "bought kitchen paper"); // Start A: now it's B's Turn

  await bot.sendPrivateMessage(tomas, "I just bought kitchen paper");
  expect(bot.lastMessageTo(tomas.id).text).toBe(
    "✅ Recorded: you bought Kitchen paper.\n" +
      "That was out of turn: Room B (Ana) still holds the Turn, so Room C will be skipped later.",
  );
  expect(bot.messagesTo(ana.id).filter((text) => text.startsWith("🔁"))).toEqual([
    "🔁 Lena bought Kitchen paper. It's now your Turn for it.",
  ]);

  await bot.sendPrivateMessage(ana, "bought kitchen paper");
  expect(bot.lastMessageTo(ana.id).text).toBe("✅ Recorded: you bought Kitchen paper.\nNext Turn: Room D (Aiko).");
  expect(bot.lastMessageTo(aiko.id).text).toBe("🔁 Ana bought Kitchen paper. It's now your Turn for it.");
  expect(bot.messagesTo(tomas.id).filter((text) => text.startsWith("🔁"))).toEqual([]);
});

test("Purchases send nothing to any group, only to private chats", async () => {
  await fourOccupiedRooms();
  await addItem(lena, "Kitchen paper");

  await bot.sendPrivateMessage(lena, "bought kitchen paper");
  await bot.sendPrivateMessage(tomas, "bought kitchen paper");
  await bot.sendPrivateMessage(ana, "bought kitchen paper");

  const residentChats = [lena, ana, tomas, aiko].map((person) => person.id);
  const recipients = bot.calls.filter((call) => call.method === "sendMessage").map((call) => call.payload.chat_id);
  expect(recipients.filter((chatId) => !residentChats.includes(chatId as number))).toEqual([]);
});

test("typing an unknown name offers to add it as a Common Item", async () => {
  await apartmentSetUpByLena();
  await join(ana, "Room B");

  await bot.sendPrivateMessage(lena, "bought oat milk");
  expect(bot.lastMessageTo(lena.id)).toEqual({
    id: expect.any(Number),
    text: "I don't know “Oat milk”. Is it a new Common Item?",
    buttons: [["➕ Add “Oat milk”"]],
  });

  await bot.tap(lena, "➕ Add “Oat milk”");
  expect(bot.lastMessageTo(lena.id).text).toBe(
    "Roughly how long does one Purchase of Oat milk last for the 2 of you?\n" +
      "A rough guess is fine; I'll learn from real Purchases.",
  );
  await bot.tap(lena, "~1 week");
  await bot.tap(lena, "✅ I just bought it");
  expect(bot.lastMessageTo(lena.id).text).toBe(
    "✅ Recorded: you bought Oat milk.\n" +
      "You're the first to buy it, so Room A starts its Rotation.\n" +
      "Next Turn: Room B (Ana).",
  );
  expect(bot.lastMessageTo(ana.id).text).toBe("🔁 Lena bought Oat milk. It's now your Turn for it.");
});

test("an offer to add a Common Item is out of date once another text replaces it", async () => {
  await apartmentSetUpByLena();
  await bot.sendPrivateMessage(lena, "oat milk");
  await bot.sendPrivateMessage(lena, "coffee");

  await bot.tap(lena, "➕ Add “Oat milk”");

  expect(bot.toastsTo(lena.id)).toEqual(["This button is out of date."]);
});

test("typing a Common Item's name shows whose Turn it is, with a button to record a Purchase", async () => {
  await apartmentSetUpByLena();
  await addItem(lena, "Bin bags");

  await bot.sendPrivateMessage(lena, "bin bag");
  expect(bot.lastMessageTo(lena.id)).toEqual({
    id: expect.any(Number),
    text: "Bin bags\nNo Turn yet: nobody has bought it, so anyone can.",
    buttons: [["✅ I bought it"], ["⋯ More"]],
  });

  await bot.tap(lena, "✅ I bought it");
  expect(bot.lastMessageTo(lena.id).text).toBe(
    "✅ Recorded: you bought Bin bags.\n" +
      "You're the first to buy it, so Room A starts its Rotation.\n" +
      "Next Turn: your Room again.",
  );
});

test("a Room occupied later enters the Rotation at the lowest current count", async () => {
  await apartmentSetUpByLena();
  await addItem(lena, "Coffee");
  await bot.sendPrivateMessage(lena, "bought coffee");
  await bot.sendPrivateMessage(lena, "bought coffee"); // Room A: 2

  await join(ana, "Room B"); // Room B enters at 2, not 0
  await bot.sendPrivateMessage(ana, "coffee");

  expect(bot.lastMessageTo(ana.id).text).toBe("Coffee\nTurn: Room A (Lena).");
});

test("a name someone else adds while the rough guess is being picked isn't added twice", async () => {
  await apartmentSetUpByLena();
  await join(ana, "Room B");
  await bot.sendPrivateMessage(lena, "➕ Add item");
  await bot.sendPrivateMessage(lena, "Coffee");

  await addItem(ana, "coffee");
  await bot.tap(lena, "~1 week");

  expect(bot.lastMessageTo(lena.id)).toEqual({
    id: expect.any(Number),
    text: "There's already a Common Item called Coffee.",
    buttons: [],
  });
});
