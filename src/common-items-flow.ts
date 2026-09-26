// Common Items in Telegram: adding them with ➕ Add item, recording Purchases and
// reporting Run Outs by typing what happened, e.g. “bought kitchen paper” or “dish soap
// ran out”, and each Common Item's card with ⋯ More.
import { Composer, InlineKeyboard, type CallbackQueryContext, type Context } from "grammy";
import type { InlineKeyboardButton } from "grammy/types";
import type { ApartmentGroup } from "./apartment-group.ts";
import type { ChatState, ChatStates } from "./chat-states.ts";
import {
  commonItemName,
  type CommonItem,
  type CommonItems,
  type RecordedPurchase,
  type ReportedRunOut,
  type RotationRoom,
  type RunOut,
  type UncountedPurchase,
} from "./common-items.ts";
import { notifyPurchase, notifyRunOutReported, notifyRunOutRetracted, notifyUncounted, roomLabel } from "./notifier.ts";
import type { Residents } from "./residents.ts";
import { ADD_ITEM, SOMETHING_RAN_OUT } from "./shop-mode.ts";

/** “bought kitchen paper”, “I just got dish soap”: the verb, then what was bought. */
const BOUGHT = /^(?:i\s+)?(?:just\s+)?(?:bought|got|purchased|picked\s+up)\s+(.+)$/i;
/** “dish soap ran out”, “out of coffee”. */
const RAN_OUT = /\b(?:ran|run(?:s)?|running)\s+out\b|^(?:we(?:'re|\s+are)\s+)?out\s+of\b|\bis\s+(?:out|finished|empty)\b/i;

/** The rough guesses on offer, in days. */
const ROUGH_GUESSES: [label: string, days: number][] = [
  ["~1 week", 7],
  ["~2 weeks", 14],
  ["~1 month", 30],
  ["~3 months", 90],
];

/** Common Items for Residents. Only Residents get this far. */
export function commonItemsFlow(
  items: CommonItems,
  residents: Residents,
  apartmentGroup: ApartmentGroup,
  chatStates: ChatStates,
  log: (line: string) => void,
): Composer<Context> {
  const composer = new Composer<Context>();
  const isAdmin = (telegramId: number) => residents.current(telegramId)?.isAdmin ?? false;

  /** The new Common Item this button acts on, or undefined when the button is out of date. */
  const newItemOf = (ctx: Context): Extract<ChatState, { flow: "new-item" }> | undefined => {
    const state = chatStates.get(ctx.chat!.id);
    if (state?.flow !== "new-item" || state.messageId !== ctx.callbackQuery?.message?.message_id) return undefined;
    return state;
  };

  /** Records a Purchase, answers the buyer and tells whoever's Turn it is now. */
  const recordPurchase = async (ctx: Context, itemId: number, answer: (text: string) => Promise<unknown>) => {
    const purchase = items.recordPurchase(ctx.from!.id, itemId);
    if (!purchase) return false;
    await answer(purchaseText(purchase));
    await notifyPurchase(ctx.api, apartmentGroup, purchase, log);
    return true;
  };

  /** Reports a Run Out, answers the reporter and tells the group and the Turn Room. */
  const reportRunOut = async (
    ctx: Context,
    itemId: number,
    answer: (text: string, buttons: InlineKeyboard | undefined) => Promise<unknown>,
  ) => {
    const reporter = ctx.from!.id;
    const report = items.reportRunOut(reporter, itemId);
    if (!report) return false;
    if (report.alreadyReported) {
      await answer(alreadyReportedText(report.runOut, reporter), retractButton(items, report.runOut, reporter));
      return true;
    }
    const text = `⚠️ Reported: ${report.runOut.item.name} ran out.\n${turnLine(report.turn, reporter)}`;
    await answer(text, reportedButtons(report, reporter));
    await notifyRunOutReported(ctx.api, apartmentGroup, report, log);
    return true;
  };

  composer.hears(SOMETHING_RAN_OUT, async (ctx) => {
    const all = items.list();
    const reportable = all.filter((item) => !item.ranOut);
    if (reportable.length === 0) {
      await ctx.reply(
        all.length > 0
          ? `⚠️ Everything is already reported as Run Out. To report something new, tap ${ADD_ITEM} first.`
          : `⚠️ There are no Common Items yet. To report something, tap ${ADD_ITEM} first.`,
      );
      return;
    }
    const buttons = reportable.map((item) => [InlineKeyboard.text(item.name, `runout:report:${item.id}`)]);
    await ctx.reply("⚠️ What ran out?", { reply_markup: InlineKeyboard.from(buttons) });
  });

  composer.hears(ADD_ITEM, async (ctx) => {
    chatStates.set(ctx.chat.id, { flow: "item-name" });
    await ctx.reply("➕ What's the new Common Item? Describe the need, not the brand, e.g. “kitchen paper”.");
  });

  // The name typed after ➕ Add item.
  composer.on("message:text", async (ctx, next) => {
    if (chatStates.get(ctx.chat.id)?.flow !== "item-name") return next();
    const name = commonItemName(ctx.message.text);
    const problem = items.nameProblem(name);
    if (problem) {
      await ctx.reply(`${problem} Send me another name.`);
      return;
    }
    const question = await ctx.reply(roughGuessQuestion(name, items.headcount()), { reply_markup: newItemGuessButtons() });
    chatStates.set(ctx.chat.id, { flow: "new-item", name, messageId: question.message_id });
  });

  composer.callbackQuery(/^item:guess:(\d+|skip)$/, async (ctx) => {
    const state = newItemOf(ctx);
    if (!state) return answerOutOfDate(ctx);
    chatStates.clear(ctx.chat!.id);
    await ctx.answerCallbackQuery();
    // Someone may have added a Common Item with this name since it was typed.
    const problem = items.nameProblem(state.name);
    if (problem) {
      await ctx.editMessageText(problem);
      return;
    }
    const days = ctx.match[1] === "skip" ? null : Number(ctx.match[1]);
    const item = items.add(state.name, days);
    await ctx.editMessageText(
      `➕ Added ${item.name}. Nobody has bought it yet, so there's no Turn: anyone can buy it first.`,
      { reply_markup: new InlineKeyboard().text("✅ I just bought it", `item:bought:${item.id}`) },
    );
  });

  // Free text, the way Residents say what happened. It comes last: any text still here is for it.
  composer.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith("/")) return;
    const ranOut = RAN_OUT.test(text);
    const bought = ranOut ? undefined : text.match(BOUGHT)?.[1];
    const item = items.mentionedIn(bought ?? text);
    if (item?.archived && isAdmin(ctx.from.id)) {
      await ctx.reply(`🗄 ${item.name} is archived.`, {
        reply_markup: new InlineKeyboard().text("♻️ Restore", `item:restore:${item.id}`),
      });
      return;
    }
    if (item?.archived) {
      await ctx.reply(`🗄 ${item.name} is archived. Ask an Admin to restore it.`);
      return;
    }
    if (item && ranOut) {
      await reportRunOut(ctx, item.id, (text, buttons) => ctx.reply(text, { reply_markup: buttons }));
      return;
    }
    if (ranOut) {
      await ctx.reply(
        `I don't know what ran out in “${text}”. Tap ${SOMETHING_RAN_OUT} to pick it, or ${ADD_ITEM} to add it.`,
      );
      return;
    }
    if (item && bought !== undefined) {
      await recordPurchase(ctx, item.id, (text) => ctx.reply(text));
      return;
    }
    if (item) {
      await ctx.reply(itemText(item.name, items.turnOf(item.id), ctx.from.id), { reply_markup: cardButtons(item.id) });
      return;
    }

    // Not a Common Item yet: offer to add it.
    const name = commonItemName(bought ?? text);
    if (items.nameProblem(name) !== null) {
      await ctx.reply(`I don't know “${text}”. To add a new Common Item, tap ${ADD_ITEM}.`);
      return;
    }
    const offer = await ctx.reply(`I don't know “${name}”. Is it a new Common Item?`, {
      reply_markup: new InlineKeyboard().text(`➕ Add “${name}”`, "item:add"),
    });
    chatStates.set(ctx.chat.id, { flow: "new-item", name, messageId: offer.message_id });
  });

  // A Common Item picked after ⚠️ Something ran out.
  composer.callbackQuery(/^runout:report:(\d+)$/, async (ctx) => {
    const reported = await reportRunOut(ctx, Number(ctx.match[1]), async (text, buttons) => {
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(text, { reply_markup: buttons });
    });
    if (!reported) await answerOutOfDate(ctx);
  });

  composer.callbackQuery(/^runout:retract:(\d+)$/, async (ctx) => {
    const runOut = items.openRunOut(Number(ctx.match[1]));
    if (!runOut) return answerOutOfDate(ctx);
    if (!items.mayRetract(ctx.from.id, runOut)) {
      return ctx.answerCallbackQuery("Only whoever reported it or an Admin can retract a Run Out.");
    }
    const retracted = items.retractRunOut(ctx.from.id, runOut.id);
    if (!retracted) return answerOutOfDate(ctx);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(`↩️ Retracted the Run Out of ${retracted.item.name}.`);
    await notifyRunOutRetracted(ctx.api, apartmentGroup, retracted, residents.current(ctx.from.id)!.name, log);
  });

  composer.callbackQuery("item:add", async (ctx) => {
    const state = newItemOf(ctx);
    if (!state) return answerOutOfDate(ctx);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(roughGuessQuestion(state.name, items.headcount()), { reply_markup: newItemGuessButtons() });
  });

  // ✅ I bought it, under a Common Item or a Common Item just added.
  composer.callbackQuery(/^item:bought:(\d+)$/, async (ctx) => {
    const recorded = await recordPurchase(ctx, Number(ctx.match[1]), async (text) => {
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(text);
    });
    if (!recorded) await answerOutOfDate(ctx);
  });

  /**
   * A button on a Common Item's card, whose answer edits the card's message in place.
   * It's out of date once the Common Item is archived.
   */
  const cardButton = (action: string, answer: (ctx: CallbackQueryContext<Context>, item: CommonItem) => Promise<unknown>) =>
    composer.callbackQuery(new RegExp(`^item:${action}:(\\d+)$`), async (ctx) => {
      const item = items.find(Number(ctx.match[1]));
      if (!item) return answerOutOfDate(ctx);
      await ctx.answerCallbackQuery();
      await answer(ctx, item);
    });

  // Voiding is for Admins only.
  composer.callbackQuery(/^item:void(?:-pick|-yes)?:/, async (ctx, next) => {
    if (isAdmin(ctx.from.id)) return next();
    await ctx.answerCallbackQuery("Only Admins can void Purchases.");
  });

  cardButton("card", (ctx, item) =>
    ctx.editMessageText(itemText(item.name, items.turnOf(item.id), ctx.from.id), { reply_markup: cardButtons(item.id) }),
  );

  cardButton("more", (ctx, item) => {
    const buttons = new InlineKeyboard();
    if (items.lastPurchaseBy(ctx.from.id, item.id)) buttons.text("↩️ Undo my last Purchase", `item:undo:${item.id}`).row();
    if (isAdmin(ctx.from.id) && items.recentPurchases(item.id).length > 0) {
      buttons.text("🗑 Void a Purchase", `item:void:${item.id}`).row();
    }
    buttons
      .text("⏱ Change rough guess", `item:reguess:${item.id}`)
      .row()
      .text("🗄 Archive", `item:archive:${item.id}`)
      .row()
      .add(backButton(item.id));
    return ctx.editMessageText(`More for ${item.name}:`, { reply_markup: buttons });
  });

  cardButton("undo", (ctx, item) => {
    const last = items.lastPurchaseBy(ctx.from.id, item.id);
    if (!last) {
      return ctx.editMessageText(`You have no Purchase of ${item.name} to undo.`, {
        reply_markup: InlineKeyboard.from([[backButton(item.id)]]),
      });
    }
    return ctx.editMessageText(`↩️ Undo your Purchase of ${item.name} from ${last.purchasedAt}?`, {
      reply_markup: yesOrKeepIt("Yes, undo it", `item:undo-yes:${last.id}`, item.id),
    });
  });

  cardButton("void", (ctx, item) => {
    const recent = items.recentPurchases(item.id);
    if (recent.length === 0) {
      return ctx.editMessageText(`No Purchase of ${item.name} counts, so there's none to void.`, {
        reply_markup: InlineKeyboard.from([[backButton(item.id)]]),
      });
    }
    const buttons = recent.map((purchase) => [
      InlineKeyboard.text(`${purchase.purchasedAt} · ${purchase.buyerName} (${purchase.roomName})`, `item:void-pick:${purchase.id}`),
    ]);
    return ctx.editMessageText(`🗑 Which Purchase of ${item.name} should no longer count?`, {
      reply_markup: InlineKeyboard.from([...buttons, [backButton(item.id)]]),
    });
  });

  cardButton("reguess", (ctx, item) =>
    ctx.editMessageText(roughGuessQuestion(item.name, items.headcount()), {
      reply_markup: roughGuessButtons((days) => `item:reguess:${item.id}:${days ?? "none"}`, "No guess")
        .row()
        .add(backButton(item.id)),
    }),
  );

  cardButton("archive", (ctx, item) =>
    ctx.editMessageText(
      `🗄 Archive ${item.name}? It leaves the lists and nobody can record Purchases of it, ` +
        "but its history stays. An Admin can restore it.",
      { reply_markup: yesOrKeepIt("Yes, archive it", `item:archive-yes:${item.id}`, item.id) },
    ),
  );

  composer.callbackQuery(/^item:reguess:(\d+):(\d+|none)$/, async (ctx) => {
    const days = ctx.match[2] === "none" ? null : Number(ctx.match[2]);
    const item = items.setRoughGuess(Number(ctx.match[1]), days);
    if (!item) return answerOutOfDate(ctx);
    await ctx.answerCallbackQuery();
    const guess = ROUGH_GUESSES.find(([, guessDays]) => guessDays === days)?.[0];
    await ctx.editMessageText(
      guess === undefined
        ? `⏱ ${item.name} has no rough guess now; I'll learn from real Purchases.`
        : `⏱ Rough guess for ${item.name}: ${guess} for ${forWhom(items.headcount())}.`,
    );
  });

  composer.callbackQuery(/^item:archive-yes:(\d+)$/, async (ctx) => {
    const item = items.archive(Number(ctx.match[1]));
    if (!item) return answerOutOfDate(ctx);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(`🗄 Archived ${item.name}.`);
  });

  composer.callbackQuery(/^item:restore:(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery("Only Admins can restore Common Items.");
    const item = items.restore(ctx.from.id, Number(ctx.match[1]));
    if (!item) return answerOutOfDate(ctx);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(`♻️ Restored ${item.name}.\n${turnLine(items.turnOf(item.id), ctx.from.id)}`, {
      reply_markup: cardButtons(item.id),
    });
  });

  composer.callbackQuery(/^item:undo-yes:(\d+)$/, async (ctx) => {
    const undone = items.undoPurchase(ctx.from.id, Number(ctx.match[1]));
    if (!undone) return answerOutOfDate(ctx);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      `↩️ Undone: your Purchase of ${undone.item.name} no longer counts.\n${uncountedLines(undone, ctx.from.id)}`,
    );
    await notifyUncounted(ctx.api, apartmentGroup, undone, `${residents.current(ctx.from.id)!.name} undid their Purchase`, log);
  });

  composer.callbackQuery(/^item:void-pick:(\d+)$/, async (ctx) => {
    const purchase = items.countingPurchase(Number(ctx.match[1]));
    if (!purchase) return answerOutOfDate(ctx);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      `🗑 Void ${purchase.buyerName}'s Purchase of ${purchase.item.name} from ${purchase.purchasedAt}? It will no longer count.`,
      {
        reply_markup: yesOrKeepIt("Yes, void it", `item:void-yes:${purchase.id}`, purchase.item.id),
      },
    );
  });

  composer.callbackQuery(/^item:void-yes:(\d+)$/, async (ctx) => {
    const purchase = items.countingPurchase(Number(ctx.match[1]));
    const voided = purchase && items.voidPurchase(ctx.from.id, purchase.id);
    if (!purchase || !voided) return answerOutOfDate(ctx);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      `🗑 Voided: ${purchase.buyerName}'s Purchase of ${voided.item.name} no longer counts.\n` +
        uncountedLines(voided, ctx.from.id),
    );
    const how = `${residents.current(ctx.from.id)!.name} voided ${purchase.buyerName}'s Purchase`;
    await notifyUncounted(ctx.api, apartmentGroup, voided, how, log);
  });

  return composer;
}

