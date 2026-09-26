// The Residents service: who may use the bot.
import { and, eq, gte, isNull, lte, or, type SQL } from "drizzle-orm";
import { dateIn, type CalendarDate, type Clock } from "./clock.ts";
import type { Db } from "./db/database.ts";
import { persons, rooms, stays } from "./db/schema.ts";

export interface Resident {
  name: string;
  roomName: string;
  isAdmin: boolean;
}

export interface Residents {
  /**
   * The Resident with this Telegram id, or null when they aren't one. A person is a
   * Resident only while they have a current Stay (move-in and move-out days included).
   */
  current(telegramId: number): Resident | null;
  /** Changes a Resident's name, as others see it. */
  rename(telegramId: number, name: string): void;
}

/** Telegram allows first names this long, so every default name fits. */
export const MAX_NAME_LENGTH = 64;

/** Why a Resident can't be called this, or null when they can. */
export function nameProblem(name: string): string | null {
  if (name.trim() === "") return "Names can't be empty.";
  if (name.length > MAX_NAME_LENGTH) return `Names have at most ${MAX_NAME_LENGTH} characters.`;
  return null;
}

/** The SQL condition for Stays that are current on this day (move-in and move-out days included). */
export function isCurrentStay(today: CalendarDate): SQL {
  return and(lte(stays.moveIn, today), or(isNull(stays.moveOut), gte(stays.moveOut, today)))!;
}

export function createResidents(db: Db, clock: Clock, apartmentTimeZone: string): Residents {
  return {
    current(telegramId) {
      const today = dateIn(apartmentTimeZone, clock.now());
      const resident = db
        .select({ name: persons.name, roomName: rooms.name, isAdmin: persons.isAdmin })
        .from(stays)
        .innerJoin(persons, eq(persons.id, stays.personId))
        .innerJoin(rooms, eq(rooms.id, stays.roomId))
        .where(and(eq(persons.telegramId, telegramId), isCurrentStay(today)))
        .get();
      return resident ?? null;
    },

    rename(telegramId, name) {
      const problem = nameProblem(name);
      if (problem) throw new Error(problem);
      db.update(persons).set({ name }).where(eq(persons.telegramId, telegramId)).run();
    },
  };
}
