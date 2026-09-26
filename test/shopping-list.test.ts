import { afterEach, expect, test } from "vitest";
import { DAY } from "../src/clock.ts";
import { OPERATOR_ID, startTestBot, type TelegramUser, type TestBot } from "./harness.ts";

let bot: TestBot;
afterEach(() => bot.close());

const lena = { id: OPERATOR_ID, first_name: "Lena" };
const ana = { id: 2002, first_name: "Ana" };
const tomas = { id: 2003, first_name: "Tomás" };

/** Day 0: when everyone moved in. */
const DAY_0 = new Date("2026-09-25T10:00:00Z").getTime();

/**
 * A fresh Apartment on day 0, with Room Order Room A→B→C, set up by Lena, the Operator and
 * only Admin, who lives in Room A. Ana lives in Room B and Tomás in Room C.
 */
async function threeOccupiedRooms(): Promise<void> {
  bot = await startTestBot({ now: new Date(DAY_0) });
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

/** Adds a Common Item through ➕ Add item, with this rough guess for the 3 of them. */
async function addItem(person: TelegramUser, name: string, roughGuess = "Skip"): Promise<void> {
  await bot.sendPrivateMessage(person, "➕ Add item");
  await bot.sendPrivateMessage(person, name);
  await bot.tap(person, roughGuess);
}

/** Moves the clock to this many days after day 0. */
function onDay(days: number): void {
  bot.setNow(new Date(DAY_0 + days * DAY));
}

/** What this Resident's shopping list says. */
async function shoppingListOf(person: TelegramUser): Promise<string> {
  await bot.sendPrivateMessage(person, "🛒 Shopping list");
  return bot.lastMessageTo(person.id).text;
}

test("with no Common Items, the shopping list says how to add one", async () => {
  await threeOccupiedRooms();

  expect(await shoppingListOf(ana)).toBe("🛒 There are no Common Items yet. To add one, tap ➕ Add item.");
});

test("the shopping list has the Resident's Turn, then what anyone may buy, then their Turn later", async () => {
  await threeOccupiedRooms();
  // Lena buys each of these first, so Room A starts their Rotations and it's Room B's Turn.
  await addItem(lena, "Coffee", "~1 week");
  await addItem(lena, "Milk", "~1 week");
  await addItem(lena, "Dish soap", "~2 weeks");
  await addItem(lena, "Sponges");
  await addItem(lena, "Toilet paper", "~1 month");
  await addItem(lena, "Oil", "~1 month");
  // Nobody has bought these yet, so there's no Turn.
  await addItem(lena, "Kitchen paper");
  await addItem(lena, "Tea");
  for (const item of ["coffee", "dish soap", "sponges", "toilet paper", "oil"]) {
    await bot.sendPrivateMessage(lena, `bought ${item}`);
  }
  onDay(0.5);
  await bot.sendPrivateMessage(lena, "bought milk");
  onDay(1);
  await bot.sendPrivateMessage(tomas, "tea ran out");
  await bot.sendPrivateMessage(ana, "oil ran out");
  onDay(2);
  await bot.sendPrivateMessage(tomas, "kitchen paper ran out");
  await bot.sendPrivateMessage(tomas, "toilet paper ran out");

  // Day 6: Coffee is 6 of 7 days through, Milk 5.5 of 7, Dish soap 6 of 14. Sponges has no estimate.
  onDay(6);
  expect(await shoppingListOf(ana)).toBe(
    [
      "🛒 Shopping list",
      "",
      "Your Turn",
      "• Oil · ran out",
      "• Toilet paper · ran out",
      "• Coffee · due soon",
      "• Milk · due soon",
      "",
      "Anyone",
      "• Tea · ran out",
      "• Kitchen paper · ran out",
      "",
      "Your Turn later: Dish soap, Sponges (no estimate yet)",
    ].join("\n"),
  );

  // It's not Lena's Turn for anything: she sees only what anyone may buy.
  expect(await shoppingListOf(lena)).toBe(
    ["🛒 Shopping list", "", "Anyone", "• Tea · ran out", "• Kitchen paper · ran out"].join("\n"),
  );
});

test("a Common Item becomes Due soon once 75% of its Expected Duration has passed", async () => {
  await threeOccupiedRooms();
  await addItem(lena, "Coffee", "~1 week");
  await bot.sendPrivateMessage(lena, "bought coffee");

  onDay(5.2);
  expect(await shoppingListOf(ana)).toBe("🛒 Shopping list\n\nYour Turn later: Coffee");

  onDay(5.25);
  expect(await shoppingListOf(ana)).toBe("🛒 Shopping list\n\nYour Turn\n• Coffee · due soon");
});

test("with nothing to buy, the shopping list says so", async () => {
  await threeOccupiedRooms();
  await addItem(lena, "Coffee", "~1 week");
  await bot.sendPrivateMessage(lena, "bought coffee");

  expect(await shoppingListOf(tomas)).toBe("🛒 Nothing to buy right now.");
});

test("an undone Purchase isn't learned from", async () => {
  await threeOccupiedRooms();
  await addItem(lena, "Coffee");
  await bot.sendPrivateMessage(lena, "bought coffee");
  onDay(2);
  await bot.sendPrivateMessage(ana, "bought coffee"); // Expected Duration: 2 days
  onDay(2.25);
  await bot.sendPrivateMessage(tomas, "bought coffee");
  await bot.sendPrivateMessage(tomas, "coffee");
  await bot.tap(tomas, "⋯ More");
  await bot.tap(tomas, "↩️ Undo my last Purchase");
  await bot.tap(tomas, "Yes, undo it");

  // 1.4 of 2 days since Ana's Purchase. Had Tomás's counted, it would be Due soon.
  onDay(3.4);
  expect(await shoppingListOf(tomas)).toBe("🛒 Shopping list\n\nYour Turn later: Coffee");
});

test("a voided Purchase isn't learned from", async () => {
  await threeOccupiedRooms();
  await addItem(lena, "Coffee");
  await bot.sendPrivateMessage(lena, "bought coffee");
  onDay(2);
  await bot.sendPrivateMessage(ana, "bought coffee"); // Expected Duration: 2 days
  onDay(2.25);
  await bot.sendPrivateMessage(tomas, "bought coffee");
  await bot.sendPrivateMessage(lena, "coffee");
  await bot.tap(lena, "⋯ More");
  await bot.tap(lena, "🗑 Void a Purchase");
  await bot.tap(lena, bot.lastMessageTo(lena.id).buttons.flat().find((text) => text.includes("Tomás"))!);
  await bot.tap(lena, "Yes, void it");

  onDay(3.4);
  expect(await shoppingListOf(tomas)).toBe("🛒 Shopping list\n\nYour Turn later: Coffee");
});

test("a Common Item without an estimate stays Not yet until it runs out", async () => {
  await threeOccupiedRooms();
  await addItem(lena, "Sponges");
  await bot.sendPrivateMessage(lena, "bought sponges");

  onDay(300);
  expect(await shoppingListOf(ana)).toBe("🛒 Shopping list\n\nYour Turn later: Sponges (no estimate yet)");

  await bot.sendPrivateMessage(tomas, "sponges ran out");
  expect(await shoppingListOf(ana)).toBe("🛒 Shopping list\n\nYour Turn\n• Sponges · ran out");
});
