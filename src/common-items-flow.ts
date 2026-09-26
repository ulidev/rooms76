// Common Items in Telegram: adding them with ➕ Add item, and recording Purchases
// by typing what happened, e.g. “bought kitchen paper”.
import { Composer, InlineKeyboard, type Context } from "grammy";
import type { ChatState, ChatStates } from "./chat-states.ts";
import { commonItemName, type CommonItems, type RecordedPurchase, type RotationRoom } from "./common-items.ts";
import { notifyPurchase } from "./notifier.ts";
import { ADD_ITEM, RUN_OUTS_COMING_SOON } from "./shop-mode.ts";

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
export function commonItemsFlow(items: CommonItems, chatStates: ChatStates, log: (line: string) => void): Composer<Context> {
  const composer = new Composer<Context>();

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
    await notifyPurchase(ctx.api, purchase, log);
    return true;
  };

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
    const question = await ctx.reply(roughGuessQuestion(name, items.headcount()), { reply_markup: roughGuessButtons() });
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
    if (RAN_OUT.test(text)) {
      await ctx.reply(RUN_OUTS_COMING_SOON);
      return;
    }

    const bought = text.match(BOUGHT)?.[1];
    const item = items.mentionedIn(bought ?? text);
    if (item && bought !== undefined) {
      await recordPurchase(ctx, item.id, (text) => ctx.reply(text));
      return;
    }
    if (item) {
      await ctx.reply(itemText(item.name, items.turnOf(item.id), ctx.from.id), {
        reply_markup: new InlineKeyboard().text("✅ I bought it", `item:bought:${item.id}`),
      });
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

  composer.callbackQuery("item:add", async (ctx) => {
    const state = newItemOf(ctx);
    if (!state) return answerOutOfDate(ctx);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(roughGuessQuestion(state.name, items.headcount()), { reply_markup: roughGuessButtons() });
  });

  // ✅ I bought it, under a Common Item or a Common Item just added.
  composer.callbackQuery(/^item:bought:(\d+)$/, async (ctx) => {
    const recorded = await recordPurchase(ctx, Number(ctx.match[1]), async (text) => {
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(text);
    });
    if (!recorded) await answerOutOfDate(ctx);
  });

  return composer;
}

/** The reply to a Purchase, stating its effect on the Rotation. */
function purchaseText({ item, buyer, startedRotation, outOfTurn, turn }: RecordedPurchase): string {
  const lines = [`✅ Recorded: you bought ${item.name}.`];
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

/** A Common Item and whose Turn it is to buy it. */
function itemText(name: string, turn: RotationRoom | null, telegramId: number): string {
  if (turn === null) return `${name}\nNo Turn yet: nobody has bought it, so anyone can.`;
  const yours = turn.residents.some((resident) => resident.telegramId === telegramId);
  return `${name}\nTurn: ${yours ? "your Room" : roomLabel(turn)}.`;
}

/** A Room and who lives in it, e.g. “Room B (Ana, Tomás)”. */
function roomLabel(room: RotationRoom): string {
  return `${room.name} (${room.residents.map((resident) => resident.name).join(", ")})`;
}

function roughGuessQuestion(name: string, headcount: number): string {
  const forWhom = headcount === 1 ? "you" : `the ${headcount} of you`;
  return (
    `Roughly how long does one Purchase of ${name} last for ${forWhom}?\n` +
    "A rough guess is fine; I'll learn from real Purchases."
  );
}

function roughGuessButtons(): InlineKeyboard {
  const [week, twoWeeks, month, threeMonths] = ROUGH_GUESSES.map(([label, days]) =>
    InlineKeyboard.text(label, `item:guess:${days}`),
  );
  return InlineKeyboard.from([[week!, twoWeeks!], [month!, threeMonths!], [InlineKeyboard.text("Skip", "item:guess:skip")]]);
}

/** For a button that no longer matches what it offered. */
async function answerOutOfDate(ctx: Context): Promise<void> {
  await ctx.answerCallbackQuery("This button is out of date.");
}
