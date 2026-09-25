# Stack, persistence and hosting for a self-deployed rooms76 instance

Research for [#3](https://github.com/ulidev/rooms76/issues/3). Sources were checked on **2026-09-25**. Prices and free tiers change often, so treat every number marked "(pricing, 2026-09)" as a snapshot and re-check it before quoting it in the README.

## Recommendation (TL;DR)

| Layer | Choice | Why, in one line |
|---|---|---|
| Language/runtime | TypeScript on **Node.js 24 LTS** | Supported until 2028-04-30. Node 26 becomes LTS on 2026-10-28, so it is also fine later. |
| Bot framework | **grammY** | TS-first, has guide-style docs, and tracks the current Bot API (10.3). Telegraf's last release was Feb 2024 (Bot API 7.1). |
| Update delivery | **Long polling** by default | No public URL or TLS needed for the bot itself. Switch to a webhook only for a serverless target. |
| Database | **SQLite**, one file on a persistent volume | An Apartment's data is tiny. No second service, no credentials, and a backup is just a copy of the file. |
| DB driver | **better-sqlite3** | Mature and synchronous, and it is the SQLite driver that Drizzle, Kysely and Prisma all support. |
| ORM / query builder | **Drizzle ORM** plus drizzle-kit, with migrations run at startup | The schema lives in TS, the SQL migration files are generated and committed, and it needs no codegen or engine step at runtime. |
| Packaging | One **Dockerfile** (Debian-slim base) with the SQLite file on a mounted volume | The same image runs on Railway, Fly.io, Render and any VPS. |
| Documented deploy path | **Railway template ("Deploy on Railway" button)** as the easiest path, **Fly.io** as the cheapest managed option, **VPS with Docker Compose and Caddy** for DIY users | See the comparison below. |
| Product photos | Store Telegram's `file_id`, not the image bytes | Nothing to store or back up beyond a string. |

The core idea is that **one portable container plus one SQLite file** keeps the code identical wherever an Apartment deploys it. Hosting then becomes a documentation choice, not an architecture choice. Cloudflare Workers + D1 is the only candidate that would force a different architecture (webhook-only, no Node process, async D1 bindings), so it is **not** the primary target. It is still worth considering later as a "$0" variant, because Drizzle supports D1 and the schema could be reused.

---

## 1. Bot framework: grammY vs Telegraf

| | grammY | Telegraf |
|---|---|---|
| Latest release | v1.46.0, 2026-08-26, "compatibility with Telegram Bot API version 10.3" [G1] | v4.16.3, 2024-02-29, Bot API 7.0/7.1 [T1]. The repo still gets maintenance commits (CI, deps) as of 2026-09-24, but there has been no release since [T2]. |
| Current Bot API | 10.3 (2026-08-24) [TG1] | about 3 major Bot API versions behind |
| TypeScript | Designed TS-first. grammY's own comparison says Telegraf v4's TS migration produced types that made it "substantially harder to use" [G2]. | Written in TS, but with complex types [G2] |
| Docs for a newcomer | Full step-by-step guide plus a hosting section (grammy.dev/guide, /hosting) [G2][G3] | Mostly a generated API reference. grammY's comparison says Telegraf's guide "was replaced by a generated API reference that lacks explanations" [G2]. |
| Mini App buttons | `InlineKeyboard.webApp()` and `Keyboard.webApp()` [G4] | `Markup.button.webApp` (exists, not re-verified for 2026) |

*Caveat:* the qualitative comparison [G2] is written by grammY's maintainers. The release dates and Bot API versions come from GitHub/npm and are objective.

**Mini App support is mostly not a framework concern.** A Mini App is a web page that loads `telegram-web-app.js`, and the bot only sends a button with a `web_app` URL [TG2]. The server side has to validate `initData` with an HMAC-SHA-256 whose key is derived from the bot token and the constant `"WebAppData"` [TG2]. Either framework can send the button. The validation is about 20 lines of `node:crypto`, or a small helper library.

## 2. Long polling vs webhook

- grammY's guidance: "If you don't have a good reason to use webhooks, then note that there are no major drawbacks to long polling." Long polling suits "servers running bots 24/7" and setups "without public URLs or SSL certificates" [G3].
- Webhooks are needed on serverless platforms and let infrastructure "scale down to zero" [G3]. They come with constraints:
  - grammY's `webhookCallback` times out after 10 s by default, after which Telegram may redeliver the update [G3].
  - Telegram only posts to ports 443, 80, 88 or 8443, over TLS 1.2+, IPv4 only [TG3][TG4].
  - While a webhook is set, `getUpdates` stops working [TG3].
- **Decision:** use long polling in the container. It removes a whole class of setup steps (domain, TLS, `setWebhook`) for self-deployers. Webhook mode can be an env-var switch later.

**Interaction with the Mini App.** Long polling means the *bot* needs no HTTPS, but a Mini App still does: `WebAppInfo.url` is "An HTTPS URL of a Web App" [TG3], and plain HTTP is only allowed on Telegram's test environment [TG2]. If [#2](https://github.com/ulidev/rooms76/issues/2) concludes that barcode scanning needs a Mini App, the same process can serve its static files and a small JSON API over HTTP behind the platform's TLS. Railway, Fly and Render all provide an HTTPS subdomain out of the box. On a VPS this requires a domain plus Caddy, which obtains and renews Let's Encrypt certificates automatically once DNS points at the server and ports 80/443 are open [C1].

Note for #2: the native `showScanQrPopup` scanner is documented as scanning "a QR code" and returning text data [TG2]. Whether it reliably reads EAN/UPC product barcodes is **not** stated in the docs, and that question belongs to #2.

## 3. Persistence

### SQLite vs Postgres

An Apartment has a handful of Rooms and Residents and a few dozen Common Items, Products and Purchases. That fits comfortably in a single SQLite file.

| | SQLite (file on volume) | Managed Postgres (free tiers) |
|---|---|---|
| Extra service / account | None | Yes: a second provider, a connection string, network latency |
| Free-tier gotchas | n/a | Neon Free: 0.5 GB/project, compute always scales to zero after 5 min, no card needed [N1]. Supabase Free: "paused after 1 week of inactivity", no automatic backups [S1]. Render free Postgres "expire[s] 30 days after creation" [R1]. |
| Backup | Copy one file. better-sqlite3 `.backup(dest)` returns a promise, and the result "is just a regular SQLite database file"; the DB stays usable during the backup [B2] | Provider-dependent (see the column to the left) |
| Requirement on host | A **persistent volume** (rules out Render's free tier, see §5) | None |

**Pick SQLite.** Postgres would only pay off for horizontal scaling, which a single-Apartment bot never needs.

### Driver: better-sqlite3 vs `node:sqlite` vs libsql

- **better-sqlite3** 13.0.3 (2026-08-05), `engines.node >= 22`. It has a synchronous API, and "Prebuilt binaries are available for major platforms/architectures". Otherwise it compiles natively [B1][npm]. **Tip:** use a Debian-based `node:24-slim` image rather than Alpine so the prebuilt binary applies.
- **`node:sqlite`** is built into Node. It left the flag in v22.13/v23.4, and is "Stability: 1.2 - Release candidate" as of v24.15/v25.7. It has `sqlite.backup()` [N2]. It would avoid the native module entirely, **but** the stable Drizzle release (0.45.3, 2026-09-21) ships drivers only for `better-sqlite3`, `libsql` and `d1`. The `node-sqlite` driver exists only in the Drizzle **1.0 beta** (checked by inspecting the npm tarballs). Revisit this when Drizzle 1.0 is stable.
- **libsql** (`@libsql/client` 0.18.0) is a SQLite fork that can use a local file or remote Turso, and adds more ALTER support and encryption [D1]. It is only useful if we later want a hosted DB, so it is not needed now.

### ORM / query builder

| | Drizzle | Kysely | Prisma 7 |
|---|---|---|---|
| Schema source | TS code | You hand-write TS interfaces, or generate them by introspection [K1] | `schema.prisma` (a DSL) |
| Codegen step | None at runtime. `drizzle-kit generate` produces SQL migration files [D2] | Optional type generation [K1] | `prisma generate` still needed. v7 replaced the Rust engine with a TS/WASM query compiler and requires driver adapters (e.g. `@prisma/adapter-better-sqlite3`) [P1][P2] |
| Migrations | `drizzle-kit generate` plus runtime `migrate()` at startup, a flow the docs describe as a common pattern [D2] | Built-in up/down migrations written in TS [K1] | `prisma migrate` |
| SQLite drivers (stable) | better-sqlite3, libsql, D1 | better-sqlite3 built in [K1] | better-sqlite3, libsql, D1 adapters [P2] |

**Pick Drizzle.** For a TS newcomer it has the fewest moving parts. The schema is plain TS that is fully typed. Migrations are readable SQL files committed to the repo, and `migrate()` on boot means a self-deployer never runs a migration command by hand. Kysely is a fine alternative if the owner prefers writing SQL-shaped queries. Prisma adds a DSL and a generate step for no benefit at this scale.

### Photos

Photos should not be stored as bytes. When a Resident sends a photo, the bot receives a `file_id` that it can re-send any time. "There are no limits for files sent this way", and `file_id` "is unique for each individual bot and can't be transferred" [TG3]. We store that string in SQLite. **Caveat:** showing such a photo *inside a Mini App* would need the server to proxy `getFile`, because the download URL contains the bot token [TG3].

## 4. Other runtime concerns

- **Sessions/conversation state:** grammY sessions default to RAM, and "all sessions are lost as soon as your bot stops" [G5]. Keep durable state in our own SQLite tables, and use sessions only for short-lived UI state.
- **Scheduled nudges** (if [#5](https://github.com/ulidev/rooms76/issues/5) introduces reminders): an always-on Node process can use a simple in-process timer. On Workers it would need Cron Triggers, which is another reason to keep the Node container as the primary target.

## 5. Hosting comparison (pricing, 2026-09)

Assumptions: one always-on container of about 256–512 MB RAM and a 1 GB volume.

| | **Railway** | **Fly.io** | **Render** | **Cloudflare Workers + D1** | **VPS (e.g. Hetzner) + Docker** |
|---|---|---|---|---|---|
| Always-on, est. monthly | **about $5**: Hobby is "$5/month, including $5 of monthly usage credits". Usage is RAM at about $10/GB-mo, CPU at about $20/vCPU-mo, volume at about $0.15/GB-mo [RW1]. A small bot should fit inside the $5 credit. The Free plan is "$1 of monthly usage credits" with a 0.5 GB volume [RW1], likely too little for always-on (unverified). | **about $2.2**: shared-cpu-1x 256 MB costs about $2.01/mo (512 MB about $3.31), plus $0.15/GB-mo volume [F1]. Card required for most accounts, or prepaid credits (min $25) [F2]. The trial is only 2 VM-hours or 7 days [F3]. | **about $7.25**: Starter costs $7/mo (512 MB, 0.5 CPU) plus a disk at $0.25/GB-mo [R2]. The free tier spins down after 15 min without **inbound** traffic and cannot have disks [R1], so it is unusable for a long-polling bot with SQLite. | **$0** on Workers Free (100k req/day, 10 ms CPU per invocation) [CF1]. D1 Free gives 5M rows read/day, 100k rows written/day, 5 GB [CF2]. Paid starts at $5/mo [CF1]. | **about €5.49 + IPv4 + VAT**: Hetzner CX23 (2 vCPU/4 GB) after the 2026-06-15 price increase; CAX11 costs €5.99 [H1]. Oracle Always Free exists (A1 2 OCPU/12 GB, or 2x 1 GB micro VMs), but Oracle reclaims instances that stay under 20% CPU/network/memory for 7 days [O1], which a bot likely would. |
| Persistence | Volume. Each service can only have a single volume. Redeploys cause brief downtime [RW2]. | Volume tied to one Machine on one host. Fly warns "Always provision at least two volumes per app" [F4]. We accept a single volume plus backups. | Paid disk, single instance, no zero-downtime deploys [R3] | D1, a managed SQLite | Local disk / Docker volume |
| Built-in backups | Volume backups: daily kept 6 days, weekly kept 27 days, monthly kept 89 days [RW3]. Which plans can use them is not stated on that page. | Daily snapshots, 5-day default retention (configurable 1–60), "shouldn't substitute" for real backups [F4]. $0.08/GB-mo after the first 10 GB free [F1]. | Daily disk snapshot, kept ≥ 7 days [R3] | Time Travel point-in-time restore: 7 days Free, 30 days Paid [CF3] | None by default. Hetzner sells server backups as an add-on. You would add a cron job that copies the `.backup()` file off-box. |
| HTTPS for a Mini App | Yes, a provided subdomain | Yes, `*.fly.dev` with a shared IPv4; a dedicated IPv4 costs $2/mo [F1] | Yes, `*.onrender.com` | Yes, `*.workers.dev`, and static assets are free [CF1] | You bring a domain, and Caddy handles TLS [C1] |
| Steps for a non-expert | **Fewest.** The repo author publishes a template (service from the GitHub repo, attached volume, required variables) and gets a one-click deploy URL [RW4]. The user signs up, clicks, and pastes `BOT_TOKEN`. | Install `flyctl`, sign up and add a card, `fly launch`, `fly volumes create`, `fly secrets set BOT_TOKEN=…`, `fly deploy`. It is CLI-only, but we can script it. | "Deploy to Render" button driven by `render.yaml`. `sync: false` prompts for secrets and `disk:` declares the disk [R4]. It is about as easy as Railway, but costs more. | Install `wrangler`, create the D1 DB, set secrets, set `BOT_INFO`, deploy, then call `setWebhook` by hand [G6]. | The most steps: create the server, SSH in, install Docker, clone, `.env`, `docker compose up -d`, plus a domain and DNS if a Mini App is needed. |
| Code impact | none | none | none | **Large**: webhook-only, Workers runtime, D1 async API, no in-process timers | none |

### Reading the table

- **Railway** gives the smoothest non-expert path (a button plus one pasted token), and its volume backups have the best built-in retention. It costs about $5/mo flat.
- **Fly.io** is the cheapest always-on managed option at about $2–3/mo, with automatic snapshots and free HTTPS. It is CLI-driven and needs a card.
- **Render** is simple, but at about $7.25/mo it is the most expensive managed option for this workload, and its free tier cannot run this bot.
- **VPS** has the best price/performance and full control, but the most steps and no backups unless we script them. It suits technically confident Apartments.
- **Cloudflare** costs $0 and has built-in PITR, but it would force a second architecture. Keep it as a possible future port.

## 6. Proposed deployable shape

```
Dockerfile (node:24-slim) ── runs `node dist/main.js`
  ├─ on boot: drizzle migrate() against $DATABASE_PATH (default /data/rooms76.db)
  ├─ grammY bot via long polling (bot.start())
  ├─ optional: tiny HTTP server for Mini App static files + initData-validated API (only if #2 needs it)
  └─ optional: periodic better-sqlite3 .backup() to /data/backups (rotated)
Volume mounted at /data
Env: BOT_TOKEN (required), DATABASE_PATH, PORT (only if Mini App)
```

Ship a `railway` template link and a `fly.toml` plus deploy script in the README. Add a `docker-compose.yml` with Caddy for VPS users.

## Uncertainties and date-sensitive items

1. **All prices** are a 2026-09 snapshot. Hetzner raised prices on 2026-06-15 [H1], and Railway/Fly have changed plans repeatedly.
2. **Railway Free plan** ($1/mo credit): whether a tiny always-on bot fits was not verified. The docs also do not say which plans get volume backups [RW3].
3. **Fly.io**: the docs do not mention any waiver for small invoices, and cost could vary with region pricing [F1][F2].
4. **Telegraf Mini App helpers** were not re-verified against 2026 docs. The conclusion does not depend on them.
5. **Drizzle + `node:sqlite`** is only available in Drizzle 1.0 beta. If Drizzle 1.0 goes stable, `node:sqlite` could replace better-sqlite3 and drop the native module.
6. **Barcode scanning path** (#2) decides whether HTTPS and a web server are needed at all. If the native QR popup or photo-based decoding is enough, the container can be a pure long-polling worker with no exposed port.

## Sources

- [G1] grammY releases (v1.46.0, 2026-08-26): https://github.com/grammyjs/grammY/releases
- [G2] grammY vs other frameworks: https://grammy.dev/resources/comparison
- [G3] grammY, Long polling vs webhooks: https://grammy.dev/guide/deployment-types
- [G4] grammY `InlineKeyboard.webApp`: https://grammy.dev/ref/core/inlinekeyboard
- [G5] grammY sessions: https://grammy.dev/plugins/session
- [G6] grammY on Cloudflare Workers (Node.js): https://grammy.dev/hosting/cloudflare-workers-nodejs
- [T1] Telegraf releases (v4.16.3, 2024-02-29): https://github.com/telegraf/telegraf/releases
- [T2] Telegraf commits (GitHub API, latest 2026-09-24): https://github.com/telegraf/telegraf/commits
- [TG1] Telegram Bot API, recent changes (Bot API 10.3, 2026-08-24): https://core.telegram.org/bots/api#recent-changes
- [TG2] Telegram Mini Apps: https://core.telegram.org/bots/webapps
- [TG3] Telegram Bot API (WebAppInfo, setWebhook notes, sending files, getFile): https://core.telegram.org/bots/api
- [TG4] Telegram webhook guide: https://core.telegram.org/bots/webhooks
- [N2] Node.js `node:sqlite`: https://nodejs.org/api/sqlite.html. Node release schedule: https://github.com/nodejs/Release/blob/main/schedule.json
- [B1] better-sqlite3 README: https://github.com/WiseLibs/better-sqlite3
- [B2] better-sqlite3 API (`.backup()`): https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
- [npm] `npm view` for better-sqlite3, drizzle-orm, @libsql/client, kysely, prisma, grammy (2026-09-25), plus the drizzle-orm 0.45.3 and 1.0.0-beta.22 tarball contents
- [D1] Drizzle, Get started with SQLite: https://orm.drizzle.team/docs/get-started-sqlite
- [D2] Drizzle migrations: https://orm.drizzle.team/docs/migrations
- [K1] Kysely getting started: https://kysely.dev/docs/getting-started
- [P1] Prisma 7 announcement: https://www.prisma.io/blog/announcing-prisma-orm-7-0-0
- [P2] Prisma SQLite docs: https://www.prisma.io/docs/orm/overview/databases/sqlite
- [N1] Neon pricing: https://neon.com/pricing
- [S1] Supabase pricing: https://supabase.com/pricing
- [RW1] Railway pricing: https://railway.com/pricing
- [RW2] Railway volumes: https://docs.railway.com/reference/volumes
- [RW3] Railway backups: https://docs.railway.com/reference/backups
- [RW4] Railway, create a template: https://docs.railway.com/guides/create
- [F1] Fly.io pricing: https://docs.fly.io/about/pricing/
- [F2] Fly.io billing: https://docs.fly.io/about/billing/
- [F3] Fly.io free trial: https://docs.fly.io/about/free-trial/
- [F4] Fly.io volumes overview: https://docs.fly.io/volumes/overview/
- [R1] Render, Deploy for free: https://render.com/docs/free
- [R2] Render pricing: https://render.com/pricing
- [R3] Render persistent disks: https://render.com/docs/disks
- [R4] Render Blueprint spec / Deploy to Render: https://render.com/docs/blueprint-spec, https://render.com/docs/deploy-to-render
- [CF1] Cloudflare Workers pricing: https://developers.cloudflare.com/workers/platform/pricing/
- [CF2] Cloudflare D1 pricing: https://developers.cloudflare.com/d1/platform/pricing/
- [CF3] D1 Time Travel: https://developers.cloudflare.com/d1/reference/time-travel/
- [H1] Hetzner price adjustment (2026-06-15): https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/
- [O1] Oracle Cloud Always Free resources: https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- [C1] Caddy automatic HTTPS: https://caddyserver.com/docs/automatic-https
