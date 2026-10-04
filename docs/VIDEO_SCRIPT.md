# Echo — video script (brief §08, 2–5 minutes)

**This is a script, not the video.** The video has to be recorded and edited by the team (screen recording plus
voice-over). Target length **4 min 30 s**, under the 5-minute limit. Narration is in English. Every number below is
taken from `README.md` / `eval/results/RESULTS.md` as of 2026-10-04; if `pnpm eval` is re-run, check them again
before recording.

Ground rules for the recording (SPEC 0 and `CLAUDE.md`):
- Say "synthetic" every time synthetic data or voices are on screen (demo samples, 3-month history, cooperative
  farms, evaluation levels 2–3).
- Say that the Kinyarwanda is machine-translated and **not validated by a speaker**.
- Do not show or describe the APK as tested on a phone: it was tested on an **Android 14 emulator**. No real SMS was
  sent; the SMS app opens pre-filled and is **not** sent in the video.
- Do not cut the "not sure — ask a person" moments: they are the guardrail.

## Timeline

| Time | Segment (brief §08) | What is on screen | Narration (draft) |
|---|---|---|---|
| 0:00–0:35 | **1. Problem statement** | Title card "Echo — the visit logbook for small rural tourism hosts"; then the problem sentence as text, the measured numbers highlighted | See "Problem sentence" below, read verbatim. Then: "Noor farms coffee in Rwanda. Six or seven visitors a month. Once they leave, she never learns what they liked or what to fix. She has a basic phone; her daughter has a smartphone at weekends." |
| 0:35–1:20 | **2. AI capabilities and guardrails** | README §3 table (Echo vs Translate / guide / form), then the guardrails list (README §4); short shot of `catalog/catalog.json` frozen Kinyarwanda sentences | "Two small models run on the phone: Whisper base, 80 MB, turns a voice note into text and detects the language; a multilingual sentence model, 135 MB, plus a small classifier maps each remark to one of 21 findings. A keyword search can't: it counts 'the walk was not too long' as a complaint, and 28 % of what it counts is wrong; Echo's is 6 %. Guardrails: the host only ever sees frozen Kinyarwanda sentences, nothing generated; below 0.84 confidence or with an unclear negation, the remark is 'not sure — ask a person' and never counted; audio is deleted after transcription, names and numbers are scrubbed; a person presses Send on the SMS." |
| 1:20–3:10 | **3. Tool demo (end to end)** | Screen recording, sequence below | Short captions per step (below). |
| 3:10–3:50 | **4. Where it sits in the user's day + tech stack** | README §2 journey (numbered steps), then the architecture diagram of README §11.1 | "At the end of the visit, Noor's daughter hands the visitor a printed card. The visitor sends a WhatsApp voice note, later if there's no signal. At the weekend, the daughter shares the notes to Echo in one gesture; analysis runs offline in the background. Once a month Echo opens the SMS app with the recap in Kinyarwanda; she presses Send, Noor reads it on her basic phone, or listens to it on the smartphone. Stack: a Preact PWA, transformers.js and ONNX Runtime WebAssembly in a Web Worker, one TypeScript core shared by the app and the evaluation, IndexedDB, an optional Capacitor APK. Nothing runs on a server." |
| 3:50–4:30 | **5. Your take — what localizing AI development means to us** | README §13 bullet points as text cards; end card with repo name and "prototype: synthetic data labelled" | Read README §13 in short form: "For us, localizing AI means deciding where the model stops. The host's language is 30 frozen sentences a Kinyarwanda speaker can rewrite and re-record in an afternoon, without any model. The models fit the phone the household already owns, offline. The data is created by each farm, for that farm. And a small model must say 'not sure' rather than guess. The trade-offs: it captures about half the remarks by itself, it needs about 3 GB of RAM, and everything we measured is synthetic until a pilot with real farms." |

### Problem sentence (SPEC 13, with measured numbers; read verbatim in segment 1)

> "Because of this tool, small rural tourism hosts like Noor will know every month what visitors loved and what to
> fix first, which today they never learn once visitors leave; we know because the World Bank brief describes this
> exact gap, and our tests show the tool captures 48 % of visitor remarks versus 88 % for keyword matching."

