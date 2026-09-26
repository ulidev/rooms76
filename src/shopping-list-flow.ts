// The shopping list in Telegram: 🛒 Shopping list shows a Resident what is their Turn and
// what anyone may buy, most pressing first.
import { Composer, type Context } from "grammy";
import type { CommonItems, ShoppingList, ShoppingListLine } from "./common-items.ts";
import { ADD_ITEM, SHOPPING_LIST } from "./shop-mode.ts";
import type { Urgency } from "./urgency.ts";

/** The shopping list for Residents. Only Residents get this far. */
export function shoppingListFlow(items: CommonItems): Composer<Context> {
  const composer = new Composer<Context>();

  composer.hears(SHOPPING_LIST, async (ctx) => {
    const list = items.shoppingList(ctx.from!.id);
    await ctx.reply(list ? shoppingListText(list) : `🛒 There are no Common Items yet. To add one, tap ${ADD_ITEM}.`);
  });

  return composer;
}

const URGENCY_LABELS: Record<Urgency, string> = { "run-out": "ran out", "due-soon": "due soon", "not-yet": "not yet" };

function shoppingListText({ yourTurn, anyone, yourTurnLater }: ShoppingList): string {
  const section = (title: string, lines: ShoppingListLine[]) =>
    [title, ...lines.map((line) => `• ${line.name} · ${URGENCY_LABELS[line.urgency]}`)].join("\n");
  const sections = [];
  if (yourTurn.length > 0) sections.push(section("Your Turn", yourTurn));
  if (anyone.length > 0) sections.push(section("Anyone", anyone));
  if (yourTurnLater.length > 0) {
    const names = yourTurnLater.map((line) => (line.noEstimate ? `${line.name} (no estimate yet)` : line.name));
    sections.push(`Your Turn later: ${names.join(", ")}`);
  }
  if (sections.length === 0) return "🛒 Nothing to buy right now.";
  return ["🛒 Shopping list", ...sections].join("\n\n");
}
