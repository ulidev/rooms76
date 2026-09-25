// Shop mode: the persistent reply keyboard Residents use the bot through.
import { Composer, Keyboard, type Context } from "grammy";
import type { Residents } from "./residents.ts";

const SHOPPING_LIST = "🛒 Shopping list";
const SOMETHING_RAN_OUT = "⚠️ Something ran out";
const SCAN = "📷 Scan";
const ADD_ITEM = "➕ Add item";

/** Shown with the keyboard, so Residents know what it's for. */
export const SHOP_MODE_HINT = "Use the keyboard below to shop, report what ran out and add items.";

export function shopKeyboard(scannerUrl: string | null): Keyboard {
  const keyboard = new Keyboard().text(SHOPPING_LIST).text(SOMETHING_RAN_OUT).row();
  if (scannerUrl !== null) keyboard.text(SCAN);
  return keyboard.text(ADD_ITEM).resized().persistent();
}

/** Shop mode for Residents. Only Residents get this far. */
export function shopMode(residents: Residents, scannerUrl: string | null): Composer<Context> {
  const composer = new Composer<Context>();

  composer.command("start", async (ctx) => {
    const resident = residents.current(ctx.from!.id)!;
    await ctx.reply(`👋 Hi ${resident.name}, you're in ${resident.roomName}.\n${SHOP_MODE_HINT}`, {
      reply_markup: shopKeyboard(scannerUrl),
    });
  });

  // Placeholders until each feature lands.
  composer.hears(SHOPPING_LIST, (ctx) => ctx.reply("🛒 The shopping list is coming soon."));
  composer.hears(SOMETHING_RAN_OUT, (ctx) => ctx.reply("⚠️ Reporting what ran out is coming soon."));
  composer.hears(SCAN, (ctx) => ctx.reply("📷 Scanning is coming soon."));
  composer.hears(ADD_ITEM, (ctx) => ctx.reply("➕ Adding items is coming soon."));

  return composer;
}
