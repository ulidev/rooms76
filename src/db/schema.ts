// The database schema. Migrations in `migrations/` are generated from this file
// with `npm run db:generate` and committed; they run automatically at startup.
import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
