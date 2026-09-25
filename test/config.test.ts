import { expect, test } from "vitest";
import { startTestBot, VALID_ENV } from "./harness.ts";

test("the bot refuses to start and names every missing variable in one error", async () => {
  await expect(startTestBot({ env: {} })).rejects.toThrow(
    [
      "rooms76 can't start. Fix these environment variables:",
      "- BOT_TOKEN is missing. Get it from @BotFather.",
      "- OPERATOR_TELEGRAM_ID is missing. It's your numeric Telegram user id.",
      "- APARTMENT_TIMEZONE is missing. Use an IANA time zone name, e.g. Europe/Berlin.",
      "- OFF_CONTACT is missing. Use an email or URL where Open Food Facts can reach you.",
    ].join("\n"),
  );
});

test("the bot refuses to start and names every invalid variable in one error", async () => {
  const env = {
    ...VALID_ENV,
    BOT_TOKEN: "not-a-token",
    OPERATOR_TELEGRAM_ID: "@operator",
    APARTMENT_TIMEZONE: "Mars/Olympus_Mons",
    OFF_CONTACT: "   ",
    SCANNER_URL: "http://scanner.example.com/",
  };

  await expect(startTestBot({ env })).rejects.toThrow(
    [
      "rooms76 can't start. Fix these environment variables:",
      "- BOT_TOKEN doesn't look like a bot token from @BotFather (e.g. 123456789:AAE...).",
      '- OPERATOR_TELEGRAM_ID "@operator" is not a numeric Telegram user id.',
      '- APARTMENT_TIMEZONE "Mars/Olympus_Mons" is not an IANA time zone name, e.g. Europe/Berlin.',
      "- OFF_CONTACT is missing. Use an email or URL where Open Food Facts can reach you.",
      '- SCANNER_URL "http://scanner.example.com/" must be an https:// URL, or empty to hide the Scan button.',
    ].join("\n"),
  );
});

test("the bot starts with every valid variable, whether SCANNER_URL is unset, empty or an https URL", async () => {
  for (const scannerUrl of [undefined, "", "https://scanner.example.com/v1/"]) {
    const bot = await startTestBot({ env: { ...VALID_ENV, SCANNER_URL: scannerUrl } });
    bot.close();
  }
});
