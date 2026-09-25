// The Setup service: the first Admin's guided setup of a fresh Apartment.
//
// Setup has two required steps: confirm the Rooms (in Room Order), then pick
// one's own Room. The Apartment is set up once any Stay exists; until then only
// the first Admin, bootstrapped from the Operator's Telegram id, may use the bot.
import { and, asc, eq } from "drizzle-orm";
import { dateIn, type CalendarDate, type Clock } from "./clock.ts";
import type { Db } from "./db/database.ts";
import { persons, rooms, stays } from "./db/schema.ts";

/** Where the Admin setting up stands: the Rooms still to confirm, or their own Room still to pick. */
export type SetupStage = "rooms" | "own-room";

export interface Room {
  id: number;
  name: string;
}

export const MAX_ROOM_NAME_LENGTH = 32;

/** Why a Room can't have this name, or null when it can. Names are compared ignoring case. */
export function roomNameProblem(name: string, takenNames: string[]): string | null {
  if (name.trim() === "") return "Room names can't be empty.";
  if (name.length > MAX_ROOM_NAME_LENGTH) {
    return `“${name}” is too long: Room names have at most ${MAX_ROOM_NAME_LENGTH} characters.`;
  }
  const lower = name.toLowerCase();
  if (takenNames.some((taken) => taken.toLowerCase() === lower)) return `“${name}” is already on the list.`;
  return null;
}

export interface Setup {
  /**
   * Makes the Operator the first Admin of a fresh Apartment. Returns true when it did,
   * false when this isn't the Operator or the Apartment already has an Admin.
   */
  startAsFirstAdmin(telegramId: number, name: string): boolean;
  /** The setup stage this person is in, or null when they aren't setting up the Apartment. */
  stage(telegramId: number): SetupStage | null;
  /** Creates the Rooms; their order becomes the Room Order. */
  confirmRooms(names: string[]): void;
  /** The Rooms in Room Order. */
  rooms(): Room[];
  /**
   * Gives the Admin setting up a Stay in their own Room from today, which completes
   * setup. Returns null when there's no such Room.
   */
  moveIntoOwnRoom(telegramId: number, roomId: number): { room: Room; moveIn: CalendarDate } | null;
}

export function createSetup(db: Db, clock: Clock, apartmentTimeZone: string, operatorTelegramId: number): Setup {
  const isSetUp = () => db.select({ id: stays.id }).from(stays).limit(1).get() !== undefined;
  const hasRooms = () => db.select({ id: rooms.id }).from(rooms).limit(1).get() !== undefined;
  const hasAdmin = () => db.select({ id: persons.id }).from(persons).where(eq(persons.isAdmin, true)).get() !== undefined;
  const adminWithId = (telegramId: number) =>
    db
      .select({ id: persons.id })
      .from(persons)
      .where(and(eq(persons.telegramId, telegramId), eq(persons.isAdmin, true)))
      .get();

  const setup: Setup = {
    startAsFirstAdmin(telegramId, name) {
      if (telegramId !== operatorTelegramId || isSetUp() || hasAdmin()) return false;
      db.insert(persons)
        .values({ telegramId, name, isAdmin: true })
        .onConflictDoUpdate({ target: persons.telegramId, set: { isAdmin: true } })
        .run();
      return true;
    },

    stage(telegramId) {
      if (isSetUp() || !adminWithId(telegramId)) return null;
      return hasRooms() ? "own-room" : "rooms";
    },

    confirmRooms(names) {
      if (names.length === 0) throw new Error("There are no Rooms to confirm");
      names.forEach((name, index) => {
        const problem = roomNameProblem(name, names.slice(0, index));
        if (problem) throw new Error(problem);
      });
      db.transaction((tx) => {
        if (tx.select({ id: rooms.id }).from(rooms).limit(1).get()) throw new Error("The Rooms are already confirmed");
        tx.insert(rooms)
          .values(names.map((name, position) => ({ name, position })))
          .run();
      });
    },

    rooms: () => db.select({ id: rooms.id, name: rooms.name }).from(rooms).orderBy(asc(rooms.position)).all(),

    moveIntoOwnRoom(telegramId, roomId) {
      if (setup.stage(telegramId) !== "own-room") throw new Error("Only the Admin setting up picks their own Room");
      const room = setup.rooms().find((r) => r.id === roomId);
      if (!room) return null;
      const moveIn = dateIn(apartmentTimeZone, clock.now());
      db.insert(stays).values({ personId: adminWithId(telegramId)!.id, roomId: room.id, moveIn }).run();
      return { room, moveIn };
    },
  };
  return setup;
}
