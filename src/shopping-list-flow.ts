// The shopping list in Telegram: 🛒 Shopping list shows a Resident what is their Turn and
// what anyone may buy, most pressing first. Ticking a line records a Purchase and
// unticking undoes it; the list is edited in place after each tap, so the chat stays tidy.
import { Composer, InlineKeyboard, type CallbackQueryContext, type Context } from "grammy";
import { livesIn, type CommonItem, type CommonItems, type OffListItem, type ShoppingListLine } from "./common-items.ts";
import { roomLabel } from "./notifier.ts";
import type { PurchaseReplies } from "./purchase-replies.ts";
import { ADD_ITEM, SHOPPING_LIST } from "./shop-mode.ts";
import type { OpenShoppingList, ShoppingLists } from "./shopping-lists.ts";
import type { Urgency } from "./urgency.ts";

const SOMETHING_ELSE = "➕ Something else…";
const DONE_SHOPPING = "✔️ Done shopping";

/** Telegram shows at most this many characters in the notification after tapping a button. */
const MAX_TOAST_LENGTH = 200;

/** What a shopping list shows, whichever message shows it. */
type ListView = Omit<OpenShoppingList, "messageId" | "openedAt">;

/** The shopping list for Residents. Only Residents get this far. */
export function shoppingListFlow(
  items: CommonItems,
  purchases: PurchaseReplies,
  shoppingLists: ShoppingLists,
): Composer<Context> {
  const composer = new Composer<Context>();

  composer.hears(SHOPPING_LIST, async (ctx) => {
    const sections = items.shoppingList(ctx.from!.id);
    if (!sections) {
      await ctx.reply(`🛒 There are no Common Items yet. To add one, tap ${ADD_ITEM}.`);
      return;
    }
    const view: ListView = { sections, expanded: false, ticks: [] };
    const message = await ctx.reply(listText(view, ctx.from!.id), { reply_markup: listButtons(view) });
    shoppingLists.set(ctx.chat.id, { ...view, messageId: message.message_id, openedAt: ctx.message!.date * 1000 });
  });

  /**
   * A button on the open shopping list, whose answer edits the list in place. It's out of
   * date on any other message, e.g. a list opened before this one, and once the shopping
   * trip is over. A tick whose Purchase no longer counts, e.g. voided since, is dropped.
   */
  const listButton = (
    data: RegExp | string,
    answer: (ctx: CallbackQueryContext<Context>, list: OpenShoppingList) => Promise<unknown>,
  ) =>
    composer.callbackQuery(data, async (ctx) => {
      const list = shoppingLists.get(ctx.chat!.id);
      if (!list || list.messageId !== ctx.callbackQuery.message?.message_id) return answerOutOfDate(ctx);
      const ticks = list.ticks.filter((tick) => items.countingPurchase(tick.purchaseId) !== null);
      await answer(ctx, { ...list, ticks });
    });

  /** Saves the list as it is now and shows it in place. */
  const saveAndShow = async (ctx: CallbackQueryContext<Context>, list: OpenShoppingList) => {
    shoppingLists.set(ctx.chat!.id, list);
    await ctx.editMessageText(listText(list, ctx.from.id), { reply_markup: listButtons(list) });
  };

  /** Answers with a notification, since the list itself changes in place. */
  const notify = (ctx: CallbackQueryContext<Context>) => (text: string) => ctx.answerCallbackQuery(toast(text));

  listButton(/^list:tick:(\d+)$/, async (ctx, list) => {
    const itemId = Number(ctx.match![1]);
    const tick = list.ticks.find((ticked) => ticked.itemId === itemId);
    if (tick) {
      const undone = await purchases.undo(ctx, tick.purchaseId, notify(ctx));
      if (!undone) {
        const name = shownItems(list).find((item) => item.id === itemId)!.name;
        return ctx.answerCallbackQuery(toast(`That Purchase is no longer your last of ${name}, so it can't be unticked.`));
      }
      await saveAndShow(ctx, { ...list, ticks: list.ticks.filter((ticked) => ticked !== tick) });
      return;
    }
    const purchase = await purchases.record(ctx, itemId, notify(ctx));
    if (!purchase) return answerOutOfDate(ctx);
    await saveAndShow(ctx, { ...list, ticks: [...list.ticks, { itemId, purchaseId: purchase.id }] });
  });

  listButton("list:more", async (ctx, list) => {
    await ctx.answerCallbackQuery();
    await saveAndShow(ctx, { ...list, expanded: true });
  });

  listButton("list:done", async (ctx, list) => {
    shoppingLists.clear(ctx.chat!.id);
    await ctx.answerCallbackQuery();
    const count = list.ticks.length;
    const bought = count === 0 ? "nothing bought" : `${count} Purchase${count === 1 ? "" : "s"} recorded`;
    await ctx.editMessageText(`${listText(list, ctx.from.id)}\n\n${DONE_SHOPPING}: ${bought}.`);
  });

  return composer;
}

