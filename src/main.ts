// Entry point: `node src/main.ts`. Starts the bot with long polling.
import { startApp } from "./app.ts";
import { systemClock } from "./clock.ts";

/** The database lives on a persistent volume mounted at /data. */
const DATABASE_PATH = "/data/rooms76.sqlite";

try {
  const app = await startApp({
    env: process.env,
    databasePath: DATABASE_PATH,
    dependencies: { clock: systemClock, log: (line) => console.log(line) },
  });
  const stop = () => app.bot.stop();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  await app.bot.start({ onStart: (me) => console.log(`rooms76 is running as @${me.username}`) });
  app.close();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
