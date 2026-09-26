// The Notifier: turns what the services report into messages for the chats that
// should hear about it.
import type { Api } from "grammy";
import type { ApartmentGroup } from "./apartment-group.ts";
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

/** Posts to the Apartment Group. While no group is linked, nothing is sent and nothing fails. */
export async function notifyApartmentGroup(
  api: Api,
  apartmentGroup: ApartmentGroup,
  text: string,
  log: (line: string) => void,
): Promise<void> {
  const linked = apartmentGroup.linked();
  if (linked === null) return;
  try {
    await api.sendMessage(linked.chatId, text);
  } catch (error) {
    // E.g. the bot may no longer post there. Whatever happened is recorded either way.
    log(`Couldn't post to the Apartment Group ${linked.chatId}: ${String(error)}`);
  }
}
