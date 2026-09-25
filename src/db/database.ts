import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import * as schema from "./schema.ts";

export type Db = BetterSQLite3Database<typeof schema>;

export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../migrations", import.meta.url));

export class SchemaTooNewError extends Error {
  constructor() {
    super(
      "The database schema is newer than this version of rooms76. " +
        "Run the same or a newer version of the bot; downgrading could corrupt the data.",
    );
    this.name = "SchemaTooNewError";
  }
}

/**
 * Opens the database and brings its schema up to date. Refuses to open a
 * database that a newer version of the bot has already migrated.
 */
export function openDatabase(path: string, migrationsFolder = MIGRATIONS_FOLDER): { db: Db; close(): void } {
  if (path !== ":memory:" && !existsSync(dirname(path))) {
    throw new Error(`${dirname(path)} doesn't exist. Mount a persistent volume there for the database.`);
  }
  const sqlite = new Database(path);
  try {
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");

    const latestKnown = Math.max(...readMigrationFiles({ migrationsFolder }).map((m) => m.folderMillis));
    if (latestApplied(sqlite) > latestKnown) throw new SchemaTooNewError();

    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder });
    return { db, close: () => sqlite.close() };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}

/** The timestamp of the newest migration applied to this database, or 0 for a fresh one. */
function latestApplied(sqlite: Database.Database): number {
  const table = sqlite
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
    .get();
  if (!table) return 0;
  const row = sqlite.prepare("SELECT MAX(created_at) AS latest FROM __drizzle_migrations").get() as {
    latest: number | null;
  };
  return row.latest ?? 0;
}
