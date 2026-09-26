// The Notifier: turns what the services report into messages for the chats that
// should hear about it. The Apartment Group hears only about Run Outs: reported,
// resolved by a Purchase or retracted, and reopened by undoing that Purchase.
import { InlineKeyboard, type Api } from "grammy";
import type { ApartmentGroup } from "./apartment-group.ts";
import type { RecordedPurchase, ReportedRunOut, RotationRoom, RunOut, UncountedPurchase } from "./common-items.ts";

type Log = (line: string) => void;

/**
 * Tells the Residents of the Room a Purchase passed the Turn to, in their private chats,
 * and the Apartment Group when the Purchase cleared a Run Out.
 */
export async function notifyPurchase(
  api: Api,
  apartmentGroup: ApartmentGroup,
  purchase: RecordedPurchase,
  log: Log,
): Promise<void> {
  if (purchase.clearedRunOut) {
    await notifyApartmentGroup(api, apartmentGroup, `✅ ${purchase.item.name} bought by ${purchase.buyer.name}.`, log);
  }
  if (!purchase.passedTo) return;
  const text = `🔁 ${purchase.buyer.name} bought ${purchase.item.name}. It's now your Turn for it.`;
  for (const resident of purchase.passedTo.residents) {
    await sendPrivately(api, resident.telegramId, text, undefined, log);
  }
}

/**
 * Tells the Apartment Group what ran out and whose Turn it is to buy it, and the Turn
 * Room's Residents, other than the reporter, in their private chats.
 */
export async function notifyRunOutReported(
  api: Api,
  apartmentGroup: ApartmentGroup,
  { runOut, turn }: ReportedRunOut,
  log: Log,
): Promise<void> {
  // The Room and its Residents by name only: an @mention would ping the whole group.
  const whoBuys = turn ? `Turn: ${roomLabel(turn)}.` : "No Turn yet — anyone can buy it.";
  await notifyApartmentGroup(api, apartmentGroup, `⚠️ ${runOut.item.name} ran out.\n${whoBuys}`, log);

  const text = `⚠️ ${runOut.reporter.name} reported that ${runOut.item.name} ran out. It's your Turn to buy it.`;
  // Handled by the Common Items flow, like the same button on a Common Item's card.
  const buttons = new InlineKeyboard().text("✅ I bought it", `item:bought:${runOut.item.id}`);
  for (const resident of turn?.residents ?? []) {
    if (resident.telegramId === runOut.reporter.telegramId) continue;
    await sendPrivately(api, resident.telegramId, text, buttons, log);
  }
}

/** Tells the Apartment Group that a Common Item hasn't run out after all. */
export async function notifyRunOutRetracted(
  api: Api,
  apartmentGroup: ApartmentGroup,
  runOut: RunOut,
  retractedBy: string,
  log: Log,
): Promise<void> {
  const text = `↩️ ${runOut.item.name} hasn't run out after all — retracted by ${retractedBy}.`;
  await notifyApartmentGroup(api, apartmentGroup, text, log);
}

/**
 * Tells the Apartment Group when undoing or voiding a Purchase reopened the Run Out it had
 * cleared. `how` says who did it, e.g. “Ana undid their Purchase”.
 */
export async function notifyUncounted(
  api: Api,
  apartmentGroup: ApartmentGroup,
  uncounted: UncountedPurchase,
  how: string,
  log: Log,
): Promise<void> {
  if (!uncounted.reopenedRunOut) return;
  await notifyApartmentGroup(api, apartmentGroup, `⚠️ ${uncounted.item.name} is out again — ${how}.`, log);
}

/** Posts to the Apartment Group. While no group is linked, nothing is sent and nothing fails. */
export async function notifyApartmentGroup(
  api: Api,
  apartmentGroup: ApartmentGroup,
  text: string,
  log: Log,
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

/** Sends to a Resident's private chat. A Resident who blocked the bot doesn't stop anything else. */
async function sendPrivately(
  api: Api,
  telegramId: number,
  text: string,
  buttons: InlineKeyboard | undefined,
  log: Log,
): Promise<void> {
  try {
    await api.sendMessage(telegramId, text, buttons && { reply_markup: buttons });
  } catch (error) {
    // E.g. they blocked the bot. Whatever happened is recorded either way.
    log(`Couldn't send a private message to ${telegramId}: ${String(error)}`);
  }
}

/** A Room and who lives in it, e.g. “Room B (Ana, Tomás)”. */
export function roomLabel(room: RotationRoom): string {
  return `${room.name} (${room.residents.map((resident) => resident.name).join(", ")})`;
}
