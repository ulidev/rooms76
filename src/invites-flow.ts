// Invites in Telegram: Admins create, list and revoke them in their private chat,
// and whoever opens an Invite link joins the Apartment.
import { Composer, InlineKeyboard, type Context, type MiddlewareFn } from "grammy";
import type { ChatStates } from "./chat-states.ts";
import { addDays, formatDate, parseDate, type CalendarDate } from "./clock.ts";
import type { Invite, Invites, OpenedInvite } from "./invites.ts";
import type { Residents } from "./residents.ts";
import { SHOP_MODE_HINT, shopKeyboard } from "./shop-mode.ts";

/** Starts creating an Invite. Shared with the optional setup steps. */
export const NEW_INVITE = "invite:new";

/**
 * Opening an Invite link: Telegram sends `/start <token>`. Runs before the Resident
 * check, since whoever opens a pending Invite becomes a Resident.
 */
export function joinByInvite(invites: Invites, scannerUrl: string | null): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const token = ctx.message?.text?.match(/^\/start(?:@\w+)?\s+(\S+)/)?.[1];
    if (token === undefined || !ctx.from) return next();

    const opened = invites.open(token, { telegramId: ctx.from.id, firstName: ctx.from.first_name });
    if (opened.outcome !== "joined") {
      await ctx.reply(rejectionText(opened));
      return;
    }
    await ctx.reply(
      `👋 Welcome${opened.returning ? " back" : ""}, ${opened.name}! You live in ${opened.room.name}, from ${formatDate(opened.moveIn)}.\n` +
        `I'll call you ${opened.name}. To change your name, send /name.\n\n${SHOP_MODE_HINT}`,
      { reply_markup: shopKeyboard(scannerUrl) },
    );
  };
}

/** Why opening an Invite didn't make this person a Resident. */
function rejectionText(opened: Exclude<OpenedInvite, { outcome: "joined" }>): string {
  const askForANewOne = "Ask an Admin for a new one.";
  switch (opened.outcome) {
    case "already-resident":
      return `You already live in ${opened.roomName}. If you're moving to another Room, ask an Admin to move you.`;
    case "not-found":
      return `This Invite link isn't valid. ${askForANewOne}`;
    case "used":
      return `This Invite has already been used. ${askForANewOne}`;
    case "revoked":
      return `This Invite was revoked. ${askForANewOne}`;
    case "expired":
      return `This Invite expired on ${formatDate(opened.expiredOn)}. ${askForANewOne}`;
    case "before-last-move-out":
      return (
        `Your last Stay ended on ${formatDate(opened.lastMoveOut)}, ` +
        `so this Invite's move-in date, ${formatDate(opened.moveIn)}, is too early. ` +
        `Ask an Admin for an Invite from ${formatDate(addDays(opened.lastMoveOut, 1))} on.`
      );
  }
}