Say the context right after, in one breath (it changes how the numbers read): "Echo counts fewer remarks by itself,
but what it counts is right 19 times out of 20, and it routes the rest to a person; keyword matching gets about one
answer in four wrong and never says so. These numbers are on our synthetic test corpus."

## Demo sequence to record (segment 3, ~1 min 50 s)

Preparation: `pnpm install && pnpm models:download && pnpm build && pnpm preview`, open http://localhost:4173 in
Chrome, let the models load once (01-demo-loading → 02-demo-ready), then turn the network off in DevTools
(or unplug) **before** recording, so the "Offline" badge is visible throughout. Browser window ~1280×800, zoom 110 %.

| # | Time | Action | Caption on screen |
|---|---|---|---|
| 1 | 1:20 | Show the "Offline" badge and the model box ("everything runs on this device", sizes) | "Offline. Models on the device." |
| 2 | 1:28 | Click sample **de-roasting-path** (German, synthetic voice): play a second of audio, then the result: transcript, language, chunks, findings with confidence | "Synthetic voice. German: roasting liked, path too long." (P3 + N1; the e2e test asserts both.) |
| 3 | 1:45 | Click **fr-welcome-meal** and **en-prices-buy** | "French and English: welcome, meal, unclear prices, wants to buy coffee." |
| 4 | 1:55 | Click **en-negation** | "'Not too long' is not a complaint. Keywords count it; Echo does not." |
| 5 | 2:03 | Click **fr-ambiguous** | "'Maybe a bit long at times': hedged, so not sure. Never guessed, listed for a person." (It ends in orange "not sure"; the e2e test asserts it.) |
| 6 | 2:10 | Click **inaudible-noise** | "1.6 s of noise: inaudible, not counted." |
| 7 | 2:15 | Click the three **picking** samples (en, de, fr) | "Three visitors, three languages, a topic the tool doesn't know: flagged for a person, never named." |
| 8 | 2:28 | Open the keyword-vs-Echo comparison (04-compare-keywords-vs-echo) | "Same messages, keyword matching: more counts, more wrong ones." |
| 9 | 2:38 | Open the Kinyarwanda recap with FR/EN glosses (05-recap-kinyarwanda); press **Listen** for two lines | "Only frozen catalog sentences. Kinyarwanda machine-translated, not yet validated by a speaker; synthetic voice." |
| 10 | 2:50 | Press **Send SMS 1/N**: show the SMS app (or the `sms:` link) pre-filled; **do not send** | "A person presses Send. Echo never acts by itself." Optional: cut to `apps/android/screenshots/emulator-sms-app-prefilled.png`, captioned "Android 14 emulator". |
| 11 | 2:57 | "To be read by a person" list (06-to-be-read), then the synthetic 3-month trends (07-trends-synthetic) | "Machine translation to be checked. History: synthetic." |
| 12 | 3:04 | Visitor card (11-visitor-card), cooperative view (10-coop-synthetic) | "Printed card for visitors. Cooperative view: synthetic farms, nothing sent." |

Optional insert if time allows (replace step 12): `apps/android/screenshots/emulator-share-received-offline.png`,
captioned "APK on an Android 14 emulator, airplane mode: a shared voice note queued". Do not imply a phone.

## Stills available (no recording needed)

`docs/screenshots/`: 01-demo-loading, 02-demo-ready, 03-message-result, 04-compare-keywords-vs-echo,
05-recap-kinyarwanda, 06-to-be-read, 07-trends-synthetic, 08-demo-full, 09-host-app, 10-coop-synthetic,
11-visitor-card, 12-offline, 13-offline-full. `apps/android/screenshots/`: emulator-share-received-offline,
emulator-sms-app-prefilled. `eval/results/coverage-error-curve.svg` (threshold choice, useful in segment 2).

## Checklist before upload

- [ ] Length between 2 and 5 minutes.
- [ ] All five segments present, in the order above.
- [ ] "Synthetic" said or shown for every synthetic element; "not validated by a speaker" said once for Kinyarwanda.
- [ ] Emulator shots captioned "emulator"; no claim of a real phone or a real SMS.
- [ ] Numbers match the current `eval/results/RESULTS.md`.
