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
  /** Texts of the messages sent to one chat, in order. */
  messagesTo(chatId: number): string[];
  sendPrivateMessage(from: TelegramUser, text: string): Promise<void>;
  close(): void;
}

export async function startTestBot(options: TestBotOptions = {}): Promise<TestBot> {
  const calls: ApiCall[] = [];
  const logs: string[] = [];
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
        calls.push({ method, payload: { ...payload } as Record<string, unknown> });
        return { ok: true, result: fakeResult(method, payload as Record<string, unknown>) } as never;
      });
    },
  });

  function fakeResult(method: string, payload: Record<string, unknown>): unknown {
    if (method === "getMe") return TEST_BOT_INFO;
    if (method === "sendMessage") {
      return {
        message_id: nextMessageId++,
        date: unixTime(),
        chat: { id: payload.chat_id, type: "private" },
        text: payload.text,
      };
    }
    return true;
  }

  async function handle(update: Omit<Update, "update_id">): Promise<void> {
    await app.bot.handleUpdate({ update_id: nextUpdateId++, ...update });
  }

  return {
    calls,
    logs,
    messagesTo: (chatId) =>
      calls
        .filter((call) => call.method === "sendMessage" && call.payload.chat_id === chatId)
        .map((call) => String(call.payload.text)),
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
    close: () => app.close(),
  };
}
