// Throwaway field-test bot for "Field-test barcode decoding" (ulidev/rooms76#10).
// Long polling. Logs every scan attempt to data/results.jsonl; /report summarises them.
//
//   BOT_TOKEN=... SCANNER_URL=https://ulidev.github.io/rooms76/scanner-test/ node bot.mjs
import { appendFileSync, mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Bot, Keyboard } from "grammy";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";

const { BOT_TOKEN, SCANNER_URL = "https://ulidev.github.io/rooms76/scanner-test/" } = process.env;
if (!BOT_TOKEN) throw new Error("Set BOT_TOKEN (a test bot from @BotFather)");

const DATA = new URL("./data/", import.meta.url);
const RESULTS = new URL("results.jsonl", DATA);
const PHOTOS = new URL("photos/", DATA);
mkdirSync(PHOTOS, { recursive: true });

// Load the wasm from node_modules instead of jsDelivr.
const require = createRequire(import.meta.url);
prepareZXingModule({
  overrides: { wasmBinary: readFileSync(require.resolve("zxing-wasm/reader/zxing_reader.wasm")).buffer },
});

const FORMATS = ["EAN13", "EAN8", "UPCA", "UPCE"];
const USER_AGENT = "rooms76-fieldtest/0.1 (https://github.com/ulidev/rooms76)";

// ---- helpers ----

function validGtin(digits) {
  if (!/^\d{8}$|^\d{12,14}$/.test(digits)) return false;
  const body = digits.slice(0, -1).split("").reverse();
  const sum = body.reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === Number(digits.at(-1));
}

// UPC-A is stored as GTIN-13 (see the camera Mini App research, #12).
const toGtin13 = (code) => (code.length === 12 ? "0" + code : code);

const lookupCache = new Map();
async function lookup(code) {
  if (lookupCache.has(code)) return lookupCache.get(code);
  const url =
    `https://world.openfoodfacts.org/api/v3/product/${code}?product_type=all` +
    `&fields=code,product_name,product_name_de,product_name_en,brands,quantity,image_front_small_url,product_type`;
  const t0 = performance.now();
  let result;
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    const body = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
    const p = body?.product;
    result = {
      http: res.status,
      found: Boolean(p),
      productType: p?.product_type ?? null,
      name: p?.product_name_de || p?.product_name || p?.product_name_en || null,
      brands: p?.brands ?? null,
      quantity: p?.quantity ?? null,
      hasImage: Boolean(p?.image_front_small_url),
      ms: Math.round(performance.now() - t0),
    };
  } catch (err) {
    result = { http: null, found: false, error: String(err), ms: Math.round(performance.now() - t0) };
  }
  if (result.http === 200 || result.http === 404) lookupCache.set(code, result);
  return result;
}

// Resident memory, to check a 256 MB Fly.io machine is enough (from ulidev/rooms76#11).
const mb = (bytes) => Math.round(bytes / 2 ** 20);
let peakRss = process.memoryUsage().rss;
setInterval(() => (peakRss = Math.max(peakRss, process.memoryUsage().rss)), 250).unref();
function memory() {
  const { rss, heapUsed, external } = process.memoryUsage();
  peakRss = Math.max(peakRss, rss);
  return { rssMb: mb(rss), peakRssMb: mb(peakRss), heapMb: mb(heapUsed), externalMb: mb(external) };
}

function log(row) {
  appendFileSync(RESULTS, JSON.stringify({ at: new Date().toISOString(), ...row }) + "\n");
}

