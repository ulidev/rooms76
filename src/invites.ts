// The Invites service: how Admins let new Residents in.
//
// An Admin creates an Invite for a Room with a move-in date (today or earlier).
// It's a single-use link that expires after 7 days and can be revoked while pending.
import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import { dateIn, type CalendarDate, type Clock } from "./clock.ts";
import type { Db } from "./db/database.ts";
import { invites, persons, rooms, stays } from "./db/schema.ts";
import type { Residents } from "./residents.ts";
import type { Room } from "./setup.ts";

export const INVITE_LIFETIME_DAYS = 7;

export interface Invite {
  id: number;
  /** The `start` parameter of the Invite link. */
  token: string;
  room: Room;
  moveIn: CalendarDate;
  /** The day the Invite expires, in the Apartment time zone. */
  expiresOn: CalendarDate;
}

export interface Invites {
  /** Today in the Apartment time zone: the latest move-in date an Invite may have. */
  today(): CalendarDate;
  /** The Rooms an Invite can be for, in Room Order. */
  rooms(): Room[];
  /** Creates a pending Invite. Only Admins create Invites, never for a future move-in. */
  create(adminTelegramId: number, roomId: number, moveIn: CalendarDate): Invite;
  /** The pending Invites, oldest first. */
  pending(): Invite[];
  /** Revokes a pending Invite. Returns false when it's no longer pending (used, revoked or expired). */
  revoke(adminTelegramId: number, inviteId: number): boolean;
  /**
   * Opens the Invite with this token for a Telegram user. A pending Invite gives them a
   * Stay in its Room from its move-in date, and is used up.
   */
  open(token: string, newcomer: { telegramId: number; firstName: string }): OpenedInvite;
}

/** What opening an Invite did. */
export type OpenedInvite =
  /** `returning` when they lived here before: the same person, with a new Stay. */
  | { outcome: "joined"; name: string; room: Room; moveIn: CalendarDate; returning: boolean }
  | { outcome: "already-resident"; roomName: string }
  | { outcome: "not-found" | "used" | "revoked" }
  | { outcome: "expired"; expiredOn: CalendarDate }
  /** A former Resident's new Stay would overlap their last one. */
  | { outcome: "before-last-move-out"; moveIn: CalendarDate; lastMoveOut: CalendarDate };

export function createInvites(db: Db, clock: Clock, apartmentTimeZone: string, residents: Residents): Invites {
  const today = () => dateIn(apartmentTimeZone, clock.now());
  const roomsNotArchived = () =>
    db
      .select({ id: rooms.id, name: rooms.name })
      .from(rooms)
      .where(eq(rooms.archived, false))
      .orderBy(asc(rooms.position))
      .all();

  /** The SQL condition for Invites still pending now: neither used, revoked nor expired. */
  const pendingNow = () => and(eq(invites.state, "pending"), gt(invites.expiresAt, clock.now()));
  const assertAdmin = (telegramId: number) => {
    if (!residents.current(telegramId)?.isAdmin) throw new Error("Only Admins manage Invites");
  };

  return {
    today,
    rooms: roomsNotArchived,

    create(adminTelegramId, roomId, moveIn) {
      assertAdmin(adminTelegramId);
      if (moveIn > today()) throw new Error("An Invite can't have a future move-in date");
      const room = roomsNotArchived().find((r) => r.id === roomId);
      if (!room) throw new Error(`There's no Room ${roomId} to invite to`);

      const admin = db.select({ id: persons.id }).from(persons).where(eq(persons.telegramId, adminTelegramId)).get()!;
      const expiresAt = new Date(clock.now().getTime() + INVITE_LIFETIME_DAYS * 24 * 60 * 60 * 1000);
      // 16 random bytes: unguessable, and within the 64 characters a `start` parameter may have.
      const token = randomBytes(16).toString("base64url");
      const { id } = db
        .insert(invites)
        .values({ token, roomId: room.id, moveIn, createdBy: admin.id, expiresAt })
        .returning({ id: invites.id })
        .get();
      return { id, token, room, moveIn, expiresOn: dateIn(apartmentTimeZone, expiresAt) };
    },

    pending() {
      return db
        .select({
          id: invites.id,
          token: invites.token,
          moveIn: invites.moveIn,
          expiresAt: invites.expiresAt,
          roomId: rooms.id,
          roomName: rooms.name,
        })
        .from(invites)
        .innerJoin(rooms, eq(rooms.id, invites.roomId))
        .where(pendingNow())
        .orderBy(asc(invites.id))
        .all()
        .map((invite) => ({
          id: invite.id,
          token: invite.token,
          room: { id: invite.roomId, name: invite.roomName },
          moveIn: invite.moveIn,
          expiresOn: dateIn(apartmentTimeZone, invite.expiresAt),
        }));
    },

    revoke(adminTelegramId, inviteId) {
      assertAdmin(adminTelegramId);
      const revoked = db
        .update(invites)
        .set({ state: "revoked" })
        .where(and(eq(invites.id, inviteId), pendingNow()))
        .run();
      return revoked.changes > 0;
    },

    open(token, { telegramId, firstName }): OpenedInvite {
      return db.transaction((tx) => {
        // A Resident has at most one current Stay; moving between Rooms is an Admin's job.
        const resident = residents.current(telegramId);
        if (resident) return { outcome: "already-resident", roomName: resident.roomName };

        const invite = tx
          .select({
            id: invites.id,
            moveIn: invites.moveIn,
            state: invites.state,
            expiresAt: invites.expiresAt,
            roomId: rooms.id,
            roomName: rooms.name,
          })
          .from(invites)
          .innerJoin(rooms, eq(rooms.id, invites.roomId))
          .where(eq(invites.token, token))
          .get();
        if (!invite) return { outcome: "not-found" };
        if (invite.state !== "pending") return { outcome: invite.state };
        if (clock.now() >= invite.expiresAt) {
          return { outcome: "expired", expiredOn: dateIn(apartmentTimeZone, invite.expiresAt) };
        }

        const formerResident = tx
          .select({ id: persons.id, name: persons.name })
          .from(persons)
          .where(eq(persons.telegramId, telegramId))
          .get();
        if (formerResident) {
          // Not a Resident now, so their last Stay has ended.
          const lastMoveOut = tx
            .select({ moveOut: stays.moveOut })
            .from(stays)
            .where(eq(stays.personId, formerResident.id))
            .orderBy(desc(stays.moveIn))
            .get()?.moveOut;
          if (lastMoveOut && invite.moveIn <= lastMoveOut) {
            return { outcome: "before-last-move-out", moveIn: invite.moveIn, lastMoveOut };
          }
        }
        const person =
          formerResident ??
          tx.insert(persons).values({ telegramId, name: firstName }).returning({ id: persons.id, name: persons.name }).get();
        tx.insert(stays).values({ personId: person.id, roomId: invite.roomId, moveIn: invite.moveIn }).run();
        tx.update(invites).set({ state: "used", usedBy: person.id }).where(eq(invites.id, invite.id)).run();
        return {
          outcome: "joined",
          name: person.name,
          room: { id: invite.roomId, name: invite.roomName },
          moveIn: invite.moveIn,
          returning: formerResident !== undefined,
        };
      });
    },
  };
}
