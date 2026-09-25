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
  sendPrivateMessage(from: TelegramUser, text: string): Promise<void>;
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
  let nextUpdateId = 1;
  let nextMessageId = 1;
  const clock = { now: () => options.now ?? new Date("2026-09-25T10:00:00Z") };
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
        return { ok: true, result: fakeResult(method, recorded) } as never;
      });
    },
  });

  function messagesOf(chatId: number): StoredMessage[] {
    if (!chats.has(chatId)) chats.set(chatId, []);
    return chats.get(chatId)!;
  }

  function fakeResult(method: string, payload: Record<string, unknown>): unknown {
    if (method === "getMe") return TEST_BOT_INFO;
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
    close: () => app.close(),
  };
}
