# Echo — manual tests (what cannot be verified in the build environment)

The build machine (Linux WSL2, no phone, no SIM card, no WhatsApp, no Kinyarwanda speaker) could verify everything
that runs in a browser or in Node: unit tests (`pnpm test`), type checks, the evaluation (`pnpm eval`) and the
end-to-end test of the production build in headless Chromium with the real models, online then offline
(`pnpm build && pnpm --filter @echo/web e2e`, last run 2026-10-04: **E2E PASSED**). The items below need real
hardware or a person. None of them has been done yet; nothing in the README claims they have.

| # | Test | Why it cannot be done here | SPEC | Status |
|---|---|---|---|---|
| 1 | P0 path on a real Android phone in airplane mode; WhatsApp share target; real SMS in Kinyarwanda received on a basic phone; audio playback; PIN; printed card | No phone, SIM or WhatsApp | 4.1–4.6, 12 P0, 14 | **not done** |
| 2 | Time and memory for a 30 s message on a low-end Android (replaces the estimate in `eval/results/RESULTS.md`) | No phone | 9 "performances" | **not done** (estimate only) |
| 3 | Kinyarwanda sentences and clips checked by a speaker | No Kinyarwanda speaker | 5, 11.10 | **not done** |

How to record results: for each step write pass / fail, timings, phone model, Android and Chrome versions (or the
speaker's role and date), then append them to `docs/PROGRESS.md` and update the README (§5.7 for timings, §10 and §12
for anything that stops being "not tested").

## 1. Web app on a real Android phone: P0 path, share target, real SMS

Cannot be done here: no Android phone, no SIM card, no WhatsApp. What *was* verified here: the production build in
headless Chromium (desktop Linux) with the real models, including offline reload (`pnpm --filter @echo/web e2e`,
screenshots in `docs/screenshots/`). Procedure on a real low-end Android phone (Chrome ≥ 120, ≥ 3 GB RAM, ~400 MB free):

**Serve the app over HTTPS** (service worker, microphone and share target need a secure origin; `localhost` is fine
only on the computer itself). Simplest: on the laptop, `pnpm build` then `pnpm --filter @echo/web preview`, and
expose port 4173 through a temporary HTTPS tunnel the team controls, or copy `apps/web/dist/` to any static HTTPS host
that sends the `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers
(without them everything works on a single WASM thread, slower). Do not publish without the user's decision.

**Or side-load the APK** (`bash tools/android/build-apk.sh` → `apps/android/dist/echo-debug.apk`, models bundled): copy it
to the phone, allow "install unknown apps", install. Then skip steps 1–2 (no download, no HTTPS needed) and in step 5
choose "Echo" in the Android share sheet; everything else is the same. Note which variant (APK or PWA) was tested.

1. **First load (on Wi-Fi)**: open the URL. "Try it" shows "Downloading models once" with a progress bar (≈ 242 MB:
   Whisper base 80 MB + MiniLM 135 MB + runtime 27 MB), then "Ready: works offline". Note the time.
2. **Install**: Chrome menu → "Add to home screen" / "Install app". Open Echo from the home screen.
3. **Airplane mode**: switch it on, close Echo completely (recent apps → swipe), reopen it. Expected: the app opens,
   the "Offline" badge is shown, the model box reaches "Ready" without network. Tap "French: welcome + meal": expected
   P1 + P4. Note the on-device time shown under the message (SPEC 9 "30 s message on a low-end Android": record a
   30 s voice message with "Record your own voice" and note its time).
4. **Main thread free**: while a sample is being analysed, scroll the page and switch tabs: the UI must stay
   responsive (analysis runs in a Web Worker).
5. **Share target (P0, SPEC 4.2)**: with Echo installed, in WhatsApp long-press a received voice note → Share → Echo.
   Expected: Echo opens on "Host app" with "1 shared item added to the queue". Repeat with a forwarded text message.
6. **Offline analysis + audio deletion**: still in airplane mode, tap "Analyse 1 message offline". Expected: the queue
   goes to 0 as soon as the transcription ends; the message appears under "What is stored" with findings only
   (no text). In Chrome DevTools (USB remote debugging) → Application → IndexedDB → `echo`: `queue` is empty,
   `messages` rows have no text, `reviewChunks` only contain not-sure / off-list chunks without names or numbers.
7. **Real SMS (P0, SPEC 14)**: Settings → host's phone number = the basic phone's number. Host app → recap →
   "Send SMS 1/2". Expected: the Android SMS app opens with the Kinyarwanda text; press Send (airplane mode off,
   Wi-Fi off, mobile network on: SMS needs only the SIM). Repeat for each part. On the basic phone, check that the
   text arrives complete and readable (GSM-7, no garbled characters), and note the number of SMS billed.
8. **Listen**: tap "Listen (Kinyarwanda)" in airplane mode: the clips play one after the other.
9. **PIN**: Settings → set a PIN → close and reopen Echo → "Host app" asks for the PIN; "Try it" stays open.
10. **Visitor card**: Visitor card → Print → "Save as PDF" or a real printer: the four languages fit on one page.

Record for each step: pass/fail, timings, phone model and Android/Chrome versions, and copy the results into
`docs/PROGRESS.md`.

## 2. Performance on a low-end Android (SPEC 9 "Les performances")

The evaluation measures speed and memory on a laptop CPU and gives only an **estimate** for a low-end phone
(`eval/results/RESULTS.md`, section Performance). This procedure replaces the estimate with a measurement.

**Phone**: an entry-level Android already owned by a household (e.g. 2–3 GB RAM, Cortex-A53/A55-class CPU, Android 10+),
Chrome up to date. Note model, RAM, CPU (Settings → About phone) and Chrome version.

1. On a computer on the same Wi-Fi: `pnpm install && pnpm models:download && pnpm build && pnpm preview` (the preview server
   already listens on the local network, port 4173). Plain `http://<laptop-ip>:4173` is not a secure origin on the phone, so the
   service worker and microphone may be refused: use HTTPS as in section 1, or Chrome's `chrome://flags/#unsafely-treat-insecure-origin-as-secure`
   for that one address (test phone only).
