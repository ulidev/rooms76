// Throwaway field-test scanner for "Field-test barcode decoding" (ulidev/rooms76#10).
// Unlike the MVP page, it returns a small JSON payload with timings instead of bare digits.
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";

const PAGE_VERSION = "field-test-1";
const FORMATS = ["EAN13", "EAN8", "UPCA", "UPCE"];
const MAX_SIDE = 1280;

const tg = window.Telegram?.WebApp;
const $ = (id) => document.getElementById(id);
const tOpen = performance.now();

prepareZXingModule({
  overrides: { locateFile: (path, prefix) => (path.endsWith(".wasm") ? new URL(path, location.href).href : prefix + path) },
});

const metrics = {
  v: 1,
  page: PAGE_VERSION,
  platform: tg?.platform ?? "browser",
  tgVersion: tg?.version ?? null,
  method: "live",
  gumMs: null, // getUserMedia call → stream (includes the time a permission prompt stays open)
  firstFrameMs: null, // open → first decode attempt
  readMs: null, // first decode attempt → confirmed read (two identical reads)
  totalMs: null, // open → confirmed read
  frames: 0,
  decodeMsMedian: null,
  width: null,
  height: null,
  zoom: null,
  zoomAvailable: false,
  error: null,
};
const decodeTimes = [];

function setStatus(html) {
  $("status").innerHTML = html;
}

// Mod-10 check digit shared by EAN-8, EAN-13 and UPC-A (GTIN).
function validGtin(digits) {
  if (!/^\d{8}$|^\d{12,14}$/.test(digits)) return false;
  const body = digits.slice(0, -1).split("").reverse();
  const sum = body.reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === Number(digits.at(-1));
}

function send(payload) {
  const data = JSON.stringify(payload);
  if (tg?.sendData) tg.sendData(data);
  else setStatus(`Not inside Telegram. Would send:<br><code>${data}</code>`);
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? Math.round(s[Math.floor(s.length / 2)] * 10) / 10 : null;
}

// ---- typed fallback ----
$("sendDigits").addEventListener("click", () => {
  const digits = $("digits").value.replace(/\D/g, "");
  if (!validGtin(digits)) {
    setStatus("Those digits aren't a valid barcode (check digit mismatch). Try again.");
    return;
  }
  send({ ...metrics, method: "typed", code: digits, totalMs: Math.round(performance.now() - tOpen) });
});

$("giveUp").addEventListener("click", () => {
  send({ ...metrics, code: null, gaveUpMs: Math.round(performance.now() - tOpen), decodeMsMedian: median(decodeTimes) });
});

// ---- live camera ----
async function start() {
  tg?.ready();
  tg?.expand();
  $("version").textContent = `${PAGE_VERSION} · ${metrics.platform} · Telegram ${metrics.tgVersion ?? "?"}`;

  if (!navigator.mediaDevices?.getUserMedia) {
    metrics.error = "no-getUserMedia";
    setStatus("This client exposes no camera API. Type the digits below.");
    $("viewfinder").hidden = true;
    return;
  }

  setStatus("Asking for the camera…");
  const tGum = performance.now();
  let stream;
  try {
    // Called exactly once per open: on Android every call shows Telegram's permission dialog.
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
  } catch (err) {
    metrics.gumMs = Math.round(performance.now() - tGum);
    metrics.error = err?.name ?? String(err);
    setStatus(`Camera unavailable (${metrics.error}). Type the digits below.`);
    $("viewfinder").hidden = true;
    return;
  }
  metrics.gumMs = Math.round(performance.now() - tGum);

  const video = $("video");
  video.srcObject = stream;
  await video.play().catch(() => {});

  const track = stream.getVideoTracks()[0];
  const caps = track.getCapabilities?.() ?? {};
  if (caps.zoom) {
    metrics.zoomAvailable = true;
    $("zoomRow").hidden = false;
    for (const b of $("zoomRow").querySelectorAll("button")) {
      const z = Number(b.dataset.zoom);
      if (z > caps.zoom.max) b.hidden = true;
      b.addEventListener("click", () => {
        // applyConstraints does not re-request permission.
        track.applyConstraints({ advanced: [{ zoom: z }] }).then(() => (metrics.zoom = z)).catch(() => {});
      });
    }
  }

  setStatus("Point at the barcode, 15–20 cm away. Hold still.");
  scanLoop(video, track);
}

function scanLoop(video, track) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  let tFirst = null;
  let last = null;
  let done = false;

  const tick = async () => {
    if (done) return;
    if (video.readyState < 2 || !video.videoWidth) return void setTimeout(tick, 50);

    const scale = Math.min(1, MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);

    if (tFirst === null) tFirst = performance.now();
    const t0 = performance.now();
    const results = await readBarcodes(image, { formats: FORMATS, tryHarder: true, maxNumberOfSymbols: 1 });
    decodeTimes.push(performance.now() - t0);
    metrics.frames++;

    const hit = results.find((r) => r.isValid && validGtin(r.text));
    if (hit) {
      if (last === hit.text) {
        done = true;
        const now = performance.now();
        metrics.firstFrameMs = Math.round(tFirst - tOpen);
        metrics.readMs = Math.round(now - tFirst);
        metrics.totalMs = Math.round(now - tOpen);
        metrics.decodeMsMedian = median(decodeTimes);
        metrics.width = canvas.width;
        metrics.height = canvas.height;
        track.stop();
        tg?.HapticFeedback?.notificationOccurred("success");
        askPrompt(hit.text, hit.format);
        return;
      }
      last = hit.text;
    } else {
      last = null;
    }
    // Yield so the viewfinder stays smooth; ~10+ attempts per second is plenty.
    setTimeout(tick, 30);
  };
  tick();
}

function askPrompt(code, format) {
  $("readCode").textContent = code;
  $("readMs").textContent = `${(metrics.totalMs / 1000).toFixed(1)} s`;
  $("promptQuestion").hidden = false;
  $("typed").hidden = true;
  setStatus("");
  for (const b of $("promptQuestion").querySelectorAll("button")) {
    b.addEventListener("click", () => send({ ...metrics, code, format, prompt: b.dataset.prompt }));
  }
}

start().catch((err) => {
  metrics.error = String(err);
  setStatus(`Something failed: ${metrics.error}. Type the digits below.`);
});
