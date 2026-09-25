// The Telegram adapter: turns updates into service calls and results into messages.
import { Bot } from "grammy";
import { ABOUT } from "./profile.ts";
import type { Residents } from "./residents.ts";

export interface BotServices {
  residents: Residents;
  log(line: string): void;
}

export function createBot(botToken: string, { residents, log }: BotServices): Bot {
  const bot = new Bot(botToken);

  // The credits are for everyone, Resident or not.
  bot.chatType("private").command("about", (ctx) => ctx.reply(ABOUT, { link_preview_options: { is_disabled: true } }));

  // Only Residents may use the bot. Everyone else gets a polite pointer to the Admins.
  bot.chatType("private").use(async (ctx, next) => {
    if (residents.isResident(ctx.from.id)) return next();

    if (ctx.hasCommand("start")) {
      const name = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ");
      log(`/start from unknown user ${ctx.from.id} (${name})`);
    }
    await ctx.reply(
      `Hi ${ctx.from.first_name}! This bot is only for the Residents of this apartment. ` +
        "To join, ask an Admin for an Invite link.",
    );
  });

  bot.catch((error) => log(`Error while handling update ${error.ctx.update.update_id}: ${String(error.error)}`));

  return bot;
}
