// Linking the Apartment Group: the bot joins groups only for the Apartment, and posts
// only to the one group linked. Privacy mode stays on, so in groups the bot hears only
// commands, replies to it and service messages.
import { Composer, GrammyError, type Api, type Context } from "grammy";
import type { ChatMember } from "grammy/types";
import type { ApartmentGroup } from "./apartment-group.ts";
import { notifyApartmentGroup } from "./notifier.ts";
import type { Residents } from "./residents.ts";

/** Explains how to link the Apartment Group. Shared with the optional setup steps. */
export const HOW_TO_LINK = "setup-optional:link";

const ONLY_ADMINS = "Only Admins can link the Apartment Group";

const LINKED_TEXT =
  "📌 This is now the Apartment Group. I'll post here only when something runs out, and when it's bought. " +
  "Everything else happens in your private chat with me.";

export function apartmentGroupLinking(
  apartmentGroup: ApartmentGroup,
  residents: Residents,
  log: (line: string) => void,
): Composer<Context> {
  const composer = new Composer<Context>();
  const groups = composer.chatType(["group", "supergroup"]);
  const isAdmin = (telegramId: number) => residents.current(telegramId)?.isAdmin === true;

  // The bot was added to a group, or removed from one.
  groups.on("my_chat_member", async (ctx) => {
    const { old_chat_member: before, new_chat_member: after } = ctx.myChatMember;
    const wasIn = isMember(before);
    const isIn = isMember(after);

    const linked = apartmentGroup.linked();
    if (wasIn && !isIn) {
      // Removed from the Apartment Group: nothing is posted to a group until an Admin links one again.
      if (linked?.chatId === ctx.chat.id) {
        apartmentGroup.unlink(ctx.chat.id);
        log(`Removed from the Apartment Group ${ctx.chat.id}; no group is linked now`);
      }
      return;
    }
    // From here on, only the bot being added matters: e.g. a promotion to group admin changes nothing.
    if (wasIn || !isIn) return;

    // Upgrading the Apartment Group to a supergroup may reach the bot as being added to the
    // supergroup, before the upgrade itself is announced.
    if (linked && (await upgradedTo(ctx.api, linked.chatId)) === ctx.chat.id) {
      apartmentGroup.followUpgrade(linked.chatId, ctx.chat.id);
      return;
    }
    if (!isAdmin(ctx.from.id)) {
      return leaveGroup(ctx, ctx.chat.id, "👋 Only an Admin of the Apartment can add me to a group, so I'm leaving.");
    }
    if (linked === null) return linkHere(ctx);

    // It stays for an Admin to move the Apartment Group here, and leaves on anything else (see below).
    // With privacy mode on, `/link` alone may not reach the bot, so the prompt names it.
    try {
      await ctx.reply(
        `This Apartment already has an Apartment Group, ${linked.title}. ` +
          `To move it here, an Admin sends /link@${ctx.me.username}. Otherwise I'll leave.`,
      );
    } catch (error) {
      // Nobody would know to send /link.
      log(`Couldn't ask for /link in group ${ctx.chat.id}, so leaving it: ${String(error)}`);
      await leaveGroup(ctx, ctx.chat.id, null);
    }
  });

  groups.on("message", async (ctx) => {
    const message = ctx.message;
    // Telegram announcing the bot joining or leaving is part of the membership change above.
    const aboutTheBot =
      message.new_chat_members?.some((member) => member.id === ctx.me.id) ||
      message.left_chat_member?.id === ctx.me.id ||
      message.group_chat_created ||
      message.supergroup_chat_created;
    if (aboutTheBot) return;

    // Telegram upgraded a group to a supergroup, with a new chat id. Both chats announce it.
    if (message.migrate_to_chat_id !== undefined) {
      return apartmentGroup.followUpgrade(ctx.chat.id, message.migrate_to_chat_id);
    }
    if (message.migrate_from_chat_id !== undefined) {
      return apartmentGroup.followUpgrade(message.migrate_from_chat_id, ctx.chat.id);
    }

    // A group admin who stays anonymous sends as the group itself, so the bot can't tell whether they're an Admin.
    if (ctx.hasCommand("link") && message.sender_chat?.id === ctx.chat.id) {
      await ctx.reply("I can't tell who sent /link while they stay anonymous. An Admin needs to send it as themselves.");
      return;
    }

    const linked = apartmentGroup.linked();
    const isAdminLink = ctx.hasCommand("link") && isAdmin(ctx.from.id);

    if (linked?.chatId === ctx.chat.id) {
      if (message.new_chat_title !== undefined) apartmentGroup.retitle(ctx.chat.id, message.new_chat_title);
      if (ctx.hasCommand("link")) {
        await ctx.reply(isAdminLink ? "This is already the Apartment Group." : `${ONLY_ADMINS}.`);
      }
      return;
    }

    if (isAdminLink) {
      await linkHere(ctx);
      if (linked) {
        await leaveGroup(ctx, linked.chatId, `👋 The Apartment Group moved to ${ctx.chat.title}, so I'm leaving this group.`);
      }
      return;
    }

    // Any group but the Apartment Group was waiting for /link from an Admin. This wasn't it.
    const why = ctx.hasCommand("link") ? ONLY_ADMINS : "No Admin sent /link";
    const still = linked ? ` The Apartment Group is still ${linked.title}.` : "";
    await leaveGroup(ctx, ctx.chat.id, `👋 ${why}, so I'm leaving.${still}`);
  });

  return composer;

  /** Links the group this update comes from, and says so there. */
  async function linkHere(ctx: Context & { chat: { id: number; title: string } }): Promise<void> {
    apartmentGroup.link({ chatId: ctx.chat.id, title: ctx.chat.title });
    await notifyApartmentGroup(ctx.api, apartmentGroup, LINKED_TEXT, log);
  }

  /** Says why, unless there's no point, then leaves the group. Leaves even when it can't post there. */
  async function leaveGroup(ctx: Context, chatId: number, why: string | null): Promise<void> {
    try {
      if (why !== null) await ctx.api.sendMessage(chatId, why);
    } catch (error) {
      log(`Couldn't say goodbye in group ${chatId}: ${String(error)}`);
    }
    try {
      await ctx.api.leaveChat(chatId);
    } catch (error) {
      log(`Couldn't leave group ${chatId}: ${String(error)}`);
    }
  }
}