/** Invite management for Admins. Only Residents get this far. */
export function inviteManagement(invites: Invites, residents: Residents, chatStates: ChatStates): Composer<Context> {
  const composer = new Composer<Context>();

  // A typed move-in date, after "📅 Another date".
  composer.on("message:text", async (ctx, next) => {
    const state = chatStates.get(ctx.chat.id);
    if (state?.flow !== "invite-date") return next();
    const text = ctx.message.text;
    if (!residents.current(ctx.from.id)?.isAdmin) {
      chatStates.clear(ctx.chat.id);
      return next();
    }

    const moveIn = parseDate(text);
    const today = invites.today();
    if (moveIn === null) {
      await ctx.reply(`I can't read “${text}” as a date. Send it like 12 Sep 2026 or 2026-09-12.`);
    } else if (moveIn > today) {
      await ctx.reply(
        `${formatDate(moveIn)} is in the future. The move-in date can be today, ${formatDate(today)}, or earlier.`,
      );
    } else {
      chatStates.clear(ctx.chat.id);
      const invite = invites.create(ctx.from.id, state.roomId, moveIn);
      await ctx.reply(inviteText(invite, ctx.me.username), { link_preview_options: { is_disabled: true } });
    }
  });

  // Invite management is for Admins only.
  const admins = composer.filter(
    (ctx) => ctx.hasCommand("invites") || ctx.callbackQuery?.data?.startsWith("invite:") === true,
  );
  admins.use(async (ctx, next) => {
    if (residents.current(ctx.from!.id)?.isAdmin) return next();
    if (ctx.callbackQuery) await ctx.answerCallbackQuery("Only Admins can manage Invites.");
    else await ctx.reply("Only Admins can manage Invites.");
  });

  admins.command("invites", async (ctx) => {
    const pending = invites.pending();
    await ctx.reply(pendingText(pending), { reply_markup: pendingButtons(pending) });
  });

  admins.callbackQuery(/^invite:revoke:(\d+)$/, async (ctx) => {
    const revoked = invites.revoke(ctx.from.id, Number(ctx.match[1]));
    await ctx.answerCallbackQuery(revoked ? "Invite revoked." : "This Invite is no longer pending.");
    const pending = invites.pending();
    await ctx.editMessageText(pendingText(pending), { reply_markup: pendingButtons(pending) });
  });

  admins.callbackQuery(NEW_INVITE, async (ctx) => {
    await ctx.answerCallbackQuery();
    const keyboard = InlineKeyboard.from([
      ...invites.rooms().map((room) => [InlineKeyboard.text(room.name, `invite:room:${room.id}`)]),
      [InlineKeyboard.text("↩️ Cancel", "invite:cancel")],
    ]);
    await ctx.reply("Which Room is the Invite for?", { reply_markup: keyboard });
  });

  admins.callbackQuery(/^invite:room:(\d+)$/, async (ctx) => {
    const room = invites.rooms().find((r) => r.id === Number(ctx.match[1]));
    if (!room) return answerOutOfDate(ctx);
    const today = invites.today();
    const yesterday = addDays(today, -1);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      `When does the new Resident move into ${room.name}? It can be today or a date in the past.`,
      {
        reply_markup: new InlineKeyboard()
          .text(`Today, ${formatDate(today)}`, `invite:date:${room.id}:${today}`)
          .row()
          .text(`Yesterday, ${formatDate(yesterday)}`, `invite:date:${room.id}:${yesterday}`)
          .row()
          .text("📅 Another date", `invite:other-date:${room.id}`)
          .row()
          .text("↩️ Cancel", "invite:cancel"),
      },
    );
  });

  admins.callbackQuery(/^invite:other-date:(\d+)$/, async (ctx) => {
    const room = invites.rooms().find((r) => r.id === Number(ctx.match[1]));
    if (!room) return answerOutOfDate(ctx);
    chatStates.set(ctx.chat!.id, { flow: "invite-date", roomId: room.id });
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      `Send me the day the new Resident moved into ${room.name}, e.g. 12 Sep 2026 or 2026-09-12.`,
      { reply_markup: new InlineKeyboard().text("↩️ Cancel", "invite:cancel") },
    );
  });

  admins.callbackQuery("invite:cancel", async (ctx) => {
    if (chatStates.get(ctx.chat!.id)?.flow === "invite-date") chatStates.clear(ctx.chat!.id);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("Cancelled. No Invite was created.");
  });

  admins.callbackQuery(/^invite:date:(\d+):(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
    const roomId = Number(ctx.match[1]);
    const moveIn: CalendarDate = ctx.match[2]!;
    if (!invites.rooms().some((r) => r.id === roomId) || moveIn > invites.today()) return answerOutOfDate(ctx);
    const invite = invites.create(ctx.from.id, roomId, moveIn);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(inviteText(invite, ctx.me.username), { link_preview_options: { is_disabled: true } });
  });

  return composer;
}

/** The pending Invites, oldest first. */
function pendingText(pending: Invite[]): string {
  if (pending.length === 0) return "No pending Invites.";
  const lines = pending.map(
    (invite) =>
      `• ${invite.room.name}, moving in on ${formatDate(invite.moveIn)}, expires on ${formatDate(invite.expiresOn)}`,
  );
  return ["Pending Invites:", ...lines].join("\n");
}

/** A Revoke button per pending Invite, and one to create another. */
function pendingButtons(pending: Invite[]): InlineKeyboard {
  return InlineKeyboard.from([
    ...pending.map((invite) => [
      InlineKeyboard.text(
        `🚫 Revoke: ${invite.room.name}, ${formatDate(invite.moveIn)}`,
        `invite:revoke:${invite.id}`,
      ),
    ]),
    [InlineKeyboard.text("✉️ New Invite", NEW_INVITE)],
  ]);
}

/** The new Invite and its link, ready to forward. */
function inviteText(invite: Invite, botUsername: string): string {
  return (
    `✉️ Invite for ${invite.room.name}, moving in on ${formatDate(invite.moveIn)}.\n\n` +
    `Send this link to the new Resident. It works once and expires on ${formatDate(invite.expiresOn)}:\n` +
    `https://t.me/${botUsername}?start=${invite.token}`
  );
}

/** For a button that no longer matches what it offered, e.g. a Room that's gone. */
async function answerOutOfDate(ctx: Context): Promise<void> {
  await ctx.answerCallbackQuery("This button is out of date.");
}
