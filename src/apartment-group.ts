// The Apartment Group service: which Telegram group, if any, the bot posts notifications to.
import { eq } from "drizzle-orm";
import type { Db } from "./db/database.ts";
import { apartmentSettings } from "./db/schema.ts";

export interface LinkedGroup {
  chatId: number;
  title: string;
}

export interface ApartmentGroup {
  /** The linked Apartment Group, or null while no group is linked. */
  linked(): LinkedGroup | null;
  /** Links this group as the Apartment Group, in place of any other. */
  link(group: LinkedGroup): void;
  /** Unlinks this group, e.g. once the bot is removed from it. Does nothing when it isn't the linked one. */
  unlink(chatId: number): void;
  /** Follows the linked group to its new chat id, when Telegram upgrades it to a supergroup. */
  followUpgrade(fromChatId: number, toChatId: number): void;
  /** Keeps the linked group's title up to date. Does nothing when it isn't the linked one. */
  retitle(chatId: number, title: string): void;
}

/** The one row of settings. */
const SETTINGS_ID = 1;

export function createApartmentGroup(db: Db): ApartmentGroup {
  const save = (chatId: number | null, title: string | null) =>
    db
      .insert(apartmentSettings)
      .values({ id: SETTINGS_ID, apartmentGroupChatId: chatId, apartmentGroupTitle: title })
      .onConflictDoUpdate({
        target: apartmentSettings.id,
        set: { apartmentGroupChatId: chatId, apartmentGroupTitle: title },
      })
      .run();

  const apartmentGroup: ApartmentGroup = {
    linked() {
      const settings = db.select().from(apartmentSettings).where(eq(apartmentSettings.id, SETTINGS_ID)).get();
      if (settings?.apartmentGroupChatId == null) return null;
      return { chatId: settings.apartmentGroupChatId, title: settings.apartmentGroupTitle ?? "" };
    },

    link: ({ chatId, title }) => save(chatId, title),

    unlink(chatId) {
      if (apartmentGroup.linked()?.chatId === chatId) save(null, null);
    },

    followUpgrade(fromChatId, toChatId) {
      const linked = apartmentGroup.linked();
      if (linked?.chatId === fromChatId) save(toChatId, linked.title);
    },

    retitle(chatId, title) {
      if (apartmentGroup.linked()?.chatId === chatId) save(chatId, title);
    },
  };
  return apartmentGroup;
}
