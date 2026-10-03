
## Kinyarwanda catalog: speaker check (catalog agent, 2026-10-04)

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

## Web app on a real Android phone (web-app agent, 2026-10-04)

Cannot be done here: no Android phone, no SIM card, no WhatsApp. What *was* verified here: the production build in
headless Chromium (desktop Linux) with the real models, including offline reload (`pnpm --filter @echo/web e2e`,
screenshots in `docs/screenshots/`). Procedure on a real low-end Android phone (Chrome ≥ 120, ≥ 3 GB RAM, ~400 MB free):

**Serve the app over HTTPS** (service worker, microphone and share target need a secure origin; `localhost` is fine
only on the computer itself). Simplest: on the laptop, `pnpm build` then `pnpm --filter @echo/web preview`, and
expose port 4173 through a temporary HTTPS tunnel the team controls, or copy `apps/web/dist/` to any static HTTPS host
that sends the `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers
(without them everything works on a single WASM thread, slower). Do not publish without the user's decision.

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