/** The reply to a Purchase, stating its effect on the Rotation. */
function purchaseText({ item, buyer, startedRotation, outOfTurn, turn, clearedRunOut }: RecordedPurchase): string {
  const lines = [`✅ Recorded: you bought ${item.name}.`];
  if (clearedRunOut) lines.push("The Run Out is cleared.");
  if (startedRotation) lines.push(`You're the first to buy it, so ${buyer.room.name} starts its Rotation.`);
  if (outOfTurn) {
    lines.push(
      `That was out of turn: ${roomLabel(outOfTurn)} still holds the Turn, so ${buyer.room.name} will be skipped later.`,
    );
  } else if (turn) {
    lines.push(`Next Turn: ${turn.id === buyer.room.id ? "your Room again" : roomLabel(turn)}.`);
  }
  return lines.join("\n");
}

/** What's left after undoing or voiding a Purchase: whether it's Run Out again, and whose Turn it is. */
function uncountedLines(uncounted: UncountedPurchase, telegramId: number): string {
  const turn = turnLine(uncounted.turn, telegramId);
  return uncounted.reopenedRunOut ? `${uncounted.item.name} is Run Out again.\n${turn}` : turn;
}

/** The answer to reporting a Common Item that's already reported. */
function alreadyReportedText(runOut: RunOut, telegramId: number): string {
  const by = runOut.reporter.telegramId === telegramId ? "you" : runOut.reporter.name;
  return `⚠️ ${runOut.item.name} is already reported as Run Out, by ${by}.`;
}