/** `/link` in private, and the optional setup step: how to link the Apartment Group. Only Residents get this far. */
export function howToLinkApartmentGroup(apartmentGroup: ApartmentGroup, residents: Residents): Composer<Context> {
  const composer = new Composer<Context>();
  const linking = composer.filter((ctx) => ctx.hasCommand("link") || ctx.callbackQuery?.data === HOW_TO_LINK);

  linking.use(async (ctx) => {
    if (!residents.current(ctx.from!.id)?.isAdmin) {
      if (ctx.callbackQuery) await ctx.answerCallbackQuery(`${ONLY_ADMINS}.`);
      else await ctx.reply(`${ONLY_ADMINS}.`);
      return;
    }
    if (ctx.callbackQuery) await ctx.answerCallbackQuery();

    const linked = apartmentGroup.linked();
    const how =
      linked === null
        ? "👥 No Apartment Group is linked yet. To link it, add me to the group: " +
          `open it, tap Add members and pick @${ctx.me.username}.`
        : `👥 The Apartment Group is ${linked.title}. To move it to another group, add me there and send /link@${ctx.me.username} in it.`;
    await ctx.reply(
      `${how}\n\nTo let me give new Residents a link to join the group, make me a group admin who can invite users.`,
    );
  });

  return composer;
}

/**
 * What a new Resident is told about the Apartment Group: a single-use link to join it when
 * the bot may invite users there, or else to ask to be added. Null while no group is linked.
 */
export async function joinApartmentGroupText(
  api: Api,
  apartmentGroup: ApartmentGroup,
  residentName: string,
  log: (line: string) => void,
): Promise<string | null> {
  const linked = apartmentGroup.linked();
  if (linked === null) return null;
  try {
    // Telegram allows invite link names of up to 32 characters. The name shows only to group admins.
    const link = await api.createChatInviteLink(linked.chatId, { name: residentName.slice(0, 32), member_limit: 1 });
    return `👥 Join the Apartment Group, ${linked.title}. I post there when something runs out:\n${link.invite_link}`;
  } catch (error) {
    // E.g. the bot isn't a group admin allowed to invite users.
    log(`Couldn't create an invite link to the Apartment Group: ${String(error)}`);
    return `👥 Ask another Resident to add you to the Apartment Group, ${linked.title}. I post there when something runs out.`;
  }
}

/** The supergroup this group was upgraded to, or undefined when it wasn't. */
async function upgradedTo(api: Api, chatId: number): Promise<number | undefined> {
  try {
    await api.getChat(chatId);
    return undefined;
  } catch (error) {
    return error instanceof GrammyError ? error.parameters.migrate_to_chat_id : undefined;
  }
}

function isMember(member: ChatMember): boolean {
  if (member.status === "restricted") return member.is_member;
  return member.status !== "left" && member.status !== "kicked";
}
