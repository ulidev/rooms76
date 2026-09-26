// The Common Items service: what the Apartment buys together, the Purchases of it
// and whose Turn it is to buy it next.
import { and, asc, eq, sql } from "drizzle-orm";
import { dateIn, type Clock } from "./clock.ts";
import type { Db } from "./db/database.ts";
import { commonItems, persons, purchases, rooms, rotationCounts, stays } from "./db/schema.ts";
import { isCurrentStay } from "./residents.ts";
import { complete, reentryCount, turn, type Rotation } from "./rotation.ts";

export interface CommonItem {
  id: number;
  name: string;
}

/** A Room taking part in a Rotation, with the Residents living in it now. */
export interface RotationRoom {
  id: number;
  name: string;
  residents: { telegramId: number; name: string }[];
}

/** What recording a Purchase did to the Common Item's Rotation. */
export interface RecordedPurchase {
  item: CommonItem;
  buyer: { name: string; room: RotationRoom };
  /** True for the Common Item's first Purchase, which made the buyer's Room the Rotation Start. */
  startedRotation: boolean;
  /** For a Purchase out of turn: the Room that held the Turn, and still does. */
  outOfTurn: RotationRoom | null;
  /** Whose Turn it is now. */
  turn: RotationRoom | null;
  /** The Room the Purchase passed the Turn to, whose Residents should hear about it. */
  passedTo: RotationRoom | null;
}

export interface CommonItems {
  /** How many Residents take part in a new Common Item: everyone living in an Occupied Room. */
  headcount(): number;
  /** Why a new Common Item can't be called this, or null when it can. */
  nameProblem(name: string): string | null;
  /**
   * Adds a Common Item. The rough guess, in days for the Residents taking part now,
   * is stored in person-days; null skips it.
   */
  add(name: string, roughGuessDays: number | null): CommonItem;
  /**
   * The Common Item this text mentions, like “kitchen paper” in “2 rolls of kitchen paper”,
   * or null when it mentions none. Plurals match too; the longest name mentioned wins.
   */
  mentionedIn(text: string): CommonItem | null;
  /** Whose Turn it is to buy this Common Item, or null when nobody has bought it yet. */
  turnOf(itemId: number): RotationRoom | null;
  /**
   * Records that this Resident bought the Common Item for their Room. Returns null when
   * there's no such Common Item.
   */
  recordPurchase(telegramId: number, itemId: number): RecordedPurchase | null;
}

export const MAX_COMMON_ITEM_NAME_LENGTH = 64;

