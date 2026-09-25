# Research: scanning a Product's barcode through Telegram

Ticket: [#2](https://github.com/ulidev/rooms76/issues/2). Researched 2026-09-25 against the Telegram Bot API at version 10.3, Telegram Android master at `c848017` (2026-09-24), Telegram-iOS master at `6ad963e` (2026-07-17), and the Open Food Facts API docs on `main`.

## Question

How can a Resident scan a Product's barcode (EAN/UPC) or QR code through Telegram, and which public product database can turn a barcode into a name and a photo?

## Answer in brief

- **Recommended: the Resident sends a photo of the barcode to the bot, and the bot decodes it on the server** with `zxing-wasm`. This works in every Telegram client (desktop included), in private and group chats, and with long polling. It needs no public HTTPS endpoint. If decoding fails, the bot asks the Resident to type the 13 digits instead.
- **Telegram's native scanner (`showScanQrPopup`) cannot read EAN/UPC.** Both official mobile clients limit it to QR codes, and Telegram Desktop and Telegram Web A do not implement it. It only helps with QR codes, for example GS1 Digital Link QR codes, which will become common on packs later.
- **A Mini App with a live camera works, but it is an optional add-on.** It gives a better live viewfinder, but it needs HTTPS hosting and a client-side decoder (there is no native `BarcodeDetector` on iOS). Its simplest form (a keyboard button with `sendData`) only works in private chats.
- **For the lookup, use Open Food Facts' universal lookup** (`/api/v3/product/{code}?product_type=all`). It searches the food, products, beauty and pet-food databases together. Food coverage in Spain is strong. Non-food coverage (kitchen paper, detergent) is thin, so a manual name/photo fallback is required. Cache every lookup locally. Attribute the data (ODbL) and the images (CC BY-SA).

## 1. Ways to capture the code

### 1a. Native `showScanQrPopup` (Mini App API): QR only

- The API was added in Bot API 6.4. The docs call it "a native popup for scanning a QR code". The `qrTextReceived` event fires "when the QR code scanner catches a code with text data". The docs never mention EAN or UPC. ([Mini Apps docs](https://core.telegram.org/bots/webapps))
- **Android:** `web_app_open_scan_qr_popup` opens `CameraScanActivity` with `TYPE_QR_WEB_BOT` ([BotWebViewContainer.java](https://github.com/DrKLO/Telegram/blob/master/TMessagesProj/src/main/java/org/telegram/ui/web/BotWebViewContainer.java)). That activity's decoders are a ZXing `QRCodeReader` and a Google Vision `BarcodeDetector` built with `setBarcodeFormats(Barcode.QR_CODE)` ([CameraScanActivity.java L255-257](https://github.com/DrKLO/Telegram/blob/master/TMessagesProj/src/main/java/org/telegram/ui/CameraScanActivity.java)). Result: QR only.
- **iOS:** the popup is `QrCodeScanScreen` with `subject: .custom` ([WebAppController.swift](https://github.com/TelegramMessenger/Telegram-iOS/blob/master/submodules/WebUI/Sources/WebAppController.swift)). Its camera sets `metadataOutput.metadataObjectTypes = [.qr]` ([CameraOutput.swift L189-190](https://github.com/TelegramMessenger/Telegram-iOS/blob/master/submodules/Camera/Sources/CameraOutput.swift)). Result: QR only.
- **Telegram Desktop:** `openScanQrPopup` just shows the text `lng_bot_no_scan_qr` ("not supported") ([attach_bot_webview.cpp](https://github.com/telegramdesktop/tdesktop/blob/dev/Telegram/SourceFiles/ui/chat/attach/attach_bot_webview.cpp)).
- **Telegram Web A:** shows "Scanning QR code is not supported in this client yet" ([useWebAppFrame.ts](https://github.com/Ajaxy/telegram-tt/blob/master/src/components/modals/browser/hooks/useWebAppFrame.ts)).
- **Future relevance:** GS1's "Sunrise 2027" goal is for retail tills to read 2D codes (QR with GS1 Digital Link, which carries the GTIN) by the end of 2027. During the transition, packs will carry both the linear EAN/UPC and the 2D code ([GS1 US Sunrise 2027](https://www.gs1us.org/industries-and-insights/by-topic/sunrise-2027), [GS1 2D in retail guideline](https://ref.gs1.org/guidelines/2d-in-retail/)). EAN-13 will therefore remain the code that is always present for years.

**Verdict:** not viable for EAN. It would be a small bonus for Products that carry a GS1 Digital Link QR code (parse `/01/{GTIN}` from the URL).

### 1b. Photo sent to the bot, decoded on the server: recommended

- **What the bot receives:** `Message.photo` is an array of `PhotoSize` objects. Telegram resizes photos on its servers: type `y` is "bounded by 1280x1280 pixels" and type `w` is "bounded by 2560x2560" ([API: files](https://core.telegram.org/api/files)). Since June 2025 a user can pick "HD" (4× the pixels). The default is "SD", i.e. at most 1280 px ([Telegram blog, 2025-06-03](https://telegram.org/blog/direct-to-channel-trim-voice-and-more)). A photo sent as a file (`Message.document`) keeps the original.
- **Download:** `getFile` lets a bot download "files of up to 20MB in size" ([Bot API](https://core.telegram.org/bots/api#getfile)). With grammY this is `bot.api.config.use(hydrateFiles(bot.token))`, then `await ctx.getFile()` and `file.download()` ([grammY files plugin](https://grammy.dev/plugins/files)).
- **Decoder:** [`zxing-wasm`](https://github.com/Sec-ant/zxing-wasm) (MIT; v3.1.4, 2026-09-10; actively maintained) is ZXing-C++ compiled to WebAssembly. It runs in Node, Bun, Deno and the browser, and reads EAN-13, EAN-8, UPC-A, UPC-E and QR. The reader-only wasm is about 1.04 MiB. Other options:
  - `@zxing/library` (zxing-js) is "in maintenance mode" ([README](https://github.com/zxing-js/library)).
  - `@undecaf/zbar-wasm` is LGPL-2.1 and was last pushed in 2024-07.
  - `html5-qrcode` is browser-only and in maintenance mode with no fixes; its last release is v2.3.8 (2023-04) ([README](https://github.com/mebjas/html5-qrcode)).
- **How reliable it is (our own benchmark, indicative only):** we ran `zxing-wasm` (`tryHarder`, EAN/UPC formats) on the 60 real-world EAN-13 photo crops in zxing-cpp's test corpus ([test/samples/ean13-1, ean13-2](https://github.com/zxing-cpp/zxing-cpp/tree/master/test/samples)). zxing-cpp marks 20 of these with `!` as known-unreadable. Each image was first re-encoded as JPEG to mimic Telegram's compression. The crops are 206–562 px on their longest side (median 295 px), which is roughly a barcode filling ¼ to ½ of a 1280 px SD photo.

  | Variant | "readable" set (40) | known-hard set (20) |
  |---|---|---|
  | JPEG q80, max 1280 px | **37/40 (93%)** | 0/20 |
  | JPEG q70, max 640 px | 35/40 (88%) | 0/20 |
  | JPEG q70, max 320 px | 31/40 (78%) | 1/20 |

  Takeaway: if the Resident frames the barcode so it fills a good part of the photo, an SD photo decodes reliably. Blurry, curved or glare-affected shots fail, so the bot must handle failure well: ask for a closer photo, or accept typed digits. The benchmark script is not committed. It used `readBarcodes(buf, { formats: ["EAN13","EAN8","UPCA","UPCE"], tryHarder: true })` after a `sharp` resize and JPEG re-encode.
- **Groups:** in privacy mode, a bot in a group only sees commands, replies to its own messages, and similar. Residents would have to send the photo as a reply to the bot's prompt, or with a command in the caption. Private chats have no such restriction.

### 1c. Mini App using the browser camera: viable, optional

- **Camera access inside Telegram:**
  - **Android:** the Mini App WebView implements `onPermissionRequest`. For `RESOURCE_VIDEO_CAPTURE` it shows Telegram's own "allow camera" dialog, then the system `CAMERA` permission, then grants ([BotWebViewContainer.java ~L4811-4895](https://github.com/DrKLO/Telegram/blob/master/TMessagesProj/src/main/java/org/telegram/ui/web/BotWebViewContainer.java)).
  - **iOS:** `WKUIDelegate.requestMediaCapturePermissionFor` returns `.prompt` (the WebKit system prompt) for every bot except the age-verification bot ([WebAppController.swift ~L783](https://github.com/TelegramMessenger/Telegram-iOS/blob/master/submodules/WebUI/Sources/WebAppController.swift)). That delegate API requires iOS 15+ ([Apple docs](https://developer.apple.com/documentation/webkit/wkuidelegate/webview(_:requestmediacapturepermissionfor:initiatedbyframe:type:decisionhandler:))). So `getUserMedia` works, but Residents may be prompted repeatedly.
- **Decoding in the page:** native `BarcodeDetector` exists on Chrome Android (and therefore Android WebView) from version 83. Safari/iOS has it only behind a flag, so iOS WebViews lack it ([MDN browser-compat-data](https://github.com/mdn/browser-compat-data/blob/main/api/BarcodeDetector.json)). A WASM polyfill is needed: [`barcode-detector`](https://github.com/Sec-ant/barcode-detector) (MIT, built on zxing-wasm) or `zxing-wasm` directly.
- **Launch and return path:**
  - `WebAppInfo.url` must be "An HTTPS URL" ([Bot API](https://core.telegram.org/bots/api#webappinfo)), so the page needs HTTPS hosting.
  - Keyboard-button Mini Apps can call `Telegram.WebApp.sendData(data)` (≤ 4096 bytes). The bot receives it as a `web_app_data` service message "without communicating with any external servers", so a static page (for example on GitHub Pages) would be enough. However, `web_app` keyboard and inline buttons are "Available in private chats only" ([Bot API](https://core.telegram.org/bots/api#keyboardbutton), [Mini Apps docs](https://core.telegram.org/bots/webapps)).
  - In groups, only direct-link or main Mini Apps (`t.me/bot/app?startapp=…`) work. Those cannot use `sendData`. They need a backend endpoint that validates `initData` (HMAC-SHA-256 keyed from the bot token), which means the self-deployed bot must expose a public HTTPS server.
- **Verdict:** better UX (live viewfinder, instant feedback) but more moving parts: HTTPS hosting, camera prompts, a client-side WASM decoder, and extra plumbing in groups. Worth adding later, private-chat-only, as a "Scan" keyboard button. Not needed for the first version.

## 2. Turning a barcode into a name and a photo

### Open Food Facts family (OFF, Open Products Facts, Open Beauty Facts, Open Pet Food Facts)

- **Universal lookup:** "scan a barcode, and you get a result from either Open Food Facts, Open Pet Food Facts, Open Beauty Facts or Open Products Facts with a `product_type`". Use `product_type=all` and the API redirects to the right instance ([tutorial](https://github.com/openfoodfacts/openfoodfacts-server/blob/main/docs/api/tutorials/scanning-cosmetics-pet-food-and-other-products.md)). We confirmed this live: `GET https://world.openfoodfacts.org/api/v3/product/{code}?product_type=all&fields=code,product_name,product_name_es,brands,quantity,image_front_url,image_front_small_url,product_type` returned:
  - `8480000093691` Hacendado bread → `food`
  - `8480000433206` Bosque Verde floor cleaner → `product`, served by OPF
  - `8410122401005` Scottex → `product`
  - `8402001041235` Bosque Verde laundry detergent → `beauty` (misfiled in Open Beauty Facts, but still found)
  - an unknown code → HTTP 404
- **API v3** is "recommended for all new integrations"; v2 is deprecated ([API docs](https://github.com/openfoodfacts/openfoodfacts-server/blob/main/docs/api/index.md)).
- **Rate limits:** "15 req/min/IP address for all read product queries" and "10 req/min/IP address for all search queries". Exceeding them risks an IP ban. Global limits return HTTP 503 ([API docs](https://github.com/openfoodfacts/openfoodfacts-server/blob/main/docs/api/index.md)). We saw several 503s on the search endpoint during this research, but none on product reads. One apartment's scans are far below these limits, but the bot should cache results and treat 503 as "try later".
- **Identification:** send a custom `User-Agent: AppName/Version (contact)`. Reads need no authentication. Writes (adding a missing product or photo) need an account ([API docs](https://github.com/openfoodfacts/openfoodfacts-server/blob/main/docs/api/index.md)).
- **Licence** ([API docs](https://github.com/openfoodfacts/openfoodfacts-server/blob/main/docs/api/index.md)):
  - The database is under ODbL 1.0 and its contents under DbCL 1.0.
  - Product images are under **CC BY-SA 3.0** and "may contain graphical elements subject to copyright".
  - The bot should credit "Open Food Facts" when it shows data or images.
- **Images:** the response carries `image_front_url` (full size) and `image_front_small_url` (200 px), served from `images.openfoodfacts.org` / `images.openproductsfacts.org` / `images.openbeautyfacts.org`. The bot can pass these URLs straight to `sendPhoto`.
- **Coverage for Spanish supermarket goods** (live counts via `/api/v2/search`, 2026-09-25):

  | Query | Count |
  |---|---|
  | OFF, `countries_tags_en=spain` | **371,747** products |
  | OFF, brand `hacendado` (Mercadona own brand) | 11,486, of which 10,593 (92%) have a selected front photo |
  | OPF (non-food), `countries_tags_en=spain` | **2,209** (1,143 with a front photo); OPF worldwide total 46,182 |
  | OBF, `countries_tags_en=spain` | 3,688 |
  | OPF brand `bosque-verde` (Mercadona household) | 15 (plus 4 misfiled in OBF) |
  | OPF brand `scottex` / `colhogar` | 3 / **0** |
  | OPF brand `fairy` / `ariel` | 98 / 126 (worldwide) |

  Reading: most food Products will be found, usually with a photo. **Household non-food items like kitchen paper, bin bags and detergent will often be missing.** Those are exactly the Common Items this bot cares most about.

### Implications for the design

1. The lookup should go: local Product cache → OFF universal lookup → fallback where the Resident names the Product and optionally sends a photo, which the bot stores itself.
2. Store only what is needed (barcode, name, brand, quantity, image URL or `file_id`) and credit OFF. Optionally, offer to contribute missing non-food Products back to Open Products Facts (this needs an OFF account for the instance).

## Comparison

| | Photo → server decode | Mini App + camera | Native `showScanQrPopup` |
|---|---|---|---|
| Reads EAN/UPC | Yes (`zxing-wasm`) | Yes (`zxing-wasm` / polyfill) | **No, QR only** (Android and iOS source) |
| Clients | All, desktop included | Android and iOS (iOS 15+); desktop has no useful camera | Android and iOS only; Desktop and Web A unsupported |
| Private chat | Yes | Yes (keyboard button + `sendData`, static page) | Yes |
| Group chat | Yes (reply or caption with privacy mode) | Direct link only, needs a backend with `initData` check | Via direct link only |
| Infra for a self-deployed bot | None beyond the bot (long polling fine) | HTTPS hosting (+ backend for groups) | HTTPS hosting |
| UX | Take photo, send, wait about 1 s; retry if blurry | Live viewfinder, fastest per scan; camera prompt | Native and smooth, but useless for EAN |
| Failure fallback | Type the digits | Type the digits | n/a |

## Recommendation

Ship **photo → server-side `zxing-wasm` decoding**, with typed digits as the fallback, and look codes up with the **OFF v3 universal lookup** (`product_type=all`) behind a local cache. Always allow a Resident-supplied name and photo when a code is not found, because that will be common for non-food Common Items. Keep a keyboard-button Mini App scanner as a later UX improvement for private chats. Ignore `showScanQrPopup` for EAN; use it only if QR/GS1 Digital Link codes ever matter.

## Uncertainties

- **The benchmark is a proxy.** The inputs are crops of real photos, not full Telegram SD photos taken by Residents, and Telegram's exact JPEG quality is undocumented. A quick field test with 10–20 real pantry items from the apartment would settle this.
- **The coverage numbers are tag counts, not hit rates.** They do not measure how often a real Spanish shopping basket (Mercadona, Carrefour, Lidl, Dia) resolves. Non-food looks weak, but the true miss rate is unmeasured.
- **The iOS camera permission** comes from the WKWebView `.prompt` path. Whether iOS re-prompts on every Mini App open was inferred from the code, not observed.
- **The OFF rate limit** is documented at 15 req/min/IP today. This number has changed before, so keep it configurable and cache aggressively.
- **Client behaviour is based on current `master` source,** not on release notes. A future client could widen `showScanQrPopup` formats.