2. On the phone, open the app URL in Chrome, let the models download completely (progress bar), then switch the phone to
   **airplane mode**.
3. Connect the phone by USB, enable USB debugging, open `chrome://inspect` on the computer and inspect the tab
   (Console + Performance monitor: "JS heap size", and Android "Settings → Developer options → Running services" or
   `adb shell dumpsys meminfo com.android.chrome` for the tab's total memory).
4. Import `eval/data/demo-samples/de-roasting-path.wav`, then the **30 s** test message `eval/results/raw/perf-30s-fr.wav`
   (written by `pnpm eval -- --level perf`: synthetic French voices, same file as the laptop measurement), copied to the
   phone by USB. Also record 30 s of your own speech with the app's recorder.
5. For each message, note: time from "Analyse" to the result (the UI shows it, or use the Performance tab), peak memory
   during the analysis, whether the phone stayed responsive, battery drop over 10 messages.
6. Repeat once with the screen locked during processing (does the analysis continue?).
7. Record the results (phone model, Chrome version, whisper model, seconds per 30 s message with and without the English
   machine translation, peak memory) in `docs/PROGRESS.md` and in README § Results, replacing the estimate.

**Pass criteria** (proposed): a 30 s message is analysed in under 3 minutes in airplane mode without the tab being
killed; the result is identical to the one obtained on the laptop for the same file (same findings).

## 3. Kinyarwanda catalog: speaker check

Cannot be done here: no Kinyarwanda speaker. Everything in `catalog/` is flagged
`machine_translated_unvalidated`. Procedure for a speaker (guide, cooperative member, ~30 min):

1. Open `catalog/README.md`, table "The frozen sentences" (29 lines: 21 findings, 8 recap templates). For each line,
   read `rw` and the English/French source. Mark: correct / understandable but odd / wrong meaning.
   Check first the known drifts listed under the table (P2, P3, P6, P7, P8, N5, unknown_topic, keep/fix "ku" vs "kuri").
2. Read three full recap lines aloud with numbers, e.g. "Ibyo abashyitsi bakunda (3 ku 7): Abashyitsi bumvaga bakiriwe neza."
   Is the word order natural once `{finding}` follows the colon?
3. Listen to every clip in `catalog/audio/` (68 mp3, `audio/manifest.json` gives the text of each): is the word
   intelligible, is the pronunciation acceptable? Listen to `num-0` … `num-31` (counting form, e.g. "cumi na gatatu").
4. Listen to a concatenated line (template part + number + part + number + finding clip, played by the app's
   "Listen" button): are the gaps between clips acceptable?
5. For each wrong sentence: write the correct Kinyarwanda in `catalog/catalog.json` (`rw`, keep the slots), set
   `"status": "speaker_validated"` and add `"validatedBy": "<role>, <date>"`; re-record or regenerate its clip;
   run `.venv/bin/python tools/catalog/validate_catalog.py`.
Expected result: a list of sentences marked correct / odd / wrong, to be copied into `docs/PROGRESS.md`.

## 4. Android APK on a real phone (apps/android)

Already checked on an Android 14 emulator (see `apps/android/README.md`): offline start, share intent (voice note and
text), `sms:` opening Google Messages prefilled, transcription with 3 GB of RAM. A 2 GB emulator ran out of memory
during transcription. Still to check on real hardware:

1. Build (`bash tools/android/build-apk.sh`) or take `apps/android/dist/echo-debug.apk` (~150 MB). Copy it to a
   low-end phone (2–3 GB RAM, Android 8+), allow "install unknown apps" for the file manager, install.
2. Turn airplane mode **on** before the first launch. Open Echo. Expected: the app opens and "Ready: works offline"
   appears without any download. Write down the "Loaded in … s" figure and the phone model and RAM.
3. In WhatsApp (installed while online beforehand), long-press a received voice note → Share → Echo. Expected: Echo opens on
   Host app with "1 shared item added to the queue" and the voice note listed. Repeat with Echo already open, then with a
   forwarded text message. Share 2 voice notes at once: expected "2 shared items".
4. Tap "Analyse N messages offline". Write down the on-device time per message (SPEC 9 performance). If Echo shows
   "Echo ran out of memory and restarted", write it down with the phone's RAM. That is the 2 GB limit seen on the emulator.
5. Record a message in Try it: Android asks for the microphone permission once. Expected: recording works, and refusing
   the permission shows an error without a crash.
6. Recap → enter the host's number → "Send SMS". Expected: the phone's SMS app opens with the number and the
   Kinyarwanda text. Press Send with a SIM, still in airplane mode with cellular on (or airplane mode off and mobile data off):
   the basic phone receives it. Echo must never send an SMS without that tap (it has no SMS permission:
   Settings → Apps → Echo → Permissions lists only Microphone).
7. Privacy: Settings → Apps → Echo → Storage: after the analysis, the cache must not grow with each share
   (shared copies are deleted). `adb shell run-as org.echo.feedback ls cache/share` (debug build) should be empty.
