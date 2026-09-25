// Wires configuration, database and bot together. `main.ts` runs this against the
// real world; the tests run it in process with fakes at the external boundaries.
import type { Api, Bot } from "grammy";
import { createBot } from "./bot.ts";
import { createChatStates } from "./chat-states.ts";
import type { Clock } from "./clock.ts";
import { readConfig } from "./config.ts";
import { openDatabase } from "./db/database.ts";
import { setUpProfile } from "./profile.ts";
import { createInvites } from "./invites.ts";
import { createResidents } from "./residents.ts";
import { createSetup } from "./setup.ts";

export interface AppDependencies {
  clock: Clock;
  log(line: string): void;
}

export interface StartOptions {
  env: Record<string, string | undefined>;
  databasePath: string;
  dependencies: AppDependencies;
  /** Defaults to the migrations shipped with this version of the bot. */
  migrationsFolder?: string;
  /** Lets tests record Bot API calls instead of sending them. */
  configureApi?(api: Api): void;
}

export interface App {
  bot: Bot;
  close(): void;
}

/** Validates the config, migrates the database and prepares the bot. Throws when the bot must not start. */
export async function startApp(options: StartOptions): Promise<App> {
  const config = readConfig(options.env);
  const database = openDatabase(options.databasePath, options.migrationsFolder);
  try {
    const { clock, log } = options.dependencies;
    const residents = createResidents(database.db, clock, config.apartmentTimeZone);
    const setup = createSetup(database.db, clock, config.apartmentTimeZone, config.operatorTelegramId);
    const bot = createBot(config.botToken, {
      residents,
      setup,
      invites: createInvites(database.db, clock, config.apartmentTimeZone, residents),
      chatStates: createChatStates(database.db),
      scannerUrl: config.scannerUrl,
      log,
    });
    options.configureApi?.(bot.api);
    await bot.init();
    await setUpProfile(bot.api);
    return { bot, close: database.close };
  } catch (error) {
    database.close();
    throw error;
  }
}
