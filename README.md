# rooms76

A self-deployed Telegram bot that helps the people sharing an apartment take turns buying the common items: kitchen paper, dish soap, toilet paper and the like. It knows whose Turn it is, tells the right Room when something runs out, and records Purchases by scanning the barcode.

> Work in progress. The deploy guide (Fly.io, Railway, `docker compose`) comes with the Docker image.

## Configuration

The bot is configured only through environment variables. If any is missing or invalid, it refuses to start and names every problem in one error.

| Variable | Required | Meaning |
|---|---|---|
| `BOT_TOKEN` | yes | From [@BotFather](https://t.me/BotFather) (`/newbot`). |
| `OPERATOR_TELEGRAM_ID` | yes | Your numeric Telegram user id. It makes you the first Admin. |
| `APARTMENT_TIMEZONE` | yes | IANA time zone name, e.g. `Europe/Berlin`. Defines "today" for the Apartment. |
| `OFF_CONTACT` | yes | An email or URL where Open Food Facts can reach you; sent in the User-Agent. |
| `SCANNER_URL` | no | Unset: the shared scanner page. Any https URL overrides it. Empty: hides `📷 Scan`. |

The database lives at `/data/rooms76.sqlite`; mount a persistent volume at `/data`. Migrations run automatically at startup, and the bot refuses to start on a database migrated by a newer version.

## First run

Send `/start` to your bot. As the Operator you become the first Admin, and the bot walks you through setup: type the Rooms (their order becomes the Room Order), then pick your own Room. Linking the Apartment Group and inviting the other Residents can wait.

**Inviting the other Residents:** send `/invites` and create an Invite for their Room. You get a single-use link that expires after 7 days; whoever opens it becomes a Resident of that Room straight away. `/invites` also lists the pending Invites so you can revoke them.

**Common Items and Purchases:** any Resident adds a Common Item with `➕ Add item`, or by typing a name the bot doesn't know yet. Typing what happened, e.g. "bought kitchen paper", records a Purchase for your Room. Each Common Item has its own Rotation: the Turn goes to the Room with the fewest Purchases, ties broken by the Room Order counted from the Room that bought first. A Room that buys out of turn is skipped later, and the Residents of the Room whose Turn comes up hear it privately.

**Finding your Telegram user id:** if the bot tells you to ask an Admin for an Invite instead, `OPERATOR_TELEGRAM_ID` is wrong. The bot logs `/start from unknown user <id> (<name>)` with your real id.

## Development

Requires Node 24 (see `.nvmrc`). TypeScript runs directly on Node, with no build step.

```sh
npm install
npm test            # Vitest
npm run typecheck   # tsc --noEmit
npm run db:generate # after changing src/db/schema.ts: generate a migration and commit it
```

## Credits

Product data comes from [Open Food Facts](https://world.openfoodfacts.org), available under the [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/1-0/). Product photos from Open Food Facts are available under [Creative Commons Attribution-ShareAlike 3.0](https://creativecommons.org/licenses/by-sa/3.0/).

## Licence

[MIT](LICENSE)
