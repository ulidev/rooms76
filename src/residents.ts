// The Residents service: who may use the bot.
import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { dateIn, type Clock } from "./clock.ts";
import type { Db } from "./db/database.ts";
import { persons, stays } from "./db/schema.ts";

export interface Residents {
  /** A person is a Resident only while they have a current Stay (move-in and move-out days included). */
  isResident(telegramId: number): boolean;
}

export function createResidents(db: Db, clock: Clock, apartmentTimeZone: string): Residents {
  return {
    isResident(telegramId) {
      const today = dateIn(apartmentTimeZone, clock.now());
      const currentStay = db
        .select({ id: stays.id })
        .from(stays)
        .innerJoin(persons, eq(persons.id, stays.personId))
        .where(
          and(
            eq(persons.telegramId, telegramId),
            lte(stays.moveIn, today),
            or(isNull(stays.moveOut), gte(stays.moveOut, today)),
          ),
        )
        .get();
      return currentStay !== undefined;
    },
  };
}
