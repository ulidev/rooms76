import { afterEach, expect, test } from "vitest";
import { OPERATOR_ID, startTestBot, type TestBot } from "./harness.ts";

let bot: TestBot;
afterEach(() => bot.close());

const lena = { id: OPERATOR_ID, first_name: "Lena" };

/** A fresh Apartment set up by Lena, the Operator, who lives in Room 2. */
async function apartmentSetUpByLena(): Promise<void> {
  bot = await startTestBot();
  await bot.sendPrivateMessage(lena, "/start");
  await bot.sendPrivateMessage(lena, "Room 1\nRoom 2");
  await bot.tap(lena, "✅ Confirm Room Order");
  await bot.tap(lena, "Room 2");
}

test("a Resident changes their name with /name", async () => {
  await apartmentSetUpByLena();

  await bot.sendPrivateMessage(lena, "/name");
  expect(bot.lastMessageTo(lena.id)).toEqual({
    id: expect.any(Number),
    text: "You're called Lena. Send me your new name.",
    buttons: [["↩️ Keep Lena"]],
  });

  await bot.sendPrivateMessage(lena, "  Lena M.  ");
  expect(bot.lastMessageTo(lena.id).text).toBe("✅ I'll call you “Lena M.” from now on.");

  await bot.sendPrivateMessage(lena, "/start");
  expect(bot.lastMessageTo(lena.id).text).toMatch(/^👋 Hi Lena M\., you're in Room 2\./);
});

test("a Resident can keep their name after all", async () => {
  await apartmentSetUpByLena();
  await bot.sendPrivateMessage(lena, "/name");

  await bot.tap(lena, "↩️ Keep Lena");
  expect(bot.lastMessageTo(lena.id).text).toBe("OK, you're still Lena.");

  await bot.sendPrivateMessage(lena, "Something ran out?");
  expect(bot.messagesTo(lena.id)).not.toContain("✅ I'll call you “Something ran out?” from now on.");
});

test("a name longer than 64 characters is refused and asked for again", async () => {
  await apartmentSetUpByLena();
  await bot.sendPrivateMessage(lena, "/name");

  await bot.sendPrivateMessage(lena, "L".repeat(65));
  expect(bot.lastMessageTo(lena.id).text).toBe("Names have at most 64 characters. Send me another one.");

  await bot.sendPrivateMessage(lena, "L".repeat(64));
  expect(bot.lastMessageTo(lena.id).text).toBe(`✅ I'll call you “${"L".repeat(64)}” from now on.`);
});

test("a Shop mode button while being asked for a name does what it says and keeps the name", async () => {
  await apartmentSetUpByLena();
  await bot.sendPrivateMessage(lena, "/name");

  await bot.sendPrivateMessage(lena, "🛒 Shopping list");
  expect(bot.lastMessageTo(lena.id).text).toBe("🛒 The shopping list is coming soon.");

  await bot.sendPrivateMessage(lena, "/start");
  expect(bot.lastMessageTo(lena.id).text).toMatch(/^👋 Hi Lena, you're in Room 2\./);
});

test("any command while being asked for a name keeps the name, even one another feature answers", async () => {
  await apartmentSetUpByLena();

  for (const command of ["/invites", "/about"]) {
    await bot.sendPrivateMessage(lena, "/name");
    await bot.sendPrivateMessage(lena, command);
    await bot.sendPrivateMessage(lena, "hello");
  }

  expect(bot.messagesTo(lena.id).filter((text) => text.startsWith("✅ I'll call you"))).toEqual([]);
});
