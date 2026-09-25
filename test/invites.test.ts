import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, expect, test } from "vitest";
import { OPERATOR_ID, startTestBot, type TestBot, type TestBotOptions } from "./harness.ts";

let bot: TestBot;
afterEach(() => bot.close());

const lena = { id: OPERATOR_ID, first_name: "Lena" };

/** A fresh Apartment set up by Lena, the Operator and first Admin, who lives in Room 2. */
async function apartmentSetUpByLena(options: TestBotOptions = {}): Promise<void> {
  bot = await startTestBot(options);
  await bot.sendPrivateMessage(lena, "/start");
  await bot.sendPrivateMessage(lena, "Room 1\nRoom 2\nAttic");
  await bot.tap(lena, "✅ Confirm Room Order");
  await bot.tap(lena, "Room 2");
}

/** The Invite link in the newest message to this Admin. */
function lastInviteLink(admin: { id: number }): string {
  const link = bot.lastMessageTo(admin.id).text.match(/https:\/\/t\.me\/\S+/)?.[0];
  if (!link) throw new Error(`The newest message to ${admin.id} has no Invite link`);
  return link;
}

test("an Admin creates an Invite for a Room, moving in today, and gets a t.me link", async () => {
  await apartmentSetUpByLena();

  await bot.sendPrivateMessage(lena, "/invites");
  await bot.tap(lena, "✉️ New Invite");
  expect(bot.lastMessageTo(lena.id)).toEqual({
    id: expect.any(Number),
    text: "Which Room is the Invite for?",
    buttons: [["Room 1"], ["Room 2"], ["Attic"], ["↩️ Cancel"]],
  });

  await bot.tap(lena, "Attic");
  expect(bot.lastMessageTo(lena.id)).toEqual({
    id: expect.any(Number),
    text: "When does the new Resident move into Attic? It can be today or a date in the past.",
    buttons: [["Today, 25 Sep 2026"], ["Yesterday, 24 Sep 2026"], ["📅 Another date"], ["↩️ Cancel"]],
  });

  await bot.tap(lena, "Today, 25 Sep 2026");
  expect(bot.lastMessageTo(lena.id).text).toMatch(
    new RegExp(
      "^✉️ Invite for Attic, moving in on 25 Sep 2026\\.\n\n" +
        "Send this link to the new Resident\\. It works once and expires on 2 Oct 2026:\n" +
        "https://t\\.me/rooms76_test_bot\\?start=[\\w-]+$",
    ),
  );
});

/** Creates an Invite as this Admin, through /invites, and returns its link. */
async function createInvite(admin: { id: number; first_name: string }, room: string, moveIn = /^Today, /): Promise<string> {
  await bot.sendPrivateMessage(admin, "/invites");
  await bot.tap(admin, "✉️ New Invite");
  await bot.tap(admin, room);
  const dateButton = bot.lastMessageTo(admin.id).buttons.flat().find((text) => moveIn.test(text));
  if (!dateButton) throw new Error(`No move-in date button matches ${moveIn}`);
  await bot.tap(admin, dateButton);
  return lastInviteLink(admin);
}

/** Opens an Invite link the way Telegram does: a /start with the link's parameter. */
async function openInvite(user: { id: number; first_name: string }, link: string): Promise<void> {
  await bot.sendPrivateMessage(user, `/start ${new URL(link).searchParams.get("start")}`);
}

const ana = { id: 2002, first_name: "Ana", last_name: "García" };

