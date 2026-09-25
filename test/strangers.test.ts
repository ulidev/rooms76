import { afterEach, expect, test } from "vitest";
import { startTestBot, type TestBot } from "./harness.ts";

let bot: TestBot;
afterEach(() => bot.close());

const stranger = { id: 4242, first_name: "Mallory", last_name: "Smith" };

test("a stranger who starts the bot is told to ask an Admin for an Invite", async () => {
  bot = await startTestBot();

  await bot.sendPrivateMessage(stranger, "/start");

  expect(bot.messagesTo(stranger.id)).toEqual([
    "Hi Mallory! This bot is only for the Residents of this apartment. To join, ask an Admin for an Invite link.",
  ]);
});

test("the bot logs a stranger's /start with their id and name, so the Operator can find their own id", async () => {
  bot = await startTestBot();

  await bot.sendPrivateMessage(stranger, "/start");

  expect(bot.logs).toContain("/start from unknown user 4242 (Mallory Smith)");
});
