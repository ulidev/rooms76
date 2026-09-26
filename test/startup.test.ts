import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { MIGRATIONS_FOLDER } from "../src/db/database.ts";
import { startTestBot, type TestBot } from "./harness.ts";

let dir: string;
let bot: TestBot | undefined;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rooms76-"));
});
afterEach(() => {
  bot?.close();
  bot = undefined;
  rmSync(dir, { recursive: true, force: true });
});

const anyone = { id: 4242, first_name: "Mallory" };

test("at startup the bot sets its commands, description and short description", async () => {
  bot = await startTestBot();

  const call = (method: string) => bot!.calls.find((c) => c.method === method)?.payload;
  expect(call("setMyCommands")).toEqual({
    commands: [
      { command: "start", description: "Open the bot" },
      { command: "name", description: "Change your name" },
      { command: "invites", description: "Create and revoke Invites (Admins)" },
      { command: "link", description: "Link the Apartment Group (Admins)" },
      { command: "about", description: "About rooms76 and its data sources" },
    ],
  });
  expect(call("setMyDescription")?.description).toMatch(/take turns buying the common items/);
  expect(call("setMyShortDescription")?.short_description).toMatch(/take turns buying/i);
});

test("/about credits Open Food Facts data (ODbL) and photos (CC BY-SA 3.0)", async () => {
  bot = await startTestBot();

  await bot.sendPrivateMessage(anyone, "/about");

  const [about] = bot.messagesTo(anyone.id);
  expect(about).toContain("Open Food Facts");
  expect(about).toContain("Open Database License (ODbL)");
  expect(about).toContain("Creative Commons Attribution-ShareAlike 3.0 (CC BY-SA 3.0)");
});

test("the bot migrates a fresh database and starts again on the same database", async () => {
  const databasePath = join(dir, "rooms76.sqlite");

  (await startTestBot({ databasePath })).close();
  bot = await startTestBot({ databasePath });

  await bot.sendPrivateMessage(anyone, "/start");
  expect(bot.messagesTo(anyone.id)).toHaveLength(1);
});

test("the bot refuses to start on a database a newer version has migrated", async () => {
  const databasePath = join(dir, "rooms76.sqlite");
  (await startTestBot({ databasePath, migrationsFolder: newerBotMigrations() })).close();

  await expect(startTestBot({ databasePath })).rejects.toThrow(
    "The database schema is newer than this version of rooms76.",
  );
});

/** The migrations of a future bot version: this version's, plus one more. */
function newerBotMigrations(): string {
  const folder = join(dir, "newer-migrations");
  cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
  const journalPath = join(folder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  const last = journal.entries.at(-1);
  const tag = "9999_from_the_future";
  journal.entries.push({ ...last, idx: last.idx + 1, when: last.when + 1000, tag });
  writeFileSync(journalPath, JSON.stringify(journal));
  writeFileSync(join(folder, `${tag}.sql`), "CREATE TABLE from_the_future (id integer PRIMARY KEY);");
  return folder;
}
