// The Notifier: turns what the services report into messages for the chats that
// should hear about it.
import type { Api } from "grammy";
import type { RecordedPurchase } from "./common-items.ts";

/** Tells the Residents of the Room a Purchase passed the Turn to, in their private chats. */
export async function notifyPurchase(api: Api, purchase: RecordedPurchase, log: (line: string) => void): Promise<void> {
  if (!purchase.passedTo) return;
  const text = `🔁 ${purchase.buyer.name} bought ${purchase.item.name}. It's now your Turn for it.`;
  for (const resident of purchase.passedTo.residents) {
    try {
      await api.sendMessage(resident.telegramId, text);
    } catch (error) {
      // E.g. they blocked the bot. The Purchase is recorded either way.
      log(`Couldn't tell ${resident.telegramId} it's their Turn: ${String(error)}`);
    }
  }
}
