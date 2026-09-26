// Seam 1: the real bot with its real services, run in process.
//
// The database is SQLite (in memory unless a test passes a file path). The only
// fakes are the external boundaries: the clock and the Telegram Bot API. Every
// outgoing Bot API call is recorded by a grammY API transformer and answered
// locally, so no test touches the network. Tests assert on what each chat
// receives, never on tables or grammY internals.
import type { Update, UserFromGetMe } from "grammy/types";
import { startApp, type App } from "../src/app.ts";

const TEST_BOT_INFO: UserFromGetMe = {
  id: 7000000001,
  is_bot: true,
  first_name: "rooms76",
  username: "rooms76_test_bot",
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
};

export const OPERATOR_ID = 1001;

export const VALID_ENV = {
  BOT_TOKEN: "7000000001:AAtest-token-for-rooms76-tests_000000",
  OPERATOR_TELEGRAM_ID: String(OPERATOR_ID),
  APARTMENT_TIMEZONE: "Europe/Berlin",
  OFF_CONTACT: "operator@example.com",
};

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}

/** A Telegram group chat. Group ids are negative. */
export interface TelegramGroup {
  id: number;
  title: string;
}

export interface ApiCall {
  method: string;
  payload: Record<string, unknown>;
}

/** A message the bot sent to a chat, as the chat sees it now (after any edits). */
export interface ChatMessage {
  id: number;
  text: string;
  /** Texts of the inline buttons under the message, row by row. */
  buttons: string[][];
}

export interface TestBotOptions {
  env?: Record<string, string | undefined>;
  databasePath?: string;
  migrationsFolder?: string;
  now?: Date;
}

export interface TestBot {
  /** Every Bot API call the bot made, in order. */
  calls: ApiCall[];
  /** Every line the bot logged, in order. */
  logs: string[];
  /** Texts of the messages sent to one chat, in order, as they read now. */
  messagesTo(chatId: number): string[];
  /** The newest message sent to one chat, as it reads now. */
  lastMessageTo(chatId: number): ChatMessage;
  /** The reply keyboard the chat shows now, row by row, or undefined when none was sent. */
  keyboardOf(chatId: number): string[][] | undefined;
  /** Texts of the notifications shown to a user after tapping inline buttons, in order. */
  toastsTo(userId: number): string[];
  /** Moves the fake clock to this instant. */
  setNow(now: Date): void;
  sendPrivateMessage(from: TelegramUser, text: string): Promise<void>;
  /**
   * Someone adds the bot to a group: as a plain member, or as a group admin allowed to invite
   * users. With `mayPost: false` the group doesn't let the bot send messages.
   */
  addBotToGroup(by: TelegramUser, group: TelegramGroup, options?: { asGroupAdmin?: boolean; mayPost?: boolean }): Promise<void>;
  /** Someone removes the bot from a group. */
  removeBotFromGroup(by: TelegramUser, group: TelegramGroup): Promise<void>;
  /** Whether the bot is a member of this group now. */
  isInGroup(groupId: number): boolean;
  sendGroupMessage(from: TelegramUser, group: TelegramGroup, text: string): Promise<void>;
  /** A group admin who stays anonymous sends a message: Telegram doesn't say who. */
  sendAnonymousGroupMessage(group: TelegramGroup, text: string): Promise<void>;
  /** Someone renames a group. */
  renameGroup(by: TelegramUser, group: TelegramGroup, title: string): Promise<void>;
  /**
   * Telegram upgrades a group to a supergroup, which gets a new chat id. With `botAddedFirstBy`,
   * Telegram first reports the bot as added to the supergroup by that user, then announces the upgrade.
   */
  upgradeToSupergroup(group: TelegramGroup, supergroupId: number, options?: { botAddedFirstBy?: TelegramUser }): Promise<void>;
  /** Taps the inline button with this text on the newest message in the user's private chat that has it. */
  tap(from: TelegramUser, buttonText: string): Promise<void>;
  close(): void;
}

