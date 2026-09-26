// The shopping lists open in private chats: what each list showed when it was opened and
// what's ticked on it, so each tap can edit the list in place.
import { eq } from "drizzle-orm";
import { DAY, type Clock } from "./clock.ts";
import type { ShoppingList } from "./common-items.ts";
import type { Db } from "./db/database.ts";
import { shoppingLists } from "./db/schema.ts";

/** How long a shopping list stays open: one trip to the shop, not the next one. */
const SHOPPING_TRIP = DAY / 2;

/** A ticked line, with the Purchase ticking it recorded. */
export interface Tick {
  itemId: number;
  purchaseId: number;
}

/** A shopping list open in a private chat. A chat has at most one: opening another replaces it. */
export interface OpenShoppingList {
  /** The bot message showing it; buttons on any other message are out of date. */
  messageId: number;
  /** When it was opened, in milliseconds since the epoch. */
  openedAt: number;
  /** The sections as they were when it was opened. They stay put while the Resident ticks lines. */
  sections: ShoppingList;
  /** True once ➕ Something else… shows every Common Item off the list. */
  expanded: boolean;
  ticks: Tick[];
}

export interface ShoppingLists {
  /** The chat's open shopping list, or undefined when there's none or it's older than one shopping trip. */
  get(chatId: number): OpenShoppingList | undefined;
  set(chatId: number, list: OpenShoppingList): void;
  clear(chatId: number): void;
}

export function createShoppingLists(db: Db, clock: Clock): ShoppingLists {
  return {
    get: (chatId) => {
      const list = db.select().from(shoppingLists).where(eq(shoppingLists.chatId, chatId)).get()?.list;
      if (list && clock.now().getTime() - list.openedAt >= SHOPPING_TRIP) return undefined;
      return list;
    },
    set: (chatId, list) =>
      db.insert(shoppingLists).values({ chatId, list }).onConflictDoUpdate({ target: shoppingLists.chatId, set: { list } }).run(),
    clear: (chatId) => db.delete(shoppingLists).where(eq(shoppingLists.chatId, chatId)).run(),
  };
}
