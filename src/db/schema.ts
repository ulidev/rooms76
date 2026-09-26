// The database schema. Migrations in `migrations/` are generated from this file
// with `npm run db:generate` and committed; they run automatically at startup.
import { sql } from "drizzle-orm";
import { check, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { ChatState } from "../chat-states.ts";

export const rooms = sqliteTable("rooms", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  /** Position in the Room Order, starting at 0. */
  position: integer("position").notNull(),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
});

export const persons = sqliteTable("persons", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  telegramId: integer("telegram_id").notNull().unique(),
  name: text("name").notNull(),
  isAdmin: integer("is_admin", { mode: "boolean" }).notNull().default(false),
});

export const stays = sqliteTable(
  "stays",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    personId: integer("person_id")
      .notNull()
      .references(() => persons.id),
    roomId: integer("room_id")
      .notNull()
      .references(() => rooms.id),
    /** Calendar date (YYYY-MM-DD) in the Apartment time zone. */
    moveIn: text("move_in").notNull(),
    /** Calendar date (YYYY-MM-DD), inclusive. Null while no move-out is planned. */
    moveOut: text("move_out"),
  },
  (table) => [check("move_out_not_before_move_in", sql`${table.moveOut} IS NULL OR ${table.moveOut} >= ${table.moveIn}`)],
);

/** Where each private chat stands in a multi-step flow, so a restart doesn't drop a half-finished flow. */
export const chatStates = sqliteTable("chat_states", {
  chatId: integer("chat_id").primaryKey(),
  state: text("state", { mode: "json" }).$type<ChatState>().notNull(),
});

/**
 * A single-use link that makes whoever opens it a Resident of a Room. Pending until
 * it's used or revoked; a pending Invite past its expiry counts as expired.
 */
export const invites = sqliteTable("invites", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** The `start` parameter of the Invite link. */
  token: text("token").notNull().unique(),
  roomId: integer("room_id")
    .notNull()
    .references(() => rooms.id),
  /** Calendar date (YYYY-MM-DD) in the Apartment time zone; the Stay starts on it. */
  moveIn: text("move_in").notNull(),
  createdBy: integer("created_by")
    .notNull()
    .references(() => persons.id),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  state: text("state", { enum: ["pending", "used", "revoked"] })
    .notNull()
    .default("pending"),
  /** The person who opened it, once used. */
  usedBy: integer("used_by").references(() => persons.id),
});

/** Something the Apartment buys collectively, described generically (e.g. "Kitchen paper"). */
export const commonItems = sqliteTable("common_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  /**
   * The rough guess of how long one Purchase lasts, in person-days: the guessed days
   * times the Residents taking part when it was set. Null when it was skipped.
   */
  roughGuess: integer("rough_guess"),
  /** The Room that made the first Purchase; the Room Order is counted from it. Null until then. */
  rotationStartRoomId: integer("rotation_start_room_id").references(() => rooms.id),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
});

/**
 * A Room taking part in a Common Item's Rotation, with its count of Purchases. The count is
 * stored, not derived from the Purchases, because a Room entering a Rotation starts at
 * the lowest current count.
 */
export const rotationCounts = sqliteTable(
  "rotation_counts",
  {
    commonItemId: integer("common_item_id")
      .notNull()
      .references(() => commonItems.id),
    roomId: integer("room_id")
      .notNull()
      .references(() => rooms.id),
    count: integer("count").notNull(),
  },
  (table) => [primaryKey({ columns: [table.commonItemId, table.roomId] })],
);

/** A Resident recording that they bought a Common Item on behalf of their Room. */
export const purchases = sqliteTable("purchases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  commonItemId: integer("common_item_id")
    .notNull()
    .references(() => commonItems.id),
  roomId: integer("room_id")
    .notNull()
    .references(() => rooms.id),
  personId: integer("person_id")
    .notNull()
    .references(() => persons.id),
  purchasedAt: integer("purchased_at", { mode: "timestamp_ms" }).notNull(),
  /** When the buyer undid it. An undone Purchase no longer counts. */
  undoneAt: integer("undone_at", { mode: "timestamp_ms" }),
  /** When an Admin voided it. A voided Purchase no longer counts. */
  voidedAt: integer("voided_at", { mode: "timestamp_ms" }),
  /** The Admin who voided it. */
  voidedBy: integer("voided_by").references(() => persons.id),
});

/**
 * A Resident reporting that a Common Item is finished. It's open until a Purchase clears it
 * or it's retracted; a Common Item has at most one open Run Out.
 */
export const runOuts = sqliteTable(
  "run_outs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    commonItemId: integer("common_item_id")
      .notNull()
      .references(() => commonItems.id),
    reportedBy: integer("reported_by")
      .notNull()
      .references(() => persons.id),
    reportedAt: integer("reported_at", { mode: "timestamp_ms" }).notNull(),
    /** The Purchase that cleared it. Undoing or voiding that Purchase may reopen it. */
    clearedBy: integer("cleared_by").references(() => purchases.id),
    /** When the reporter or an Admin retracted it. */
    retractedAt: integer("retracted_at", { mode: "timestamp_ms" }),
    /** Who retracted it. */
    retractedBy: integer("retracted_by").references(() => persons.id),
  },
  (table) => [
    uniqueIndex("one_open_run_out_per_item")
      .on(table.commonItemId)
      .where(sql`cleared_by IS NULL AND retracted_at IS NULL`),
  ],
);

/** Settings of the Apartment as a whole. It has exactly one row, with id 1, once anything is set. */
export const apartmentSettings = sqliteTable(
  "apartment_settings",
  {
    id: integer("id").primaryKey(),
    /** The chat id of the linked Apartment Group. Null while no group is linked. */
    apartmentGroupChatId: integer("apartment_group_chat_id"),
    /** The Apartment Group's title, as last seen. */
    apartmentGroupTitle: text("apartment_group_title"),
  },
  (table) => [check("single_row", sql`${table.id} = 1`)],
);
