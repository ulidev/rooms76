import { afterEach, expect, test } from "vitest";
import { OPERATOR_ID, startTestBot, VALID_ENV, type TestBot, type TestBotOptions } from "./harness.ts";

let bot: TestBot;
afterEach(() => bot.close());

const lena = { id: OPERATOR_ID, first_name: "Lena" };

/** A fresh Apartment set up by Lena, the Operator, who lives in Room 2. */
async function apartmentSetUpByLena(options: TestBotOptions = {}): Promise<void> {
  bot = await startTestBot(options);
  await bot.sendPrivateMessage(lena, "/start");
  await bot.sendPrivateMessage(lena, "Room 1\nRoom 2");
  await bot.tap(lena, "✅ Confirm Room Order");
  await bot.tap(lena, "Room 2");
}

test("a Resident's /start greets them in their Room with the Shop mode keyboard", async () => {
  await apartmentSetUpByLena();

  await bot.sendPrivateMessage(lena, "/start");

  expect(bot.lastMessageTo(lena.id).text).toBe(
    "👋 Hi Lena, you're in Room 2.\nUse the keyboard below to shop, report what ran out and add items.",
  );
  expect(bot.keyboardOf(lena.id)).toEqual([
    ["🛒 Shopping list", "⚠️ Something ran out"],
    ["📷 Scan", "➕ Add item"],
  ]);
});

test("the Shop mode buttons whose features don't exist yet say so", async () => {
  await apartmentSetUpByLena();

  for (const button of ["🛒 Shopping list", "⚠️ Something ran out", "📷 Scan"]) {
    await bot.sendPrivateMessage(lena, button);
  }

  expect(bot.messagesTo(lena.id).slice(-3)).toEqual([
    "🛒 The shopping list is coming soon.",
    "⚠️ Reporting what ran out is coming soon.",
    "📷 Scanning is coming soon.",
  ]);
});

test("the Shop mode keyboard has no Scan button when SCANNER_URL is empty", async () => {
  await apartmentSetUpByLena({ env: { ...VALID_ENV, SCANNER_URL: "" } });

  await bot.sendPrivateMessage(lena, "/start");

  expect(bot.keyboardOf(lena.id)).toEqual([["🛒 Shopping list", "⚠️ Something ran out"], ["➕ Add item"]]);
});