/** The buttons under a Run Out just reported: buy it when it's the reporter's to buy, and retract it. */
function reportedButtons({ runOut, turn }: ReportedRunOut, telegramId: number): InlineKeyboard {
  const buttons = new InlineKeyboard();
  const theirsToBuy = turn === null || turn.residents.some((resident) => resident.telegramId === telegramId);
  if (theirsToBuy) buttons.text("✅ I bought it", `item:bought:${runOut.item.id}`).row();
  return buttons.add(retract(runOut));
}

/** A button to retract the Run Out, when this Resident may. */
function retractButton(items: CommonItems, runOut: RunOut, telegramId: number): InlineKeyboard | undefined {
  return items.mayRetract(telegramId, runOut) ? InlineKeyboard.from([[retract(runOut)]]) : undefined;
}

function retract(runOut: RunOut): InlineKeyboardButton {
  return InlineKeyboard.text("↩️ Retract", `runout:retract:${runOut.id}`);
}

/** A Common Item and whose Turn it is to buy it. */
function itemText(name: string, turn: RotationRoom | null, telegramId: number): string {
  return `${name}\n${turnLine(turn, telegramId)}`;
}

/** Whose Turn it is, as this Resident reads it. */
function turnLine(turn: RotationRoom | null, telegramId: number): string {
  if (turn === null) return "No Turn yet: nobody has bought it, so anyone can.";
  const yours = turn.residents.some((resident) => resident.telegramId === telegramId);
  return `Turn: ${yours ? "your Room" : roomLabel(turn)}.`;
}

