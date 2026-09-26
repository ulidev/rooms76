// Recording and undoing Purchases in Telegram, whichever way a Resident does it: typing
// what they bought, ✅ I bought it, a Common Item's card or the shopping list. Each way
// answers the Resident with the effect and tells whoever should hear about it.
import type { Context } from "grammy";
import type { ApartmentGroup } from "./apartment-group.ts";
import { livesIn, type CommonItems, type RecordedPurchase, type RotationRoom, type UncountedPurchase } from "./common-items.ts";
import { notifyPurchase, notifyUncounted, roomLabel } from "./notifier.ts";
import type { Residents } from "./residents.ts";

/** Shows the Resident a text: a reply, an edit of the message they tapped, or a notification. */
type Answer = (text: string) => Promise<unknown>;

export interface PurchaseReplies {
  /**
   * Records that this Resident bought the Common Item, answers them with its effect on the
   * Rotation and tells whoever should hear. Returns null when there's no such Common Item.
   */
  record(ctx: Context, itemId: number, answer: Answer): Promise<RecordedPurchase | null>;
  /**
   * Undoes this Resident's Purchase, answers them with what's left and tells the Apartment
   * Group when its Run Out is open again. Returns null when it can't be undone.
   */
  undo(ctx: Context, purchaseId: number, answer: Answer): Promise<UncountedPurchase | null>;
}

export function createPurchaseReplies(
  items: CommonItems,
  residents: Residents,
  apartmentGroup: ApartmentGroup,
  log: (line: string) => void,
): PurchaseReplies {
  return {
    async record(ctx, itemId, answer) {
      const purchase = items.recordPurchase(ctx.from!.id, itemId);
      if (!purchase) return null;
      // It's recorded either way, so whoever should hear does even when answering fails.
      try {
        await answer(purchaseText(purchase));
      } finally {
        await notifyPurchase(ctx.api, apartmentGroup, purchase, log);
      }
      return purchase;
    },

    async undo(ctx, purchaseId, answer) {
      const undone = items.undoPurchase(ctx.from!.id, purchaseId);
      if (!undone) return null;
      try {
        await answer(`↩️ Undone: your Purchase of ${undone.item.name} no longer counts.\n${uncountedLines(undone, ctx.from!.id)}`);
      } finally {
        const how = `${residents.current(ctx.from!.id)!.name} undid their Purchase`;
        await notifyUncounted(ctx.api, apartmentGroup, undone, how, log);
      }
      return undone;
    },
  };
}

/** The answer to a Purchase, stating its effect on the Rotation. */
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
export function uncountedLines(uncounted: UncountedPurchase, telegramId: number): string {
  const turn = turnLine(uncounted.turn, telegramId);
  return uncounted.reopenedRunOut ? `${uncounted.item.name} is Run Out again.\n${turn}` : turn;
}

/** Whose Turn it is, as this Resident reads it. */
export function turnLine(turn: RotationRoom | null, telegramId: number): string {
  if (turn === null) return "No Turn yet: nobody has bought it, so anyone can.";
  return `Turn: ${livesIn(turn, telegramId) ? "your Room" : roomLabel(turn)}.`;
}
