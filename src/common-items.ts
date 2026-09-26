// The Common Items service: what the Apartment buys together, the Purchases of it,
// whose Turn it is to buy it next and whether it ran out.
import { and, asc, desc, eq, gt, isNull, sql, type SQL } from "drizzle-orm";
import { addDays, dateIn, formatInstant, startOfDay, type Clock } from "./clock.ts";
import type { Db } from "./db/database.ts";
import { commonItems, persons, purchases, rooms, rotationCounts, runOuts, stays } from "./db/schema.ts";
import { isCurrentStay, type Residents } from "./residents.ts";
import { complete, reentryCount, turn, type Rotation } from "./rotation.ts";
import { assess, byUrgency, type StaySpan, type Urgency } from "./urgency.ts";

export interface CommonItem {
  id: number;
  name: string;
}

/** A Common Item mentioned in a text, archived or not. */
export interface MentionedItem extends CommonItem {
  archived: boolean;
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
  /** True when the Purchase cleared the Common Item's Run Out. */
  clearedRunOut: boolean;
}

/** A Purchase that still counts: neither undone nor voided. */
export interface CountingPurchase {
  id: number;
  item: CommonItem;
  buyerName: string;
  /** The Room it was bought for. */
  roomName: string;
  /** When it was bought, in the Apartment time zone, e.g. “26 Sep 2026, 09:05”. */
  purchasedAt: string;
}

/** What undoing or voiding a Purchase left behind. */
export interface UncountedPurchase {
  item: CommonItem;
  /** Whose Turn it is now, or null when no Purchase of the Common Item counts any more. */
  turn: RotationRoom | null;
  /** True when the Purchase had cleared a Run Out, which is open again now. */
  reopenedRunOut: boolean;
}

/** A Common Item in the list of all of them. */
export interface ListedItem extends CommonItem {
  /** True while it's reported as Run Out. */
  ranOut: boolean;
}

/** An open Run Out: a Common Item reported as Run Out, neither bought since nor retracted. */
export interface RunOut {
  id: number;
  item: CommonItem;
  reporter: { telegramId: number; name: string };
}

/** What reporting a Run Out did. */
export interface ReportedRunOut {
  /** The open Run Out of the Common Item: the one just reported, or the one reported before. */
  runOut: RunOut;
  /** True when the Common Item was reported already, so nothing changed. */
  alreadyReported: boolean;
  /** Whose Turn it is to buy the Common Item, or null when nobody has bought it yet. */
  turn: RotationRoom | null;
}

/** A line on the shopping list: a Common Item and how pressing it is. */
export interface ShoppingListLine extends CommonItem {
  urgency: Urgency;
  /** True when there's no Expected Duration yet, so it can't become Due soon. */
  noEstimate: boolean;
}