const URGENCY_LABELS: Record<Urgency, string> = { "run-out": "ran out", "due-soon": "due soon", "not-yet": "not yet" };

/** The shopping list as this Resident reads it: a box per line, ticked or not. */
function listText(view: ListView, telegramId: number): string {
  const { sections, expanded } = view;
  const line = (item: CommonItem, detail: string) => (isTicked(view, item) ? `☑ ${item.name}` : `☐ ${item.name} · ${detail}`);
  const section = (title: string, lines: string[]) => [title, ...lines].join("\n");
  const urgencyLines = (lines: ShoppingListLine[]) => lines.map((item) => line(item, URGENCY_LABELS[item.urgency]));

  const shown = [];
  if (sections.yourTurn.length > 0) shown.push(section("Your Turn", urgencyLines(sections.yourTurn)));
  if (sections.anyone.length > 0) shown.push(section("Anyone", urgencyLines(sections.anyone)));
  // Expanded, the Common Items that are Your Turn later are among the rest, to tick.
  if (expanded && sections.offList.length > 0) {
    shown.push(section("Something else", sections.offList.map((item) => line(item, whoseTurn(item, telegramId)))));
  } else if (sections.yourTurnLater.length > 0) {
    const names = sections.yourTurnLater.map((item) => (item.noEstimate ? `${item.name} (no estimate yet)` : item.name));
    shown.push(`Your Turn later: ${names.join(", ")}`);
  }
  if (shown.length === 0) return "🛒 Nothing to buy right now.";
  return ["🛒 Shopping list", ...shown].join("\n\n");
}

/** Whose Turn it is to buy a Common Item off the list, in a few words. */
function whoseTurn({ turn }: OffListItem, telegramId: number): string {
  if (turn === null) return "no Turn yet";
  return `Turn: ${livesIn(turn, telegramId) ? "your Room" : roomLabel(turn)}`;
}

/** The Common Items with a box to tick: Your Turn, Anyone and, once expanded, the rest. */
function shownItems({ sections, expanded }: ListView): CommonItem[] {
  return [...sections.yourTurn, ...sections.anyone, ...(expanded ? sections.offList : [])];
}

function isTicked({ ticks }: ListView, item: CommonItem): boolean {
  return ticks.some((tick) => tick.itemId === item.id);
}

/** A box to tick for each line shown, two to a row, then ➕ Something else… and ✔️ Done shopping. */
function listButtons(view: ListView): InlineKeyboard {
  const shown = shownItems(view);
  const buttons = new InlineKeyboard();
  shown.forEach((item, index) => {
    buttons.text(`${isTicked(view, item) ? "☑" : "☐"} ${item.name}`, `list:tick:${item.id}`);
    if (index % 2 === 1 || index === shown.length - 1) buttons.row();
  });
  if (!view.expanded && view.sections.offList.length > 0) buttons.text(SOMETHING_ELSE, "list:more").row();
  return buttons.text(DONE_SHOPPING, "list:done");
}

/** Text for the notification after tapping a button, cut short to what Telegram shows. */
function toast(text: string): string {
  return text.length <= MAX_TOAST_LENGTH ? text : `${text.slice(0, MAX_TOAST_LENGTH - 1)}…`;
}

/** For a button on a shopping list that's no longer open, or a line that's gone. */
async function answerOutOfDate(ctx: Context): Promise<void> {
  await ctx.answerCallbackQuery("This button is out of date.");
}
