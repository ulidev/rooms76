// The Residents service: who may use the bot.
import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { dateIn, type Clock } from "./clock.ts";
import type { Db } from "./db/database.ts";
import { persons, rooms, stays } from "./db/schema.ts";

export interface Resident {
  name: string;
  roomName: string;
}

export interface Residents {
  /**
   * The Resident with this Telegram id, or null when they aren't one. A person is a
   * Resident only while they have a current Stay (move-in and move-out days included).
   */
  current(telegramId: number): Resident | null;
}

export function createResidents(db: Db, clock: Clock, apartmentTimeZone: string): Residents {
  return {
    current(telegramId) {
      const today = dateIn(apartmentTimeZone, clock.now());
      const resident = db
        .select({ name: persons.name, roomName: rooms.name })
        .from(stays)
        .innerJoin(persons, eq(persons.id, stays.personId))
        .innerJoin(rooms, eq(rooms.id, stays.roomId))
        .where(
          and(
            eq(persons.telegramId, telegramId),
            lte(stays.moveIn, today),
            or(isNull(stays.moveOut), gte(stays.moveOut, today)),
          ),
        )
        .get();
      return resident ?? null;
    },
  };
}