function readRows() {
  if (!existsSync(RESULTS)) return [];
  return readFileSync(RESULTS, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

function describeLookup(l) {
  if (!l) return "";
  if (l.found) return `✅ Found on Open ${l.productType ?? "?"} Facts: ${l.name ?? "(no name)"}${l.brands ? ` · ${l.brands}` : ""}${l.quantity ? ` · ${l.quantity}` : ""}${l.hasImage ? " · has photo" : ""}`;
  if (l.http === 404) return "❌ Not on Open Food Facts / Open Products Facts";
  return `⚠️ Lookup failed (HTTP ${l.http ?? "—"}${l.error ? `, ${l.error}` : ""})`;
}

// ---- bot ----

const bot = new Bot(BOT_TOKEN);
const currentItem = new Map(); // chat id → item label

const keyboard = new Keyboard().webApp("📷 Scan", SCANNER_URL).persistent().resized();

bot.command("start", (ctx) =>
  ctx.reply(
    [
      "rooms76 field test. For each item:",
      "1. /item <short name>, e.g. /item K-Classic Spülmittel",
      "2. 📷 Scan it live (answer the prompt question honestly)",
      "3. Send a photo of the barcode, as you'd do in the shop",
      "Typed digits also work and count as a lookup-only row.",
      "/report shows the numbers so far.",
    ].join("\n"),
    { reply_markup: keyboard },
  ),
);

bot.command("item", async (ctx) => {
  const label = ctx.match.trim();
  if (!label) return ctx.reply("Usage: /item <short name>");
  currentItem.set(ctx.chat.id, label);
  await ctx.reply(`Current item: ${label}. Now scan it live and send a photo.`, { reply_markup: keyboard });
});

bot.on("message:web_app_data", async (ctx) => {
  let data;
  try {
    data = JSON.parse(ctx.message.web_app_data.data);
  } catch {
    data = { method: "live", code: ctx.message.web_app_data.data };
  }
  const item = currentItem.get(ctx.chat.id) ?? null;
  const code = data.code && validGtin(data.code) ? toGtin13(data.code) : null;
  const lk = code ? await lookup(code) : null;
  log({ kind: data.method === "typed" ? "typed" : "live", item, code, page: data, lookup: lk });

  if (!data.code) {
    return ctx.reply(`📷 Logged a failed live scan${item ? ` for ${item}` : ""} after ${((data.gaveUpMs ?? 0) / 1000).toFixed(1)} s (${data.frames} frames, error: ${data.error ?? "none"}).`);
  }
  const timing =
    data.method === "typed"
      ? "typed in the Mini App"
      : `live in ${(data.totalMs / 1000).toFixed(1)} s (camera ${data.gumMs} ms, reading ${data.readMs} ms, ${data.frames} frames, ${data.decodeMsMedian} ms/frame, prompt: ${data.prompt}${data.zoom ? `, zoom ${data.zoom}×` : ""})`;
  await ctx.reply(`📷 ${code} ${timing}\n${describeLookup(lk)}${item ? "" : "\n(Tip: set /item first so rows can be matched.)"}`);
});

bot.on("message:photo", async (ctx) => {
  const item = currentItem.get(ctx.chat.id) ?? null;
  const size = ctx.message.photo.at(-1); // largest size Telegram kept
  const file = await ctx.api.getFile(size.file_id);
  const res = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const name = `${Date.now()}-${(item ?? "noitem").replace(/[^\w-]+/g, "_")}.jpg`;
  writeFileSync(new URL(name, PHOTOS), bytes);

  const t0 = performance.now();
  const results = await readBarcodes(bytes, { formats: FORMATS, tryHarder: true, maxNumberOfSymbols: 1 });
  const decodeMs = Math.round(performance.now() - t0);
  const hit = results.find((r) => r.isValid && validGtin(r.text));
  const code = hit ? toGtin13(hit.text) : null;
  const lk = code ? await lookup(code) : null;
  log({ kind: "photo", item, code, photo: { file: name, width: size.width, height: size.height, bytes: bytes.length, decodeMs }, lookup: lk, memory: memory() });

  await ctx.reply(
    code
      ? `🖼 Decoded ${code} from a ${size.width}×${size.height} photo in ${decodeMs} ms\n${describeLookup(lk)}`
      : `🖼 Could not decode a barcode in this ${size.width}×${size.height} photo (${decodeMs} ms). Logged as a failure; try a closer shot if you like, each photo counts.`,
  );
});

bot.hears(/^\s*\d[\d\s]{6,16}\s*$/, async (ctx) => {
  const digits = ctx.message.text.replace(/\s/g, "");
  if (!validGtin(digits)) return ctx.reply("Not a valid barcode (check digit mismatch).");
  const item = currentItem.get(ctx.chat.id) ?? null;
  const code = toGtin13(digits);
  const lk = await lookup(code);
  log({ kind: "typed", item, code, lookup: lk });
  await ctx.reply(`⌨️ ${code}\n${describeLookup(lk)}`);
});

bot.command("report", async (ctx) => {
  const rows = readRows();
  if (!rows.length) return ctx.reply("No results yet.");
  const pct = (a, b) => (b ? `${a}/${b} (${Math.round((100 * a) / b)}%)` : "0/0");
  const byKind = (k) => rows.filter((r) => r.kind === k);

  const photo = byKind("photo");
  const live = byKind("live").filter((r) => r.page?.method !== "typed");
  const liveOk = live.filter((r) => r.code);
  const liveTimes = liveOk.map((r) => r.page.totalMs).sort((a, b) => a - b);
  const prompts = liveOk.filter((r) => r.page.prompt === "yes").length;

  const items = [...new Set(rows.map((r) => r.item).filter(Boolean))];
  const itemDecoded = (it, kind) => rows.some((r) => r.item === it && r.kind === kind && r.code);
  const codes = new Map(rows.filter((r) => r.code && r.lookup).map((r) => [r.code, r.lookup]));
  const found = [...codes.values()].filter((l) => l.found);
  const types = found.reduce((acc, l) => ({ ...acc, [l.productType]: (acc[l.productType] ?? 0) + 1 }), {});

  const lines = [
    `Items: ${items.length}`,
    `Items decoded by photo: ${pct(items.filter((it) => itemDecoded(it, "photo")).length, items.length)}`,
    `Items decoded live: ${pct(items.filter((it) => itemDecoded(it, "live")).length, items.length)}`,
    `Photo attempts decoded: ${pct(photo.filter((r) => r.code).length, photo.length)}`,
    `Live attempts decoded: ${pct(liveOk.length, live.length)}`,
    liveTimes.length ? `Live time-to-read: median ${(liveTimes[Math.floor(liveTimes.length / 2)] / 1000).toFixed(1)} s, max ${(liveTimes.at(-1) / 1000).toFixed(1)} s` : "Live time-to-read: —",
    `Camera prompt shown: ${pct(prompts, liveOk.length)} of successful live opens`,
    `Distinct codes looked up: ${codes.size}; found: ${pct(found.length, codes.size)} ${JSON.stringify(types)}`,
    (({ rssMb, peakRssMb }) => `Bot memory (RSS): now ${rssMb} MB, peak ${peakRssMb} MB since start (budget: 256 MB machine)`)(memory()),
  ];
  await ctx.reply(lines.join("\n"));
});

bot.catch((err) => console.error(err));
console.log(`Field-test bot running. Scanner page: ${SCANNER_URL}. RSS at start: ${memory().rssMb} MB`);
bot.start();