/** What a Resident should buy, each section most pressing first. */
export interface ShoppingList {
  /** Run Out or Due soon, and their Room's Turn. */
  yourTurn: ShoppingListLine[];
  /** Run Out, and nobody's Turn yet. */
  anyone: ShoppingListLine[];
  /** Not yet, and their Room's Turn. */
  yourTurnLater: ShoppingListLine[];
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
   * Changes a Common Item's rough guess, given in days for the Residents taking part now;
   * null drops it. Returns null when there's no such Common Item.
   */
  setRoughGuess(itemId: number, roughGuessDays: number | null): CommonItem | null;
  /**
   * Archives a Common Item: it leaves the lists and its Rotation, and nobody can record
   * Purchases of it, but its Purchases and counts stay. Returns null when there's no such
   * Common Item, or it's already archived.
   */
  archive(itemId: number): CommonItem | null;
  /**
   * Restores an archived Common Item as it was. Only Admins restore Common Items. Returns
   * null when there's no such archived Common Item.
   */
  restore(adminTelegramId: number, itemId: number): CommonItem | null;
  /** The Common Item with this id, or null when there's none or it's archived. */
  find(itemId: number): CommonItem | null;
  /**
   * The Common Item this text mentions, like “kitchen paper” in “2 rolls of kitchen paper”,
   * or null when it mentions none. Plurals match too; the longest name mentioned wins.
   * Archived Common Items count too, so they can be told apart from unknown ones.
   */
  mentionedIn(text: string): MentionedItem | null;
  /** Whose Turn it is to buy this Common Item, or null when nobody has bought it yet. */
  turnOf(itemId: number): RotationRoom | null;
  /**
   * Records that this Resident bought the Common Item for their Room. Returns null when
   * there's no such Common Item.
   */
  recordPurchase(telegramId: number, itemId: number): RecordedPurchase | null;
  /** This Resident's last Purchase of the Common Item that still counts, or null when they have none. */
  lastPurchaseBy(telegramId: number, itemId: number): CountingPurchase | null;
  /**
   * Undoes a Purchase, so it no longer counts. Only the buyer undoes a Purchase, and only
   * their last one of that Common Item: returns null when it isn't that any more.
   */
  undoPurchase(telegramId: number, purchaseId: number): UncountedPurchase | null;
  /** The last few Purchases of the Common Item that still count, newest first. */
  recentPurchases(itemId: number): CountingPurchase[];
  /** The Purchase with this id, or null when it no longer counts. */
  countingPurchase(purchaseId: number): CountingPurchase | null;
  /**
   * Voids anyone's Purchase, so it no longer counts. Only Admins void Purchases. Returns
   * null when it no longer counted anyway.
   */
  voidPurchase(adminTelegramId: number, purchaseId: number): UncountedPurchase | null;
  /** The Common Items not archived, by name. */
  list(): ListedItem[];
  /**
   * What this Resident should buy: their Room's Turn and what anyone may buy, by Urgency.
   * Null when there are no Common Items at all.
   */
  shoppingList(telegramId: number): ShoppingList | null;
  /**
   * Reports that a Common Item ran out. Returns null when there's no such Common Item.
   * A Common Item already reported stays as it was.
   */
  reportRunOut(telegramId: number, itemId: number): ReportedRunOut | null;
  /** The Run Out with this id while it's open, or null once it's cleared or retracted. */
  openRunOut(runOutId: number): RunOut | null;
  /** Whether this Resident may retract the Run Out: they reported it, or they're an Admin. */
  mayRetract(telegramId: number, runOut: RunOut): boolean;
  /**
   * Retracts a Run Out: the Common Item hasn't run out after all. Only its reporter and
   * Admins retract it. Returns null when it isn't open any more.
   */
  retractRunOut(telegramId: number, runOutId: number): RunOut | null;
}

/** How many of the latest Purchases an Admin picks from to void one. */
const PURCHASES_TO_VOID_FROM = 5;

export const MAX_COMMON_ITEM_NAME_LENGTH = 64;