interface InlineButton {
  text: string;
  callback_data?: string;
}

interface StoredMessage {
  id: number;
  text: string;
  inlineKeyboard: InlineButton[][];
}

export async function startTestBot(options: TestBotOptions = {}): Promise<TestBot> {
  const calls: ApiCall[] = [];
  const logs: string[] = [];
  const chats = new Map<number, StoredMessage[]>();
  const replyKeyboards = new Map<number, string[][]>();
  const callbackQueryUsers = new Map<string, number>();
  const toasts: { userId: number; text: string }[] = [];
  /** The groups the bot is in, and what it may do there. */
  const groups = new Map<number, { canInviteUsers: boolean; mayPost: boolean }>();
  /** Groups upgraded to supergroups: the old chat id, and the new one. */
  const upgradedGroups = new Map<number, number>();
  let nextInviteLink = 1;
  let nextUpdateId = 1;
  let nextMessageId = 1;
  let now = options.now ?? new Date("2026-09-25T10:00:00Z");
  const clock = { now: () => now };
  const unixTime = () => Math.floor(clock.now().getTime() / 1000);

  const app: App = await startApp({
    env: options.env ?? VALID_ENV,
    databasePath: options.databasePath ?? ":memory:",
    migrationsFolder: options.migrationsFolder,
    dependencies: {
      clock,
      log: (line) => logs.push(line),
    },
    configureApi: (api) => {
      api.config.use(async (_prev, method, payload) => {
        const recorded = { ...payload } as Record<string, unknown>;
        calls.push({ method, payload: recorded });
        const upgradedTo = upgradedGroups.get(recorded.chat_id as number);
        if (upgradedTo !== undefined) {
          return {
            ok: false,
            error_code: 400,
            description: "Bad Request: group chat was upgraded to a supergroup chat",
            parameters: { migrate_to_chat_id: upgradedTo },
          } as never;
        }
        const problem = fakeProblem(method, recorded);
        if (problem) return { ok: false, error_code: 400, description: `Bad Request: ${problem}` } as never;
        return { ok: true, result: fakeResult(method, recorded) } as never;
      });
    },
  });

  function messagesOf(chatId: number): StoredMessage[] {
    if (!chats.has(chatId)) chats.set(chatId, []);
    return chats.get(chatId)!;
  }

  /** Why Telegram would refuse this call, or null when it would accept it. */
  function fakeProblem(method: string, payload: Record<string, unknown>): string | null {
    const chatId = payload.chat_id;
    if (typeof chatId !== "number" || chatId >= 0) return null;
    const membership = groups.get(chatId);
    if (!membership) return "bot is not a member of the group chat";
    if (method === "sendMessage" && !membership.mayPost) return "not enough rights to send text messages to the chat";
    if (method === "createChatInviteLink" && !membership.canInviteUsers) {
      return "not enough rights to manage chat invite links";
    }
    return null;
  }

  function fakeResult(method: string, payload: Record<string, unknown>): unknown {
    if (method === "getMe") return TEST_BOT_INFO;
    if (method === "leaveChat") groups.delete(payload.chat_id as number);
    if (method === "createChatInviteLink") {
      return {
        invite_link: `https://t.me/+fakeInvite${nextInviteLink++}`,
        creator: TEST_BOT_INFO,
        creates_join_request: false,
        is_primary: false,
        is_revoked: false,
        ...payload,
      };
    }
    if (method === "sendMessage") {
      const chatId = payload.chat_id as number;
      const message = { id: nextMessageId++, text: String(payload.text), inlineKeyboard: inlineKeyboardOf(payload) };
      messagesOf(chatId).push(message);
      const markup = payload.reply_markup as { keyboard?: ({ text: string } | string)[][] } | undefined;
      if (markup?.keyboard) {
        replyKeyboards.set(
          chatId,
          markup.keyboard.map((row) => row.map((button) => (typeof button === "string" ? button : button.text))),
        );
      }
      return telegramMessage(chatId, message);
    }
    if (method === "editMessageText") {
      const chatId = payload.chat_id as number;
      const message = messagesOf(chatId).find((m) => m.id === payload.message_id);
      if (!message) throw new Error(`The bot edited message ${payload.message_id}, which chat ${chatId} doesn't have`);
      // Like Telegram, editing the text without a reply_markup drops the inline keyboard.
      message.text = String(payload.text);
      message.inlineKeyboard = inlineKeyboardOf(payload);
      return telegramMessage(chatId, message);
    }
    if (method === "answerCallbackQuery") {
      const userId = callbackQueryUsers.get(String(payload.callback_query_id));
      if (userId !== undefined && payload.text !== undefined) toasts.push({ userId, text: String(payload.text) });
    }
    return true;
  }

  function inlineKeyboardOf(payload: Record<string, unknown>): InlineButton[][] {
    const markup = payload.reply_markup as { inline_keyboard?: InlineButton[][] } | undefined;
    return markup?.inline_keyboard ?? [];
  }

  function telegramMessage(chatId: number, message: StoredMessage) {
    return {
      message_id: message.id,
      date: unixTime(),
      chat: { id: chatId, type: "private" },
      text: message.text,
    };
  }

  function asChatMessage(message: StoredMessage): ChatMessage {
    return {
      id: message.id,
      text: message.text,
      buttons: message.inlineKeyboard.map((row) => row.map((button) => button.text)),
    };
  }

  async function handle(update: Omit<Update, "update_id">): Promise<void> {
    await app.bot.handleUpdate({ update_id: nextUpdateId++, ...update });
  }

  /** Supergroup chat ids start with -100, e.g. -1004001 here. */
  /** A text message, with the command marked up the way Telegram does. */
  function textContent(text: string) {
    const isCommand = text.startsWith("/");
    const commandLength = isCommand ? text.split(" ")[0]!.length : 0;
    return { text, ...(isCommand ? { entities: [{ type: "bot_command", offset: 0, length: commandLength }] } : {}) };
  }

  const groupChat = (group: TelegramGroup) =>
    ({ id: group.id, type: String(group.id).startsWith("-100") ? "supergroup" : "group", title: group.title }) as const;

  /** Telegram's stand-in sender for group admins who stay anonymous. */
  const GROUP_ANONYMOUS_BOT = { id: 1087968824, first_name: "Group", username: "GroupAnonymousBot" };

  /** A service or text message in a group, as Telegram delivers it. */
  function groupMessage(from: TelegramUser, group: TelegramGroup, content: Record<string, unknown>) {
    return handle({
      message: {
        message_id: nextMessageId++,
        date: unixTime(),
        chat: groupChat(group),
        from: { ...from, is_bot: false },
        ...content,
      } as never,
    });
  }

  type BotStatus = "member" | "administrator" | "left";

  function botMembershipChange(by: TelegramUser, group: TelegramGroup, before: BotStatus, after: BotStatus) {
    const status = (name: BotStatus) =>
      name === "administrator"
        ? {
            status: "administrator",
            user: TEST_BOT_INFO,
            can_be_edited: false,
            is_anonymous: false,
            can_manage_chat: true,
            can_delete_messages: false,
            can_manage_video_chats: false,
            can_restrict_members: false,
            can_promote_members: false,
            can_change_info: false,
            can_invite_users: true,
            can_post_stories: false,
            can_edit_stories: false,
            can_delete_stories: false,
          }
        : { status: name, user: TEST_BOT_INFO };
    return handle({
      my_chat_member: {
        chat: groupChat(group),
        from: { ...by, is_bot: false },
        date: unixTime(),
        old_chat_member: status(before),
        new_chat_member: status(after),
      } as never,
    });
  }

  return {
    calls,
    logs,
    messagesTo: (chatId) => messagesOf(chatId).map((message) => message.text),
    lastMessageTo: (chatId) => {
      const message = messagesOf(chatId).at(-1);
      if (!message) throw new Error(`Chat ${chatId} has no messages`);
      return asChatMessage(message);
    },
    keyboardOf: (chatId) => replyKeyboards.get(chatId),
    setNow: (instant) => {
      now = instant;
    },
    toastsTo: (userId) => toasts.filter((toast) => toast.userId === userId).map((toast) => toast.text),
    sendPrivateMessage: (from, text) => {
      const isCommand = text.startsWith("/");
      const commandLength = isCommand ? text.split(" ")[0]!.length : 0;
      return handle({
        message: {
          message_id: nextMessageId++,
          date: unixTime(),
          chat: { id: from.id, type: "private", first_name: from.first_name },
          from: { ...from, is_bot: false },
          text,
          ...(isCommand ? { entities: [{ type: "bot_command", offset: 0, length: commandLength }] } : {}),
        },
      });
    },
    tap: (from, buttonText) => {
      const message = messagesOf(from.id).findLast((m) => m.inlineKeyboard.flat().some((b) => b.text === buttonText));
      const button = message?.inlineKeyboard.flat().find((b) => b.text === buttonText);
      if (!message || button?.callback_data === undefined) {
        throw new Error(`Chat ${from.id} has no message with a "${buttonText}" button`);
      }
      const callbackQueryId = String(nextUpdateId);
      callbackQueryUsers.set(callbackQueryId, from.id);
      return handle({
        callback_query: {
          id: callbackQueryId,
          from: { ...from, is_bot: false },
          chat_instance: String(from.id),
          data: button.callback_data,
          message: {
            message_id: message.id,
            date: unixTime(),
            chat: { id: from.id, type: "private", first_name: from.first_name },
            from: { ...TEST_BOT_INFO },
            text: message.text,
          },
        },
      });
    },
    addBotToGroup: async (by, group, { asGroupAdmin = false, mayPost = true } = {}) => {
      groups.set(group.id, { canInviteUsers: asGroupAdmin, mayPost });
      // Telegram announces the new member in the group, and tells the bot its own status changed.
      // The two updates may come in either order; the announcement comes first here.
      await groupMessage(by, group, { new_chat_members: [{ ...TEST_BOT_INFO }] });
      if (groups.has(group.id)) await botMembershipChange(by, group, "left", asGroupAdmin ? "administrator" : "member");
    },
    removeBotFromGroup: async (by, group) => {
      const wasAdmin = groups.get(group.id)?.canInviteUsers ?? false;
      groups.delete(group.id);
      await botMembershipChange(by, group, wasAdmin ? "administrator" : "member", "left");
    },
    isInGroup: (groupId) => groups.has(groupId),
    sendGroupMessage: (from, group, text) => groupMessage(from, group, textContent(text)),
    sendAnonymousGroupMessage: (group, text) =>
      groupMessage(GROUP_ANONYMOUS_BOT, group, { ...textContent(text), sender_chat: groupChat(group) }),
    renameGroup: (by, group, title) => groupMessage(by, { ...group, title }, { new_chat_title: title }),
    upgradeToSupergroup: async (group, supergroupId, { botAddedFirstBy } = {}) => {
      const membership = groups.get(group.id);
      groups.delete(group.id);
      if (membership) groups.set(supergroupId, membership);
      upgradedGroups.set(group.id, supergroupId);
      const supergroup = { id: supergroupId, title: group.title };
      if (botAddedFirstBy) await botMembershipChange(botAddedFirstBy, supergroup, "left", "administrator");
      await groupMessage(GROUP_ANONYMOUS_BOT, group, { migrate_to_chat_id: supergroupId });
      await groupMessage(GROUP_ANONYMOUS_BOT, supergroup, { migrate_from_chat_id: group.id });
    },
    close: () => app.close(),
  };
}