test("whoever opens a pending Invite becomes a Resident with a Stay in its Room, from its move-in date", async () => {
  await apartmentSetUpByLena();
  const link = await createInvite(lena, "Attic", /^Yesterday, /);

  await openInvite(ana, link);

  expect(bot.messagesTo(ana.id)).toEqual([
    "👋 Welcome, Ana! You live in Attic, from 24 Sep 2026.\n" +
      "I'll call you Ana. To change your name, send /name.\n\n" +
      "Use the keyboard below to shop, report what ran out and add items.",
  ]);
  expect(bot.keyboardOf(ana.id)).toEqual([
    ["🛒 Shopping list", "⚠️ Something ran out"],
    ["📷 Scan", "➕ Add item"],
  ]);

  await bot.sendPrivateMessage(ana, "/start");
  expect(bot.lastMessageTo(ana.id).text).toMatch(/^👋 Hi Ana, you're in Attic\./);
  await bot.sendPrivateMessage(ana, "/name");
  expect(bot.lastMessageTo(ana.id).text).toBe("You're called Ana. Send me your new name.");
});

const tomas = { id: 2003, first_name: "Tomás" };

test("an Invite works only once", async () => {
  await apartmentSetUpByLena();
  const link = await createInvite(lena, "Attic");
  await openInvite(ana, link);

  await openInvite(tomas, link);

  expect(bot.messagesTo(tomas.id)).toEqual(["This Invite has already been used. Ask an Admin for a new one."]);
  await bot.sendPrivateMessage(tomas, "/start");
  expect(bot.lastMessageTo(tomas.id).text).toMatch(/^Hi Tomás! This bot is only for the Residents/);
});

test("an Invite expires 7 days after it was created", async () => {
  await apartmentSetUpByLena();
  const link = await createInvite(lena, "Attic");

  bot.setNow(new Date("2026-10-02T09:59:00Z"));
  await openInvite(ana, link);
  expect(bot.lastMessageTo(ana.id).text).toMatch(/^👋 Welcome, Ana! You live in Attic/);

  const lateLink = await createInvite(lena, "Room 1");
  bot.setNow(new Date("2026-10-09T09:59:00Z")); // exactly 7 days later
  await openInvite(tomas, lateLink);
  expect(bot.messagesTo(tomas.id)).toEqual(["This Invite expired on 9 Oct 2026. Ask an Admin for a new one."]);
});

test("a link that isn't an Invite is rejected", async () => {
  await apartmentSetUpByLena();

  await bot.sendPrivateMessage(tomas, "/start not-an-invite");

  expect(bot.messagesTo(tomas.id)).toEqual(["This Invite link isn't valid. Ask an Admin for a new one."]);
});

test("an Admin lists the pending Invites and revokes one", async () => {
  await apartmentSetUpByLena();
  const usedLink = await createInvite(lena, "Room 1");
  await openInvite(ana, usedLink);
  const atticLink = await createInvite(lena, "Attic");
  await createInvite(lena, "Room 1", /^Yesterday, /);

  await bot.sendPrivateMessage(lena, "/invites");
  expect(bot.lastMessageTo(lena.id)).toEqual({
    id: expect.any(Number),
    text:
      "Pending Invites:\n" +
      "• Attic, moving in on 25 Sep 2026, expires on 2 Oct 2026\n" +
      "• Room 1, moving in on 24 Sep 2026, expires on 2 Oct 2026",
    buttons: [["🚫 Revoke: Attic, 25 Sep 2026"], ["🚫 Revoke: Room 1, 24 Sep 2026"], ["✉️ New Invite"]],
  });

  await bot.tap(lena, "🚫 Revoke: Attic, 25 Sep 2026");
  expect(bot.toastsTo(lena.id)).toEqual(["Invite revoked."]);
  expect(bot.lastMessageTo(lena.id)).toEqual({
    id: expect.any(Number),
    text: "Pending Invites:\n• Room 1, moving in on 24 Sep 2026, expires on 2 Oct 2026",
    buttons: [["🚫 Revoke: Room 1, 24 Sep 2026"], ["✉️ New Invite"]],
  });

  await openInvite(tomas, atticLink);
  expect(bot.messagesTo(tomas.id)).toEqual(["This Invite was revoked. Ask an Admin for a new one."]);
});

test("expired Invites aren't listed as pending, and a stale Revoke button only says so", async () => {
  await apartmentSetUpByLena();
  await createInvite(lena, "Attic");
  await bot.sendPrivateMessage(lena, "/invites");

  bot.setNow(new Date("2026-10-03T10:00:00Z"));
  await bot.tap(lena, "🚫 Revoke: Attic, 25 Sep 2026");

  expect(bot.toastsTo(lena.id)).toEqual(["This Invite is no longer pending."]);
  expect(bot.lastMessageTo(lena.id)).toEqual({
    id: expect.any(Number),
    text: "No pending Invites.",
    buttons: [["✉️ New Invite"]],
  });
});

test("a current Resident who opens an Invite is told to ask an Admin to move them, and keeps their Stay", async () => {
  await apartmentSetUpByLena();
  await openInvite(ana, await createInvite(lena, "Room 1"));
  const atticLink = await createInvite(lena, "Attic");

  await openInvite(ana, atticLink);

  expect(bot.lastMessageTo(ana.id).text).toBe(
    "You already live in Room 1. If you're moving to another Room, ask an Admin to move you.",
  );
  await bot.sendPrivateMessage(ana, "/start");
  expect(bot.lastMessageTo(ana.id).text).toMatch(/^👋 Hi Ana, you're in Room 1\./);

  // The Invite is still there for whoever it was meant for.
  await openInvite(tomas, atticLink);
  expect(bot.lastMessageTo(tomas.id).text).toMatch(/^👋 Welcome, Tomás! You live in Attic/);
});

/**
 * Ends a Resident's Stay on this day. Move-outs arrive with "A Resident's own Stay" (#23);
 * until then this reaches into the database file, the only way to end a Stay.
 */
function moveOut(databasePath: string, telegramId: number, day: string): void {
  const sqlite = new Database(databasePath);
  try {
    sqlite
      .prepare(
        "UPDATE stays SET move_out = ? WHERE person_id = (SELECT id FROM persons WHERE telegram_id = ?) AND move_out IS NULL",
      )
      .run(day, telegramId);
  } finally {
    sqlite.close();
  }
}

test("a former Resident who returns with a new Invite is the same person, with a new Stay", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rooms76-"));
  try {
    const databasePath = join(dir, "rooms76.sqlite");
    await apartmentSetUpByLena({ databasePath });
    await openInvite(ana, await createInvite(lena, "Room 1"));
    await bot.sendPrivateMessage(ana, "/name");
    await bot.sendPrivateMessage(ana, "Ana G.");
    moveOut(databasePath, ana.id, "2026-09-30");

    bot.setNow(new Date("2026-10-01T10:00:00Z"));
    await bot.sendPrivateMessage(ana, "/start");
    expect(bot.lastMessageTo(ana.id).text).toMatch(/^Hi Ana! This bot is only for the Residents/);

    await openInvite(ana, await createInvite(lena, "Attic"));
    expect(bot.lastMessageTo(ana.id).text).toMatch(/^👋 Welcome back, Ana G\.! You live in Attic, from 1 Oct 2026\.\n/);
    await bot.sendPrivateMessage(ana, "/start");
    expect(bot.lastMessageTo(ana.id).text).toMatch(/^👋 Hi Ana G\., you're in Attic\./);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a former Resident's new Stay can't start before their last one ended", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rooms76-"));
  try {
    const databasePath = join(dir, "rooms76.sqlite");
    await apartmentSetUpByLena({ databasePath });
    await openInvite(ana, await createInvite(lena, "Room 1"));
    moveOut(databasePath, ana.id, "2026-09-30");
    bot.setNow(new Date("2026-10-01T10:00:00Z"));

    const link = await createInvite(lena, "Attic", /^Yesterday, /);
    await openInvite(ana, link);
    expect(bot.lastMessageTo(ana.id).text).toBe(
      "Your last Stay ended on 30 Sep 2026, so this Invite's move-in date, 30 Sep 2026, is too early. " +
        "Ask an Admin for an Invite from 1 Oct 2026 on.",
    );

    // The Invite is still pending.
    await bot.sendPrivateMessage(lena, "/invites");
    expect(bot.lastMessageTo(lena.id).text).toContain("• Attic, moving in on 30 Sep 2026");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an Admin can backdate an Invite's move-in date by typing it", async () => {
  await apartmentSetUpByLena();
  await bot.sendPrivateMessage(lena, "/invites");
  await bot.tap(lena, "✉️ New Invite");
  await bot.tap(lena, "Attic");

  await bot.tap(lena, "📅 Another date");
  expect(bot.lastMessageTo(lena.id)).toEqual({
    id: expect.any(Number),
    text: "Send me the day the new Resident moved into Attic, e.g. 12 Sep 2026 or 2026-09-12.",
    buttons: [["↩️ Cancel"]],
  });

  await bot.sendPrivateMessage(lena, "someday");
  expect(bot.lastMessageTo(lena.id).text).toBe(
    "I can't read “someday” as a date. Send it like 12 Sep 2026 or 2026-09-12.",
  );

  await bot.sendPrivateMessage(lena, "2026-09-26");
  expect(bot.lastMessageTo(lena.id).text).toBe(
    "26 Sep 2026 is in the future. The move-in date can be today, 25 Sep 2026, or earlier.",
  );

  await bot.sendPrivateMessage(lena, "1 sep 2026");
  expect(bot.lastMessageTo(lena.id).text).toMatch(/^✉️ Invite for Attic, moving in on 1 Sep 2026\.\n\n/);

  await openInvite(ana, lastInviteLink(lena));
  expect(bot.lastMessageTo(ana.id).text).toMatch(/^👋 Welcome, Ana! You live in Attic, from 1 Sep 2026\./);
});

test("an Admin can cancel creating an Invite", async () => {
  await apartmentSetUpByLena();
  await bot.sendPrivateMessage(lena, "/invites");
  await bot.tap(lena, "✉️ New Invite");
  await bot.tap(lena, "Attic");
  await bot.tap(lena, "📅 Another date");

  await bot.tap(lena, "↩️ Cancel");
  expect(bot.lastMessageTo(lena.id)).toEqual({
    id: expect.any(Number),
    text: "Cancelled. No Invite was created.",
    buttons: [],
  });

  await bot.sendPrivateMessage(lena, "2026-09-01");
  await bot.sendPrivateMessage(lena, "/invites");
  expect(bot.lastMessageTo(lena.id).text).toBe("No pending Invites.");
});

test("only Admins manage Invites", async () => {
  await apartmentSetUpByLena();
  await openInvite(ana, await createInvite(lena, "Room 1"));

  await bot.sendPrivateMessage(ana, "/invites");

  expect(bot.lastMessageTo(ana.id)).toEqual({
    id: expect.any(Number),
    text: "Only Admins can manage Invites.",
    buttons: [],
  });
});