/** The buttons under a Common Item's card. */
function cardButtons(itemId: number): InlineKeyboard {
  return new InlineKeyboard().text("✅ I bought it", `item:bought:${itemId}`).row().text("⋯ More", `item:more:${itemId}`);
}

/** A button back to a Common Item's card. */
function backButton(itemId: number): InlineKeyboardButton {
  return InlineKeyboard.text("← Back", `item:card:${itemId}`);
}

/** Confirms an action on a Common Item; “No, keep it” goes back to its card. */
function yesOrKeepIt(yes: string, yesData: string, itemId: number): InlineKeyboard {
  return new InlineKeyboard().text(yes, yesData).text("No, keep it", `item:card:${itemId}`);
}

/** The Residents taking part, addressed: “you” or “the 3 of you”. */
function forWhom(headcount: number): string {
  return headcount === 1 ? "you" : `the ${headcount} of you`;
}

function roughGuessQuestion(name: string, headcount: number): string {
  return (
    `Roughly how long does one Purchase of ${name} last for ${forWhom(headcount)}?\n` +
    "A rough guess is fine; I'll learn from real Purchases."
  );
}

/** The rough guesses to pick from for a new Common Item. */
function newItemGuessButtons(): InlineKeyboard {
  return roughGuessButtons((days) => `item:guess:${days ?? "skip"}`, "Skip");
}

/** The rough guesses on offer, then a button for none; `data` gives each button's callback data. */
function roughGuessButtons(data: (days: number | null) => string, noGuess: string): InlineKeyboard {
  const [week, twoWeeks, month, threeMonths] = ROUGH_GUESSES.map(([label, days]) => InlineKeyboard.text(label, data(days)));
  return InlineKeyboard.from([[week!, twoWeeks!], [month!, threeMonths!], [InlineKeyboard.text(noGuess, data(null))]]);
}

/** For a button that no longer matches what it offered. */
async function answerOutOfDate(ctx: Context): Promise<void> {
  await ctx.answerCallbackQuery("This button is out of date.");
}
