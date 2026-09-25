# Research: a static camera Mini App that returns scanned barcodes to a long-polling bot

Ticket: [#12](https://github.com/ulidev/rooms76/issues/12). Follows [#7](https://github.com/ulidev/rooms76/issues/7), which put a `📷 Scan` Mini App in the MVP, and [#2](https://github.com/ulidev/rooms76/issues/2) (findings on branch `research/barcode-scanning`).

Researched 2026-09-25 against:

- Telegram Bot API 10.3, the Mini Apps docs and the MTProto Mini App docs;
- client source code at these commits: Telegram Android `c848017` (2026-09-24), Telegram-iOS `6ad963e` (2026-07-17), Telegram Desktop `64ca547` (2026-09-24) with `desktop-app/lib_webview` `d2efba0` (2026-09-24), Telegram for macOS (TelegramSwift) `579cebb` (2025-07-29), Telegram Web A `ea0d226` (2026-09-22), Telegram Web K `4a58f79` (2026-09-24);
- grammY v1.46.0 (`main` at `055a5a4`), `zxing-wasm` 3.1.4, `barcode-detector` 3.2.2.

## Question

Can a static camera Mini App, opened from a reply-keyboard `web_app` button in the private chat, read EAN/UPC barcodes live and return them to a long-polling bot with `Telegram.WebApp.sendData`? Where should that page be hosted for a self-deployed, single-Apartment bot?

## Answer in brief

- **Yes, the round trip works as #7 assumed.** The Mini App calls `Telegram.WebApp.sendData(code)`. Telegram closes the Mini App and delivers an ordinary `message` update carrying `message.web_app_data`. grammY receives it through long polling with `bot.on("message:web_app_data")`. The bot needs no HTTPS endpoint. Only the page needs HTTPS. The Android, iOS, Desktop, macOS, Web A and Web K clients all implement this, and all of them accept only the first `sendData` of a session.
- **`sendData` only works from a reply-keyboard button.** An inline `web_app` button cannot use it. When a flow waits for a code, the bot therefore relies on the persistent reply keyboard (`is_persistent`) that already carries `📷 Scan`. The code arrives as a normal message, and the bot routes it by its own per-chat state, exactly like typed digits or a photo.
- **Decoding: `zxing-wasm` (reader build) on every platform.** iOS has no `BarcodeDetector`. Android's native one depends on Google Play Services. `zxing-wasm` reads EAN-13, EAN-8, UPC-A and UPC-E. Its reader wasm is about 930 KiB raw or 400 KiB gzipped, and it must be self-hosted instead of loaded from jsDelivr, which is its default. Decoding one camera frame took 0.5–5 ms on a desktop CPU in our benchmark, so a phone can easily scan continuously.
- **Expect a camera prompt on every scan on phones.** Android shows Telegram's own "Allow *bot* to access your camera?" dialog on every `getUserMedia` call. iOS hands the decision to WebKit's prompt, which is almost certainly shown on each open, because each open is a fresh webview. The page must therefore call `getUserMedia` exactly once per open.
- **Desktop and Web clients open the page too.** `sendData` works there, but camera access varies. Telegram Desktop denies the camera on macOS and Linux and leaves it to WebView2's default on Windows. Telegram for macOS asks once per bot. Web A and Web K use the browser's own prompt. The page must fall back to typing the digits itself (and return them via `sendData`). The bot keeps the photo and typed-digit fallbacks.
- **Hosting: one shared static page is technically sound.** It holds no secrets. A keyboard-button Mini App receives **no user data** (`initData` is empty), and Telegram routes `sendData` to whichever bot's keyboard opened the page, so one URL serves every Apartment's bot without any bot token. The real trust issue is the **camera**: whoever controls the shared page could, after a malicious update, stream Residents' camera video while the scanner is open. **Recommendation:** the default `SCANNER_URL` points to a versioned path on this repo's GitHub Pages. Operators who do not want to trust it can override it with their own fork's Pages. Nothing is configured in BotFather in either case.

## 1. The `sendData` round trip

### 1a. What the docs guarantee

- `KeyboardButton.web_app`: "the described Web App will be launched when the button is pressed. The Web App will be able to send a “web_app_data” service message. **Available in private chats only.**" `WebAppInfo.url` must be "An HTTPS URL" ([Bot API: KeyboardButton, WebAppInfo](https://core.telegram.org/bots/api#keyboardbutton)).
- `Telegram.WebApp.sendData(data)` sends "a service message … containing the data data of the length **up to 4096 bytes**, and the Mini App is closed … This method is **only available for Mini Apps launched via a Keyboard button**" ([Mini Apps docs](https://core.telegram.org/bots/webapps#initializing-mini-apps)). The official `telegram-web-app.js` throws `WebAppDataInvalid` for empty data or more than 4096 bytes before posting the `web_app_data_send` event ([telegram-web-app.js](https://telegram.org/js/telegram-web-app.js?63), `WebApp.sendData`).
- The docs list keyboard-button Mini Apps as "Good for … **Reusable components that do not depend on a particular bot**", and state that they let "the bot … produce a response **without communicating with any external servers**" ([Mini Apps docs: Keyboard Button Mini Apps](https://core.telegram.org/bots/webapps#keyboard-button-mini-apps)). That fits a shared scanner page exactly.
- `Message.web_app_data: WebAppData` is a "Service message: data sent by a Web App". `WebAppData` has `data` and `button_text`, and both carry the warning "**a bad client can send arbitrary data in this field**" ([Bot API: WebAppData](https://core.telegram.org/bots/api#webappdata)). The bot must validate the payload as untrusted input.
- MTProto side: on the first `web_app_data_send` event from a keyboard-button Mini App, clients call `messages.sendWebViewData(bot, random_id, button_text, data)`. "Make sure to ignore all `web_app_data_send` events sent after the first one … The webview must be closed after invoking the `messages.sendWebViewData` method." The bot gets `messageActionWebViewDataSentMe` (with the data). The user gets `messageActionWebViewDataSent`, which holds **only the button text, not the data** ([MTProto: Keyboard Button Mini Apps](https://core.telegram.org/api/bots/webapps#keyboard-button-mini-apps)). The Resident therefore sees a line like "Data from «📷 Scan» button was sent to the bot." ([Android string `ActionBotWebViewData`](https://github.com/DrKLO/Telegram/blob/c84801762fd5f936c8296ecf09a14a48ebfc4fe4/TMessagesProj/src/main/res/values/strings.xml#L5567)), and the bot should reply by echoing the Product or code.

### 1b. What the clients actually do (source)

| Client | Accepts `sendData` from | Closes the Mini App | Source |
|---|---|---|---|
| Android | Only when `queryId == 0` (not an inline-button app), first event only (`sentWebViewData`) | Yes, `dismiss()` after the request returns | [BotWebViewContainer.java L1876-1883](https://github.com/DrKLO/Telegram/blob/c84801762fd5f936c8296ecf09a14a48ebfc4fe4/TMessagesProj/src/main/java/org/telegram/ui/web/BotWebViewContainer.java#L1876-L1883), [BotWebViewSheet.java L587-604](https://github.com/DrKLO/Telegram/blob/c84801762fd5f936c8296ecf09a14a48ebfc4fe4/TMessagesProj/src/main/java/org/telegram/ui/bots/BotWebViewSheet.java#L587-L604), [BotWebViewAttachedSheet.java L471-488](https://github.com/DrKLO/Telegram/blob/c84801762fd5f936c8296ecf09a14a48ebfc4fe4/TMessagesProj/src/main/java/org/telegram/ui/bots/BotWebViewAttachedSheet.java#L471-L488) |
| iOS | Only `source.isSimple` (a keyboard button opens with source `.simple`), first event only (`dismissed`) | Yes, `controller.dismiss()` before sending | [WebAppController.swift L55-63, L1159-1162, L2061-2077](https://github.com/TelegramMessenger/Telegram-iOS/blob/6ad963e5b62d354da79040f388ae2b9132fb17b8/submodules/WebUI/Sources/WebAppController.swift#L1159-L1162), [ChatControllerOpenWebApp.swift L253-271](https://github.com/TelegramMessenger/Telegram-iOS/blob/6ad963e5b62d354da79040f388ae2b9132fb17b8/submodules/TelegramUI/Sources/Chat/ChatControllerOpenWebApp.swift#L253-L271) |
| Telegram Desktop | Only `WebViewSourceButton` with `simple`, only in the bot's own chat, first event only (`_dataSent`) | Yes, `botClose()` | [bot_attach_web_view.cpp L1794-1814](https://github.com/telegramdesktop/tdesktop/blob/64ca5475f24dde7331a388176d3fe60c0849b965/Telegram/SourceFiles/inline_bots/bot_attach_web_view.cpp#L1794-L1814), [attach_bot_webview.cpp L2348, L2646-2658](https://github.com/telegramdesktop/tdesktop/blob/64ca5475f24dde7331a388176d3fe60c0849b965/Telegram/SourceFiles/ui/chat/attach/attach_bot_webview.cpp#L2646-L2658) |
| Telegram for macOS | Only `requestData == .simple` | Yes (`handleSendData`) | [WebpageModalController.swift L1597-1607](https://github.com/overtake/TelegramSwift/blob/579cebbf0c01fd41b712eff3647fa7f69db9665d/Telegram-Mac/WebpageModalController.swift#L1597-L1607) |
| Web A | The handler itself does not check the launch type. It forwards the `buttonText` that only keyboard (simple) launches have | Yes, `closeCurrentWebApp()` | [WebAppTab.tsx L264, L713-719](https://github.com/Ajaxy/telegram-tt/blob/ea0d226147a80f05253bf1a6ffef08d694b8e6e4/src/components/modals/browser/WebAppTab.tsx#L713-L719) |
| Web K | Only `isSimpleWebView` | Yes, `forceHide()` | [webApp.tsx L1080-1087](https://github.com/morethanwords/tweb/blob/4a58f7903eeb3c230dfbf1cc99d520b9eb900d5a/src/components/webApp.tsx#L1080-L1087) |

Every official client implements the round trip the same way, desktop and web included.

### 1c. Receiving it in grammY with long polling

- `web_app_data` is a `message` field, so it arrives in a normal `message` update. That update type is in the default `allowed_updates`, and no opt-in is needed. grammY lists `web_app_data` in its filter tree ([filter.ts](https://github.com/grammyjs/grammY/blob/055a5a440f04d0b9fd5fd75a6d14dac4c2b83553/src/filter.ts#L331)), so `bot.on("message:web_app_data", …)` works. So does `conversation.waitFor("message:web_app_data")` inside the conversations plugin ([grammY conversations](https://grammy.dev/plugins/conversations)).
- The keyboard is built with `new Keyboard().webApp("📷 Scan", url).persistent().resized()` ([keyboard.ts L353, L481](https://github.com/grammyjs/grammY/blob/055a5a440f04d0b9fd5fd75a6d14dac4c2b83553/src/convenience/keyboard.ts#L353)).
- Long polling returns as soon as an update exists, so the code reaches the bot right after the Mini App closes. Nothing about the transport changes: the bot still needs no public URL (see `research/stack-and-hosting` §2).
- Optional clean-up: the bot may delete the "Data … was sent to the bot" service message. `deleteMessage` covers "service messages", and "Bots can delete incoming messages in private chats" (within 48 h) ([Bot API: deleteMessage](https://core.telegram.org/bots/api#deletemessage)).

Minimal bot side:

```ts
const SCANNER_URL = process.env.SCANNER_URL ?? "https://ulidev.github.io/rooms76/scanner/v1/";

const mainKeyboard = new Keyboard()
  .text("🛒 Shopping list").text("⚠️ Something ran out").row()
  .webApp("📷 Scan", SCANNER_URL).text("➕ Add item")
  .persistent().resized();

bot.on("message:web_app_data", async (ctx) => {
  const code = parseGtin(ctx.message.web_app_data.data); // digits only, 8/12/13, valid check digit
  if (!code) return ctx.reply("That didn't look like a barcode. Send a photo or type the digits.");
  await handleScannedCode(ctx, code); // same path as typed digits and decoded photos
});
```

### 1d. Scanning mid-flow (the bot is waiting for a code)

- **The bot cannot open the Mini App itself.** A Mini App opens only when the Resident taps a button.
- **An inline "📷 Scan it" button cannot replace the keyboard button.** An inline `web_app` button opens a Mini App that gets a `query_id` and must answer through `answerWebAppQuery`, which needs a backend ([Mini Apps docs: Inline Button Mini Apps](https://core.telegram.org/bots/webapps#inline-button-mini-apps)). The clients ignore `sendData` from it (Android `queryId != 0`, iOS `!isSimple`, see §1b).
- **So the reply-keyboard `📷 Scan` must be on screen when a code is wanted.** With `is_persistent: true` the client "always show[s] the keyboard when the regular keyboard is hidden" ([Bot API: ReplyKeyboardMarkup](https://core.telegram.org/bots/api#replykeyboardmarkup)). The keyboard stays until the bot sends another reply keyboard or `ReplyKeyboardRemove`. Following #7's design (one persistent main keyboard with `📷 Scan`), the button is therefore always there, and the prompt simply says "Tap 📷 Scan, send a photo, or type the digits".
- **The bot correlates the code through its own per-chat state, not through the page.** A `web_app_data` message is handled exactly like typed digits or a barcode photo: "waiting for a code for Purchase of Common Item X" consumes it, and with no pending flow it shows the Product card (`✅ I bought it` / `⚠️ It ran out`, per #7). If the Resident closes the scanner without scanning, no update arrives and the flow simply keeps waiting.
- **Optional:** the bot can put a context parameter in the button URL (e.g. `?for=purchase`) and have the page echo it in the payload. The URL is fixed per keyboard, though, so changing it means sending a new message with a new `ReplyKeyboardMarkup`. A message can carry either a reply keyboard or an inline keyboard, not both. **Not worth it:** server-side state is simpler and also covers the photo and typed-digit paths.
- **Resilience:** re-send the main keyboard on `/start` and after any flow that replaced it. If the literal text "📷 Scan" arrives as a plain message (a client that does not support `web_app` buttons may fall back to sending the label; not verified), answer with the photo/digits instructions.

## 2. Live decoding on the phone

### 2a. Camera access inside Telegram's webview

- **Secure context:** `getUserMedia` requires HTTPS ([MDN: getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)). `WebAppInfo` already requires HTTPS.
- **Android:** `onPermissionRequest` handles `RESOURCE_VIDEO_CAPTURE` by showing Telegram's own dialog, "Allow **{bot name}** to access to your camera? The developer of **{bot name}** will be able to access your camera when this web app is open." After that, the Android `CAMERA` runtime permission is requested if Telegram lacks it, and then the request is granted ([BotWebViewContainer.java L4811-4895](https://github.com/DrKLO/Telegram/blob/c84801762fd5f936c8296ecf09a14a48ebfc4fe4/TMessagesProj/src/main/java/org/telegram/ui/web/BotWebViewContainer.java#L4811-L4895), [strings.xml L5583](https://github.com/DrKLO/Telegram/blob/c84801762fd5f936c8296ecf09a14a48ebfc4fe4/TMessagesProj/src/main/res/values/strings.xml#L5583)). Nothing is remembered: **the dialog appears on every `getUserMedia` call, even within the same session.** An open PR, [DrKLO/Telegram#1947](https://github.com/DrKLO/Telegram/pull/1947) (2026-03, unmerged), describes this and would only auto-grant repeats *within* a session. The system permission is asked once per device.
- **iOS:** `requestMediaCapturePermissionFor` returns `.prompt` for every bot except the age-verification bot ([WebAppController.swift L783-788](https://github.com/TelegramMessenger/Telegram-iOS/blob/6ad963e5b62d354da79040f388ae2b9132fb17b8/submodules/WebUI/Sources/WebAppController.swift#L783-L788)), so WebKit shows its own prompt. `getUserMedia` in WKWebView exists since iOS 14.3 and "is gated by a user prompt similar to Safari" ([WebKit blog, 2020-11](https://webkit.org/blog/11353/mediarecorder-api/)). The delegate needs iOS 15+. Telegram-iOS itself still supports iOS 13.0 ([Telegram/BUILD `minimum_os_version`](https://github.com/TelegramMessenger/Telegram-iOS/blob/6ad963e5b62d354da79040f388ae2b9132fb17b8/Telegram/BUILD#L163)), so iOS 13–14.2 devices have no camera API at all, and the page must detect that. The Mini App webview allows inline media playback ([WebAppWebView.swift L178](https://github.com/TelegramMessenger/Telegram-iOS/blob/6ad963e5b62d354da79040f388ae2b9132fb17b8/submodules/WebUI/Sources/WebAppWebView.swift#L178)), so a `<video playsinline muted>` viewfinder renders in place. It also uses a persistent website data store (L159), so the HTTP cache (and the wasm) survives between opens. **Whether WebKit re-prompts on every open was not observed on a device.** Each scan closes the webview (`sendData`), and WebKit ties a grant to the page, so we expect one prompt per scan.
- **Consequence for the page:** call `getUserMedia` **once** per open. Do not re-acquire the stream to switch lenses or retry, because on Android every call is another Telegram dialog. Ask with `{ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }`.
- **The prompt names the bot, not the page's publisher.** With a shared page, the Resident consents to "the developer of {their Apartment's bot}", but the code comes from the rooms76 project. The README should say so (see §4).

### 2b. Which decoder

- **Native `BarcodeDetector` cannot be the only decoder.** It is supported on Chrome Android 83+ and mirrored to Android WebView. Safari, iOS Safari and iOS WebView have it only behind a "Shape Detection API" preference ([MDN browser-compat-data: BarcodeDetector](https://github.com/mdn/browser-compat-data/blob/main/api/BarcodeDetector.json)). On Android, Chromium's implementation returns no provider when Google Play Services is unavailable ([Chromium `BarcodeDetectionProviderImpl.java`](https://chromium.googlesource.com/chromium/src/+/main/services/shape_detection/android/java/src/org/chromium/shape_detection/BarcodeDetectionProviderImpl.java)).
- **Recommended: [`zxing-wasm`](https://github.com/Sec-ant/zxing-wasm) `/reader`** (MIT, v3.1.4, 2026-09-10; ZXing-C++ compiled to WebAssembly). It is the same library #2 chose for server-side photo decoding, so the bot and the page decode identically.
  - Formats: EAN-13, EAN-8, UPC-A, UPC-E (plus QR, which covers GS1 Digital Link later) ([README: Supported Barcode Formats](https://github.com/Sec-ant/zxing-wasm#supported-barcode-formats)).
  - Size: `zxing_reader.wasm` is 953,527 bytes, 409,715 bytes gzip -9 (measured from the npm package). The README quotes "~1.04 MiB".
  - **Self-host the wasm.** By default "the serve path is automatically assigned a jsDelivr CDN URL". Override it with `prepareZXingModule({ overrides: { locateFile } })` ([README: Configuring .wasm serving](https://github.com/Sec-ant/zxing-wasm#configuring-wasm-serving)) so that the page loads nothing from third-party origins except `telegram.org`.
  - API: pass `readBarcodes(imageData, { formats: ["EAN13","EAN8","UPCA","UPCE"], tryHarder: true, maxNumberOfSymbols: 1 })` a frame drawn from the `<video>` onto a canvas.
- **Alternatives considered:**
  - [`barcode-detector`](https://github.com/Sec-ant/barcode-detector) (MIT, v3.2.2) is a `BarcodeDetector` ponyfill/polyfill "that uses ZXing-C++ WebAssembly under the hood". It is the same engine behind a standard API. It is useful if we want to prefer the native detector where it exists, but that adds a second code path for little gain.
  - `@zxing/library` is in maintenance mode, `html5-qrcode` has had no release since 2023-04, and `@undecaf/zbar-wasm` is LGPL-2.1 (see #2's findings).
  - `@ericblade/quagga2` (MIT, 1D-only, last release 2025-12) is older-style JS and was not evaluated further.
  - Commercial SDKs (Scandit, STRICH, Dynamsoft) need licence keys, which conflicts with a free, self-deployed open-source bot.

### 2c. Speed and reliability

- **Per-frame cost (our benchmark, indicative only).** Setup: `zxing-wasm/reader` 3.1.4 in Node 22 on an Apple M4, run on the 60 EAN-13 photo crops of zxing-cpp's test corpus composited into synthetic camera frames (script not committed). Results:

  | Frame | `tryHarder` | Median per frame | Frame without a barcode |
  |---|---|---|---|
  | 640×480 | false | 0.5 ms | 0.5 ms |
  | 640×480 | true | 1.3 ms | 2.0 ms |
  | 1280×720 | false | 1.4 ms | 1.4 ms |
  | 1280×720 | true | 2.4 ms | 5.1 ms |

  Even if a mid-range phone's webview is 10× slower, a 640×480 `tryHarder` pass stays around 20 ms, so the scanner can try 10+ frames per second. Decoding in a Web Worker keeps the viewfinder smooth. `tryHarder` clearly helped (31 vs 21 decodes out of 60 on the same frames), so keep it on.
- **Accuracy was not measured in a representative way.** Our synthetic compositing lowered decode rates below those of the raw crops (31/60 vs 40/60), so those numbers say nothing about real live accuracy. Live scanning is generally more forgiving than one photo, because it gets many attempts per second as the Resident moves the phone. A field test with 10–20 real Products on an Android and an iPhone is still needed.
- **False positives:** EAN/UPC carry a check digit, and zxing reports `isValid`. The page should also require the same value on two consecutive frames before calling `sendData`, which is cheap at 10+ fps. The bot re-validates regardless (§1a).
- **Known physical limits (not verified here):** laptop webcams are usually fixed-focus. Some recent iPhone Pro main lenses cannot focus very close, so the Resident may need to hold the phone about 15–20 cm away. The field test should check this.

## 3. Clients without a camera or without Mini App support

| Client | Button opens the page? | `sendData` works? | Camera |
|---|---|---|---|
| Android / iOS | Yes | Yes | Yes (prompts, §2a) |
| Telegram Desktop, Windows | Yes | Yes | lib_webview leaves the WebView2 permission state untouched for camera ([webview_windows_edge_chromium.cpp L530-546](https://github.com/desktop-app/lib_webview/blob/d2efba0e95c6ac91f779aae12e8c17c76e06567b/webview/platform/win/webview_windows_edge_chromium.cpp#L530-L546)). WebView2's default is the browser behaviour, which normally prompts. **Not verified.** |
| Telegram Desktop, macOS | Yes | Yes | **Denied**: `requestMediaCapturePermission…` → `WKPermissionDecisionDeny` ([webview_mac.mm L610-612](https://github.com/desktop-app/lib_webview/blob/d2efba0e95c6ac91f779aae12e8c17c76e06567b/webview/platform/mac/webview_mac.mm#L610-L612)) |
| Telegram Desktop, Linux | Yes | Yes | **Denied**: unhandled WebKitGTK permission requests are denied by default ([webview_linux_webkitgtk.cpp L1818-1835](https://github.com/desktop-app/lib_webview/blob/d2efba0e95c6ac91f779aae12e8c17c76e06567b/webview/platform/linux/webview_linux_webkitgtk.cpp#L1818-L1835)) |
| Telegram for macOS (native) | Yes | Yes | Asks once per bot and **remembers** it (`FastSettings.allowBotAccessTo`) ([WebpageModalController.swift L1380-1404](https://github.com/overtake/TelegramSwift/blob/579cebbf0c01fd41b712eff3647fa7f69db9665d/Telegram-Mac/WebpageModalController.swift#L1380-L1404)) |
| Web A / Web K (browser) | Yes (iframe) | Yes | The iframe has `allow="camera; …"` ([Web A iframe.ts L11](https://github.com/Ajaxy/telegram-tt/blob/ea0d226147a80f05253bf1a6ffef08d694b8e6e4/src/util/browser/iframe.ts#L11), [Web K webApp.tsx L1060](https://github.com/morethanwords/tweb/blob/4a58f7903eeb3c230dfbf1cc99d520b9eb900d5a/src/components/webApp.tsx#L1060)), so the browser shows its own prompt |

What this means:

- **On every official client the button opens the page and `sendData` works.** What varies is whether a usable camera exists and whether it is allowed.
- **The page itself must degrade.** If `navigator.mediaDevices?.getUserMedia` is missing (iOS < 14.3, Linux/macOS Desktop), or it rejects (`NotAllowedError`, `NotFoundError`), the page shows a numeric input "Type the barcode digits" with check-digit validation and returns the digits via `sendData`. The page also shows a hint that the Resident can close it and send a photo to the bot instead. The Resident never hits a dead end, and the bot sees the same `web_app_data` either way.
- **The bot keeps both fallbacks** (#2, #7): a photo decoded server-side with `zxing-wasm`, and typed digits in the chat. On desktop these are the practical paths anyway (fixed-focus webcams), and they also work where Mini Apps are unavailable.
- **Third-party or very old clients:** `web_app` keyboard buttons date from Bot API 6.0 (2022). Behaviour in clients that do not support them was not researched. The bot's plain-text handling of "📷 Scan" (§1d) covers the likely fallback.

## 4. Hosting: one shared page or one per Apartment?

### 4a. What the page sees, and what it could do if compromised

What a keyboard-button Mini App receives:

- **No user identity.** `WebAppInitData` "is empty if the Mini App was launched from a keyboard button or from inline mode" ([Mini Apps docs: WebAppInitData](https://core.telegram.org/bots/webapps#webappinitdata)). MTProto: `keyboardButtonSimpleWebView` opens the app "without sending user information to the web app" ([MTProto: keyboardButtonSimpleWebView](https://core.telegram.org/constructor/keyboardButtonSimpleWebView)). There is no `initData` to leak, and nothing for the bot to validate.
- **Launch parameters** (theme, platform, version) arrive in the URL fragment, which `telegram-web-app.js` reads from `location.hash` and which the browser never sends to the page host.
- **The host (GitHub) sees each Resident's IP address and user agent** at every open: "When a GitHub Pages site is visited, the visitor's IP address is logged and stored for security purposes" ([GitHub Docs: About GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/about-github-pages)). It does not learn who the Resident is or which Apartment the Resident belongs to.
- **Camera frames are processed on the phone** and never uploaded, by design. A CSP in the page (`default-src 'self'; script-src 'self' https://telegram.org 'wasm-unsafe-eval'; connect-src 'self'`) enforces this against a bad dependency. `'wasm-unsafe-eval'` is needed to compile WebAssembly under CSP ([MDN: CSP script-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/script-src)). A compromised page would simply drop its own CSP, though, so the CSP is hygiene, not a trust boundary.

Why no bot token or per-bot setup is involved:

- The page never holds or needs a token. `sendData` goes to the bot that owns the button: the client calls `messages.sendWebViewData(bot = <that bot>)`, and the page cannot choose another bot or chat (§1b). One URL can serve any number of Apartment bots.
- The page cannot tell which bot opened it (no `initData`), which is fine, because it only returns a code.

If the shared page were compromised (maintainer account, repo, or Pages takeover), it could:

- **stream camera video** to an attacker while the scanner is open, after the Resident accepts the prompt they expect to see anyway. This is the one serious risk: a live camera inside Residents' homes;
- send a bogus string of up to 4096 bytes as `web_app_data` to the bot, which the bot rejects unless it is a valid GTIN, so the worst case is a wrong Product lookup;
- show phishing UI inside Telegram's Mini App frame, titled with the bot's name;
- call other Mini App methods, each of which the client gates with its own confirmation (`requestContact`, `requestWriteAccess`, location, `openLink`, downloads).

It could **not** read chats, act as the bot, obtain the bot token, or reach the Apartment's database.

### 4b. Options

| | Shared page (repo's GitHub Pages) | Operator hosts their own |
|---|---|---|
| Operator effort | None: works out of the box | Fork the repo and enable GitHub Pages on the fork (or use any static HTTPS host), then set `SCANNER_URL` |
| Trust | Every Apartment trusts the rooms76 maintainers' GitHub account and repo | Trust only themselves, plus GitHub or their host |
| Blast radius of a compromise | Every Apartment using the default | One Apartment |
| Updates / fixes | Instant for everyone. This cuts both ways: a bad deploy also hits everyone | Operator pulls updates |
| Privacy | GitHub logs IPs of all Residents of all Apartments | Same host-level logging, but on the Operator's account/host |
| Versioning | Must stay backward compatible with every deployed bot version | Page and bot versions move together |
| Bot needs HTTPS / open port | No | No (unless they choose to serve it from the bot container, see below) |

- **Serving the page from the bot's own container** is possible (Railway, Fly and Render provide an HTTPS subdomain; see `research/stack-and-hosting` §2). It would add an HTTP server and exposed port to what is otherwise a pure long-polling worker, and on a VPS it needs a domain plus Caddy. Keep it as an option the `SCANNER_URL` variable already allows, not the default.
- **GitHub Pages limits are ample.** A site may be at most 1 GB, with a soft 100 GB/month bandwidth limit ([GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)). `github.io` is served over HTTPS automatically ([GitHub Docs: HTTPS](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https)). We observed `cache-control: max-age=600` and gzip on Pages responses, so after the first load the ~400 KB wasm is revalidated, not re-downloaded.

### 4c. Recommendation

1. **Default: one shared page** at a **versioned, append-only path** on this repo's GitHub Pages, e.g. `https://ulidev.github.io/rooms76/scanner/v1/`. Each bot release hard-codes the default path it was tested with.
   - The page↔bot contract is deliberately tiny: the payload is **the barcode digits only**, the same string a Resident would type. Any bot version can then handle any page version, and the bot's existing typed-digit validation covers `web_app_data` too.
   - A breaking change gets a new path (`/v2/`). Old paths stay deployed.
2. **Override: `SCANNER_URL` env var** (optional).
   - Point it at a fork's Pages or any static HTTPS host to remove the shared-trust dependency.
   - Set it empty to hide `📷 Scan`, which leaves only photo and typed digits.
   - Keep the page buildless or commit its built assets, so a fork can publish with "Deploy from a branch" without enabling Actions.
3. **No BotFather configuration** in any case. The URL travels inside the `KeyboardButton`. The menu button (`/setmenubutton`), main Mini App or `/newapp`, and `/setdomain` (Login Widget) are all unrelated to keyboard-button Mini Apps.
4. **Harden the shared page:**
   - no third-party origins except `telegram.org`, and a self-hosted wasm;
   - a CSP meta tag;
   - a small, auditable page (one HTML file + the vendored `zxing-wasm` reader);
   - deploys only from `master` via a protected branch, with 2FA on the maintainer account.
5. **Disclose in the README:**
   - The camera prompt names the Apartment's bot, but the scanner code is served by the rooms76 project.
   - GitHub sees Residents' IPs.
   - Camera frames never leave the phone.
   - How to self-host the page.

## Uncertainties

- **iOS re-prompting** on every open is inferred from the Telegram source (`.prompt`) and WebKit's per-page grant model, not observed on a device. The same goes for how the WebKit prompt looks inside the Mini App sheet.
- **Windows Telegram Desktop camera:** we did not verify what WebView2's default permission handling does inside Telegram Desktop (prompt vs deny).
- **Live-decoding accuracy and speed on real phones** were not measured. The benchmark is per-frame CPU cost on a desktop in Node. It still needs a field test on one Android and one iPhone (older iPhone Pro close-focus included) with 10–20 real Products.
- **The 4096-byte limit** is enforced client-side by `telegram-web-app.js`. The server-side limit for `messages.sendWebViewData` is undocumented, which is irrelevant for codes of 8–13 digits.
- **Clients that do not support `web_app` buttons** (third-party or old) were not tested. The plain-text fallback is a guess.
- **Client behaviour comes from current source,** not release notes, and could change (e.g. Android PR #1947 would reduce repeat dialogs within a session).
- **GitHub Pages cache headers** were observed, not documented, and may change.
