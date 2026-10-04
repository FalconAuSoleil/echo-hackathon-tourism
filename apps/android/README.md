# Echo for Android (side-loadable APK)

A Capacitor 8 shell around the same `apps/web/dist` build as the PWA. The Whisper and MiniLM models are bundled in
the APK, so the phone downloads nothing: install, open, use in airplane mode. There is still no server, account or analytics.

| | |
|---|---|
| Package | `org.echo.feedback`, minSdk 24 (Android 7.0), target/compile SDK 36 |
| Debug APK | **157,249,918 bytes (150 MB)**, built on this machine on 2026-10-04 (models 215 MB uncompressed, ~128 MB compressed in the APK) |
| Space on the phone | the installed APK (150 MB) + **~36 MB** of app data (measured on the emulator). The web app detects the Capacitor shell and reads the models in place from the APK's assets (`env.useBrowserCache = false`), with no copy into Cache Storage; the 36 MB is the service worker's precache (app shell + 27 MB WASM runtime). Before this, the models were copied into Cache Storage and the app data was 267 MB. An update from an older APK deletes that old copy at the next model load. |
| Permissions | `INTERNET` (needed by the WebView's local server; Echo sends nothing), `RECORD_AUDIO` + `MODIFY_AUDIO_SETTINGS` (in-app recording, asked at first use). **No `SEND_SMS`, no storage permissions.** |
| Backups | `allowBackup=false` + data-extraction rules: feedback never goes to a cloud backup or a device transfer. |

## What the native layer adds (and nothing more)

- **Share intent** (`ACTION_SEND` / `ACTION_SEND_MULTIPLE`, `audio/*`, `application/ogg`, `text/plain`): WhatsApp → long-press a voice
  note → Share → Echo. `MainActivity` copies the shared file to `cache/share/`, then runs a script (`ShareIntake`) that
  rebuilds the form the PWA share target receives and posts it to `/share-target`. The web app's own service worker
  queues it in IndexedDB, exactly as in the installed PWA. The cache copy is deleted as soon as the queue has it
  (`EchoShare.consumed`), and anything left over is deleted after 10 minutes. A lone link is not counted as feedback (same rule as the service worker).
- **SMS**: the recap's `sms:` link opens the phone's SMS app with the number and the Kinyarwanda text already filled in
  (Capacitor launches an `ACTION_VIEW` intent). A person presses Send. The app never sends an SMS by itself.
- **Low memory**: if Android kills the WebView renderer (seen on a 2 GB emulator during transcription), the app
  restarts the page with a message instead of dying. After 3 losses in 5 minutes it closes and says the phone lacks free memory.
  The queue is in IndexedDB, so a shared message is never lost.

## Build

```bash
bash tools/android/install-sdk.sh        # once: cmdline-tools + platform 36 + build-tools 35 under /root/android-sdk (JDK 21)
pnpm models:download && pnpm build       # apps/web/dist must contain the models
bash tools/android/build-apk.sh          # cap sync, JVM unit tests, assembleDebug → apps/android/dist/echo-debug.apk
# or: bash tools/android/build-apk.sh --rebuild-web
```

`ANDROID_HOME` defaults to `/root/android-sdk`. Gradle (wrapper) and AGP 8.13 are downloaded on the first build.
Icons and splash screen come from `apps/web/public/icons/icon.svg`: `node tools/android/make-icons.mjs`.

Install: `adb install -r apps/android/dist/echo-debug.apk`, or copy the file to the phone and allow "install unknown
apps". It is a debug build signed with the debug key: fine to side-load, not for a store.

## Tested on an emulator (not a phone)

On this machine (KVM), Android 14 `google_apis` x86_64 emulator, 2 vCPUs, airplane mode on. These are emulator
results, not real-phone results (x86 under KVM, software GPU):

| Check | 2 GB RAM | 3 GB RAM |
|---|---|---|
| App starts offline, service worker active, models load from the APK | yes (29 s first launch, 10–11 s afterwards) | yes (19 s) |
| Share intent, cold start: `.opus` voice note (`audio/ogg`) → "1 shared item added to the queue", cache copy deleted | yes | – |
| Share intent, app already open: text → queued; bare link → ignored | yes | yes |
| `sms:` link → Google Messages opens with the number and the Kinyarwanda body filled in, nothing sent | yes | – |
| Sample 6 s clip transcribed and matched (Try it) | **no: renderer killed by low memory** (the app restarts the page) | yes, 18.4 s on the device |
| Shared `.opus` voice note analysed from the queue | – | yes, 6.5 s (Whisper 6.4 s) |

The WebView renderer holds ~1.55 GB once both models are loaded (single-threaded WASM: no cross-origin isolation in
the Capacitor local server). A 2 GB phone is therefore not enough as things stand, while 3 GB worked.
Screenshots: `screenshots/`. Driving the WebView: `tools/android/webview-probe.mjs` (DevTools protocol, debug build).

Not testable here: a real phone, real WhatsApp, the microphone, a real SIM. See `docs/MANUAL_TESTS.md` § 4.
