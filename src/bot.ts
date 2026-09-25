// The Telegram adapter: turns updates into service calls and results into messages.
import { Bot } from "grammy";
import type { ChatStates } from "./chat-states.ts";
import type { Invites } from "./invites.ts";
import { inviteManagement, joinByInvite } from "./invites-flow.ts";
import { ABOUT } from "./profile.ts";
import type { Residents } from "./residents.ts";
import { renameFlow } from "./name-flow.ts";
import { guidedSetup, optionalSetupSteps } from "./setup-flow.ts";
import type { Setup } from "./setup.ts";
import { isShopButton, shopMode } from "./shop-mode.ts";

export interface BotServices {
  residents: Residents;
  setup: Setup;
  invites: Invites;
  chatStates: ChatStates;
  /** Null hides the Scan button. */
  scannerUrl: string | null;
  log(line: string): void;
}

export function createBot(botToken: string, { residents, setup, invites, chatStates, scannerUrl, log }: BotServices): Bot {
  const bot = new Bot(botToken);

  // A command or a Shop mode button leaves a half-finished flow (a new name, an Invite's
  // move-in date) and does what it says. Guided setup keeps its draft: it steers back to it.
  bot.chatType("private").on("message:text", async (ctx, next) => {
    const text = ctx.message.text;
    const flow = chatStates.get(ctx.chat.id)?.flow;
    if (flow !== undefined && flow !== "setup-rooms" && (text.startsWith("/") || isShopButton(text))) {
      chatStates.clear(ctx.chat.id);
    }
    return next();
  });

  // The credits are for everyone, Resident or not.
  bot.chatType("private").command("about", (ctx) => ctx.reply(ABOUT, { link_preview_options: { is_disabled: true } }));

  // Until the Apartment is set up, the first Admin only sees guided setup.
  bot.chatType("private").use(guidedSetup(setup, chatStates, scannerUrl));

  // Whoever opens a pending Invite link becomes a Resident.
  bot.chatType("private").use(joinByInvite(invites, scannerUrl));

  // Only Residents may use the bot. Everyone else gets a polite pointer to the Admins.
  bot.chatType("private").use(async (ctx, next) => {
    if (residents.current(ctx.from.id) !== null) return next();

    if (ctx.hasCommand("start")) {
      const name = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ");
      log(`/start from unknown user ${ctx.from.id} (${name})`);
    }
    await ctx.reply(
      `Hi ${ctx.from.first_name}! This bot is only for the Residents of this apartment. ` +
        "To join, ask an Admin for an Invite link.",
    );
  });

  bot.chatType("private").use(optionalSetupSteps());
  bot.chatType("private").use(inviteManagement(invites, residents, chatStates));
  bot.chatType("private").use(renameFlow(residents, chatStates));
  bot.chatType("private").use(shopMode(residents, scannerUrl));

  bot.catch((error) => log(`Error while handling update ${error.ctx.update.update_id}: ${String(error.error)}`));

  return bot;
}
