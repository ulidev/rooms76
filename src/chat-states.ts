// Per-chat conversation state: which flow a chat is in and what it has gathered so far.
import { eq } from "drizzle-orm";
import type { Db } from "./db/database.ts";
import { chatStates } from "./db/schema.ts";

/** Every flow that spans several messages. Add a variant per flow. */
export type ChatState =
  | {
      flow: "setup-rooms";
      /** The Room names typed so far, in Room Order. */
      rooms: string[];
      /** While reordering: the Rooms tapped so far, in their new order. */
      reordered: string[] | null;
    }
  /** Waiting for a Resident's new name. */
  | { flow: "rename" }
  /** Waiting for an Admin to type the move-in date of an Invite for this Room. */
  | { flow: "invite-date"; roomId: number };

export interface ChatStates {
  get(chatId: number): ChatState | undefined;
  set(chatId: number, state: ChatState): void;
  clear(chatId: number): void;
}

export function createChatStates(db: Db): ChatStates {
  return {
    get: (chatId) => db.select().from(chatStates).where(eq(chatStates.chatId, chatId)).get()?.state,
    set: (chatId, state) =>
      db.insert(chatStates).values({ chatId, state }).onConflictDoUpdate({ target: chatStates.chatId, set: { state } }).run(),
    clear: (chatId) => db.delete(chatStates).where(eq(chatStates.chatId, chatId)).run(),
  };
}