/** A Common Item's name as typed, tidied: single spaces and a capital first letter. */
export function commonItemName(text: string): string {
  const name = text.trim().replace(/\s+/g, " ");
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function createCommonItems(db: Db, clock: Clock, apartmentTimeZone: string): CommonItems {
  const today = () => dateIn(apartmentTimeZone, clock.now());

  const itemWithId = (tx: Db, itemId: number) =>
    tx
      .select({ id: commonItems.id, name: commonItems.name, rotationStartRoomId: commonItems.rotationStartRoomId })
      .from(commonItems)
      .where(and(eq(commonItems.id, itemId), eq(commonItems.archived, false)))
      .get();

  /** The Occupied Rooms, with who lives in each now. */
  function occupiedRooms(tx: Db): Map<number, RotationRoom> {
    const rows = tx
      .select({ roomId: rooms.id, roomName: rooms.name, telegramId: persons.telegramId, name: persons.name })
      .from(stays)
      .innerJoin(rooms, eq(rooms.id, stays.roomId))
      .innerJoin(persons, eq(persons.id, stays.personId))
      .where(and(isCurrentStay(today()), eq(rooms.archived, false)))
      .orderBy(asc(stays.moveIn), asc(stays.id))
      .all();
    const occupied = new Map<number, RotationRoom>();
    for (const row of rows) {
      if (!occupied.has(row.roomId)) occupied.set(row.roomId, { id: row.roomId, name: row.roomName, residents: [] });
      occupied.get(row.roomId)!.residents.push({ telegramId: row.telegramId, name: row.name });
    }
    return occupied;
  }

  /**
   * A Common Item's Rotation: every Occupied Room takes part. A Room without a count
   * yet (it wasn't occupied before) enters at the lowest current count.
   */
  function rotationOf(tx: Db, item: { id: number; rotationStartRoomId: number | null }): Rotation<number> {
    const order = tx.select({ id: rooms.id }).from(rooms).orderBy(asc(rooms.position)).all().map((room) => room.id);
    const storedCounts = new Map(
      tx
        .select({ roomId: rotationCounts.roomId, count: rotationCounts.count })
        .from(rotationCounts)
        .where(eq(rotationCounts.commonItemId, item.id))
        .all()
        .map((stored) => [stored.roomId, stored.count]),
    );
    const occupied = [...occupiedRooms(tx).keys()];
    const entryCount = reentryCount(occupied.flatMap((roomId) => storedCounts.get(roomId) ?? []));
    const counts = new Map(occupied.map((roomId) => [roomId, storedCounts.get(roomId) ?? entryCount]));
    return { order, start: item.rotationStartRoomId, counts };
  }

  const items: CommonItems = {
    headcount() {
      return [...occupiedRooms(db).values()].reduce((sum, room) => sum + room.residents.length, 0);
    },

    nameProblem(name) {
      if (name.trim() === "") return "Names can't be empty.";
      if (name.length > MAX_COMMON_ITEM_NAME_LENGTH) {
        return `Common Item names have at most ${MAX_COMMON_ITEM_NAME_LENGTH} characters.`;
      }
      const taken = db
        .select({ name: commonItems.name })
        .from(commonItems)
        .where(sql`lower(${commonItems.name}) = ${name.toLowerCase()}`)
        .get();
      if (taken) return `There's already a Common Item called ${taken.name}.`;
      return null;
    },

    add(name, roughGuessDays) {
      const problem = items.nameProblem(name);
      if (problem) throw new Error(problem);
      const roughGuess = roughGuessDays === null ? null : roughGuessDays * items.headcount();
      return db
        .insert(commonItems)
        .values({ name, roughGuess })
        .returning({ id: commonItems.id, name: commonItems.name })
        .get();
    },

    mentionedIn(text) {
      const mentioned = db
        .select({ id: commonItems.id, name: commonItems.name })
        .from(commonItems)
        .where(eq(commonItems.archived, false))
        .all()
        .filter((item) => mentions(text, item.name));
      return mentioned.sort((a, b) => b.name.length - a.name.length)[0] ?? null;
    },

    turnOf(itemId) {
      const item = itemWithId(db, itemId);
      if (!item) return null;
      const holder = turn(rotationOf(db, item));
      return holder === null ? null : occupiedRooms(db).get(holder)!;
    },

    recordPurchase(telegramId, itemId) {
      return db.transaction((tx) => {
        const item = itemWithId(tx, itemId);
        if (!item) return null;
        const buyer = tx
          .select({ personId: persons.id, name: persons.name, roomId: stays.roomId })
          .from(persons)
          .innerJoin(stays, eq(stays.personId, persons.id))
          .where(and(eq(persons.telegramId, telegramId), isCurrentStay(today())))
          .get();
        if (!buyer) throw new Error("Only Residents record Purchases");

        const purchase = complete(rotationOf(tx, item), buyer.roomId);
        if (purchase.startedRotation) {
          tx.update(commonItems).set({ rotationStartRoomId: buyer.roomId }).where(eq(commonItems.id, item.id)).run();
        }
        // Storing every count also fixes the counts of Rooms that just entered the Rotation.
        for (const [roomId, count] of purchase.rotation.counts) {
          tx.insert(rotationCounts)
            .values({ commonItemId: item.id, roomId, count })
            .onConflictDoUpdate({ target: [rotationCounts.commonItemId, rotationCounts.roomId], set: { count } })
            .run();
        }
        tx.insert(purchases)
          .values({ commonItemId: item.id, roomId: buyer.roomId, personId: buyer.personId, purchasedAt: clock.now() })
          .run();

        const occupied = occupiedRooms(tx);
        const roomWithId = (roomId: number | null) => (roomId === null ? null : occupied.get(roomId)!);
        return {
          item: { id: item.id, name: item.name },
          buyer: { name: buyer.name, room: roomWithId(buyer.roomId)! },
          startedRotation: purchase.startedRotation,
          outOfTurn: roomWithId(purchase.outOfTurn),
          turn: roomWithId(purchase.turn),
          passedTo: roomWithId(purchase.passedTo),
        };
      });
    },
  };
  return items;
}

/** Whether the text mentions this name as whole words, in the singular or plural, ignoring case. */
function mentions(text: string, name: string): boolean {
  const singular = name.toLowerCase().replace(/s$/, "");
  const escaped = singular.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?:e?s)?(?![\\p{L}\\p{N}])`, "iu").test(text);
}