/** A Common Item's name as typed, tidied: single spaces and a capital first letter. */
export function commonItemName(text: string): string {
  const name = text.trim().replace(/\s+/g, " ");
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function createCommonItems(
  db: Db,
  clock: Clock,
  apartmentTimeZone: string,
  residents: Residents,
): CommonItems {
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

  /**
   * Stops a Purchase counting, and says whose Turn it is now. Its Room's count goes back
   * down. The Rotation Start is the Room of the first Purchase that still counts; with
   * none left, the Rotation starts over. A Run Out the Purchase cleared is open again,
   * unless the Common Item was bought since or reported again.
   */
  function uncount(tx: Db, purchase: { id: number; commonItemId: number; roomId: number }): UncountedPurchase {
    tx.update(rotationCounts)
      .set({ count: sql`max(${rotationCounts.count} - 1, 0)` })
      .where(and(eq(rotationCounts.commonItemId, purchase.commonItemId), eq(rotationCounts.roomId, purchase.roomId)))
      .run();
    const first = tx
      .select({ roomId: purchases.roomId })
      .from(purchases)
      .where(and(eq(purchases.commonItemId, purchase.commonItemId), stillCounts()))
      .orderBy(asc(purchases.purchasedAt), asc(purchases.id))
      .get();
    if (!first) tx.delete(rotationCounts).where(eq(rotationCounts.commonItemId, purchase.commonItemId)).run();
    tx.update(commonItems)
      .set({ rotationStartRoomId: first?.roomId ?? null })
      .where(eq(commonItems.id, purchase.commonItemId))
      .run();
    const boughtSince = tx
      .select({ id: purchases.id })
      .from(purchases)
      .where(and(eq(purchases.commonItemId, purchase.commonItemId), gt(purchases.id, purchase.id), stillCounts()))
      .get();
    let reopenedRunOut = false;
    if (!boughtSince && !openRunOutOf(tx, purchase.commonItemId)) {
      const reopened = tx.update(runOuts).set({ clearedBy: null }).where(eq(runOuts.clearedBy, purchase.id)).returning().get();
      reopenedRunOut = reopened !== undefined;
    }
    const item = itemWithId(tx, purchase.commonItemId)!;
    return { item: { id: item.id, name: item.name }, turn: currentTurn(tx, item), reopenedRunOut };
  }

  /** The open Run Out that meets this condition, of a Common Item not archived, or null when there's none. */
  function openRunOutWhere(tx: Db, condition: SQL): RunOut | null {
    const runOut = tx
      .select({
        id: runOuts.id,
        itemId: commonItems.id,
        itemName: commonItems.name,
        reporterTelegramId: persons.telegramId,
        reporterName: persons.name,
      })
      .from(runOuts)
      .innerJoin(commonItems, eq(commonItems.id, runOuts.commonItemId))
      .innerJoin(persons, eq(persons.id, runOuts.reportedBy))
      .where(and(condition, isOpen(), eq(commonItems.archived, false)))
      .get();
    if (!runOut) return null;
    return {
      id: runOut.id,
      item: { id: runOut.itemId, name: runOut.itemName },
      reporter: { telegramId: runOut.reporterTelegramId, name: runOut.reporterName },
    };
  }

  /** The Common Item's open Run Out, or null when it hasn't run out. */
  function openRunOutOf(tx: Db, itemId: number): RunOut | null {
    return openRunOutWhere(tx, eq(runOuts.commonItemId, itemId));
  }

  /** The id of this Resident's person, whether or not they live here now. */
  function personIdOf(tx: Db, telegramId: number): number {
    return tx.select({ id: persons.id }).from(persons).where(eq(persons.telegramId, telegramId)).get()!.id;
  }

  /** Whose Turn it is to buy this Common Item, or null when nobody has bought it yet. */
  function currentTurn(tx: Db, item: { id: number; rotationStartRoomId: number | null }): RotationRoom | null {
    const holder = turn(rotationOf(tx, item));
    return holder === null ? null : occupiedRooms(tx).get(holder)!;
  }

  /** The Purchases that still count and meet this condition, newest first, of Common Items not archived. */
  function countingPurchases(tx: Db, condition: SQL, limit: number): CountingPurchase[] {
    return tx
      .select({
        id: purchases.id,
        itemId: commonItems.id,
        itemName: commonItems.name,
        buyerName: persons.name,
        roomName: rooms.name,
        purchasedAt: purchases.purchasedAt,
      })
      .from(purchases)
      .innerJoin(persons, eq(persons.id, purchases.personId))
      .innerJoin(rooms, eq(rooms.id, purchases.roomId))
      .innerJoin(commonItems, eq(commonItems.id, purchases.commonItemId))
      .where(and(condition, stillCounts(), eq(commonItems.archived, false)))
      .orderBy(desc(purchases.purchasedAt), desc(purchases.id))
      .limit(limit)
      .all()
      .map((purchase) => ({
        id: purchase.id,
        item: { id: purchase.itemId, name: purchase.itemName },
        buyerName: purchase.buyerName,
        roomName: purchase.roomName,
        purchasedAt: formatInstant(apartmentTimeZone, purchase.purchasedAt),
      }));
  }

  /** This Resident's last Purchase of the Common Item that still counts. */
  function lastPurchase(tx: Db, telegramId: number, itemId: number): CountingPurchase | null {
    return countingPurchases(tx, and(eq(persons.telegramId, telegramId), eq(purchases.commonItemId, itemId))!, 1)[0] ?? null;
  }

  /**
   * When each Resident lived here: every Stay, from the start of its move-in day to the end
   * of its move-out day. Rooms archived since still count for the time they were lived in.
   */
  function staySpans(tx: Db): StaySpan[] {
    return tx
      .select({ moveIn: stays.moveIn, moveOut: stays.moveOut })
      .from(stays)
      .all()
      .map((stay) => ({
        from: startOfDay(apartmentTimeZone, stay.moveIn).getTime(),
        to: stay.moveOut === null ? null : startOfDay(apartmentTimeZone, addDays(stay.moveOut, 1)).getTime(),
      }));
  }

  /** When each Purchase that still counts was made, by Common Item. */
  function purchaseTimesByItem(tx: Db): Map<number, number[]> {
    const times = new Map<number, number[]>();
    const counting = tx
      .select({ itemId: purchases.commonItemId, purchasedAt: purchases.purchasedAt })
      .from(purchases)
      .where(stillCounts())
      .all();
    for (const purchase of counting) {
      if (!times.has(purchase.itemId)) times.set(purchase.itemId, []);
      times.get(purchase.itemId)!.push(purchase.purchasedAt.getTime());
    }
    return times;
  }

  /** The Common Items not archived, with whose Turn it is and how pressing each is now, most pressing first. */
  function assessedItems(tx: Db) {
    const now = clock.now().getTime();
    const headcountNow = items.headcount();
    const spans = staySpans(tx);
    const purchaseTimes = purchaseTimesByItem(tx);
    return tx
      .select({
        id: commonItems.id,
        name: commonItems.name,
        roughGuess: commonItems.roughGuess,
        rotationStartRoomId: commonItems.rotationStartRoomId,
        runOutSince: runOuts.reportedAt,
      })
      .from(commonItems)
      .leftJoin(runOuts, and(eq(runOuts.commonItemId, commonItems.id), isOpen()))
      .where(eq(commonItems.archived, false))
      .all()
      .map((item) => ({
        item,
        turn: currentTurn(tx, item),
        assessment: assess({
          purchases: purchaseTimes.get(item.id) ?? [],
          stays: spans,
          roughGuess: item.roughGuess,
          headcountNow,
          runOutSince: item.runOutSince?.getTime() ?? null,
          now,
        }),
      }))
      .sort((a, b) => byUrgency(a.assessment, b.assessment));
  }

  /** Archives or restores a Common Item. Returns null when there's none that isn't that already. */
  function setArchived(itemId: number, archived: boolean): CommonItem | null {
    const item = db
      .update(commonItems)
      .set({ archived })
      .where(and(eq(commonItems.id, itemId), eq(commonItems.archived, !archived)))
      .returning({ id: commonItems.id, name: commonItems.name })
      .get();
    return item ?? null;
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
        .select({ name: commonItems.name, archived: commonItems.archived })
        .from(commonItems)
        .where(sql`lower(${commonItems.name}) = ${name.toLowerCase()}`)
        .get();
      if (taken?.archived) {
        return `There's already a Common Item called ${taken.name}, but it's archived: an Admin can restore it.`;
      }
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

    find(itemId) {
      const item = itemWithId(db, itemId);
      return item ? { id: item.id, name: item.name } : null;
    },

    setRoughGuess(itemId, roughGuessDays) {
      const roughGuess = roughGuessDays === null ? null : roughGuessDays * items.headcount();
      const item = db
        .update(commonItems)
        .set({ roughGuess })
        .where(and(eq(commonItems.id, itemId), eq(commonItems.archived, false)))
        .returning({ id: commonItems.id, name: commonItems.name })
        .get();
      return item ?? null;
    },

    archive(itemId) {
      return setArchived(itemId, true);
    },

    restore(adminTelegramId, itemId) {
      if (!residents.current(adminTelegramId)?.isAdmin) throw new Error("Only Admins restore Common Items");
      return setArchived(itemId, false);
    },

    mentionedIn(text) {
      const mentioned = db
        .select({ id: commonItems.id, name: commonItems.name, archived: commonItems.archived })
        .from(commonItems)
        .all()
        .filter((item) => mentions(text, item.name));
      return mentioned.sort((a, b) => b.name.length - a.name.length)[0] ?? null;
    },

    turnOf(itemId) {
      const item = itemWithId(db, itemId);
      return item ? currentTurn(db, item) : null;
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
        const recorded = tx
          .insert(purchases)
          .values({ commonItemId: item.id, roomId: buyer.roomId, personId: buyer.personId, purchasedAt: clock.now() })
          .returning({ id: purchases.id })
          .get();
        // Any Purchase clears the Run Out, whoever's Turn it was.
        const cleared = tx
          .update(runOuts)
          .set({ clearedBy: recorded.id })
          .where(and(eq(runOuts.commonItemId, item.id), isOpen()))
          .returning()
          .get();

        const occupied = occupiedRooms(tx);
        const roomWithId = (roomId: number | null) => (roomId === null ? null : occupied.get(roomId)!);
        return {
          item: { id: item.id, name: item.name },
          buyer: { name: buyer.name, room: roomWithId(buyer.roomId)! },
          startedRotation: purchase.startedRotation,
          outOfTurn: roomWithId(purchase.outOfTurn),
          turn: roomWithId(purchase.turn),
          passedTo: roomWithId(purchase.passedTo),
          clearedRunOut: cleared !== undefined,
        };
      });
    },

    lastPurchaseBy(telegramId, itemId) {
      return lastPurchase(db, telegramId, itemId);
    },

    recentPurchases(itemId) {
      return countingPurchases(db, eq(purchases.commonItemId, itemId), PURCHASES_TO_VOID_FROM);
    },

    countingPurchase(purchaseId) {
      return countingPurchases(db, eq(purchases.id, purchaseId), 1)[0] ?? null;
    },

    undoPurchase(telegramId, purchaseId) {
      return db.transaction((tx) => {
        const purchase = tx.select().from(purchases).where(eq(purchases.id, purchaseId)).get();
        const item = purchase && itemWithId(tx, purchase.commonItemId);
        if (!purchase || !item || lastPurchase(tx, telegramId, item.id)?.id !== purchase.id) return null;
        tx.update(purchases).set({ undoneAt: clock.now() }).where(eq(purchases.id, purchase.id)).run();
        return uncount(tx, purchase);
      });
    },

    voidPurchase(adminTelegramId, purchaseId) {
      if (!residents.current(adminTelegramId)?.isAdmin) throw new Error("Only Admins void Purchases");
      return db.transaction((tx) => {
        const purchase = tx
          .select()
          .from(purchases)
          .where(and(eq(purchases.id, purchaseId), stillCounts()))
          .get();
        const item = purchase && itemWithId(tx, purchase.commonItemId);
        if (!purchase || !item) return null;
        tx.update(purchases)
          .set({ voidedAt: clock.now(), voidedBy: personIdOf(tx, adminTelegramId) })
          .where(eq(purchases.id, purchase.id))
          .run();
        return uncount(tx, purchase);
      });
    },

    list() {
      return db
        .select({ id: commonItems.id, name: commonItems.name, runOutId: runOuts.id })
        .from(commonItems)
        .leftJoin(runOuts, and(eq(runOuts.commonItemId, commonItems.id), isOpen()))
        .where(eq(commonItems.archived, false))
        .orderBy(asc(sql`lower(${commonItems.name})`))
        .all()
        .map((item) => ({ id: item.id, name: item.name, ranOut: item.runOutId !== null }));
    },

    shoppingList(telegramId) {
      const assessed = assessedItems(db);
      if (assessed.length === 0) return null;
      const list: ShoppingList = { yourTurn: [], anyone: [], yourTurnLater: [] };
      for (const { item, turn, assessment } of assessed) {
        const line = {
          id: item.id,
          name: item.name,
          urgency: assessment.urgency,
          noEstimate: assessment.expectedDuration === null,
        };
        const yours = turn?.residents.some((resident) => resident.telegramId === telegramId) ?? false;
        if (yours && assessment.urgency === "not-yet") list.yourTurnLater.push(line);
        else if (yours) list.yourTurn.push(line);
        else if (turn === null && assessment.urgency === "run-out") list.anyone.push(line);
      }
      return list;
    },

    reportRunOut(telegramId, itemId) {
      return db.transaction((tx) => {
        const item = itemWithId(tx, itemId);
        if (!item) return null;
        const alreadyOpen = openRunOutOf(tx, item.id);
        if (!alreadyOpen) {
          tx.insert(runOuts)
            .values({ commonItemId: item.id, reportedBy: personIdOf(tx, telegramId), reportedAt: clock.now() })
            .run();
        }
        const runOut = alreadyOpen ?? openRunOutOf(tx, item.id)!;
        return { runOut, alreadyReported: alreadyOpen !== null, turn: currentTurn(tx, item) };
      });
    },

    openRunOut(runOutId) {
      return openRunOutWhere(db, eq(runOuts.id, runOutId));
    },

    mayRetract(telegramId, runOut) {
      return runOut.reporter.telegramId === telegramId || (residents.current(telegramId)?.isAdmin ?? false);
    },

    retractRunOut(telegramId, runOutId) {
      return db.transaction((tx) => {
        const runOut = openRunOutWhere(tx, eq(runOuts.id, runOutId));
        if (!runOut) return null;
        if (!items.mayRetract(telegramId, runOut)) throw new Error("Only the reporter or an Admin retracts a Run Out");
        tx.update(runOuts)
          .set({ retractedAt: clock.now(), retractedBy: personIdOf(tx, telegramId) })
          .where(eq(runOuts.id, runOut.id))
          .run();
        return runOut;
      });
    },
  };
  return items;
}

/** The SQL condition for Purchases that still count: neither undone nor voided. */
function stillCounts() {
  return and(isNull(purchases.undoneAt), isNull(purchases.voidedAt));
}

/** The SQL condition for Run Outs that are open: neither cleared by a Purchase nor retracted. */
function isOpen() {
  return and(isNull(runOuts.clearedBy), isNull(runOuts.retractedAt));
}

/** Whether the text mentions this name as whole words, in the singular or plural, ignoring case. */
function mentions(text: string, name: string): boolean {
  const singular = name.toLowerCase().replace(/s$/, "");
  const escaped = singular.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?:e?s)?(?![\\p{L}\\p{N}])`, "iu").test(text);
}
