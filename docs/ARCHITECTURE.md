# Echo — Architecture

Product spec (source of truth, French): `docs/SPEC.md`. This file is the technical contract between the
modules. Keep it current when a contract changes (and log the change in `docs/PROGRESS.md`).

## 1. Stack and why

| Choice | Why (link to the spec / jury criterion) |
|---|---|
| **pnpm monorepo, TypeScript everywhere at runtime** | One language for the app *and* the evaluation, so the numbers in the README are the numbers of the shipped code (CLAUDE.md, SPEC 9). |
| **`packages/core`: pure TS, zero dependency, no I/O, no model runtime** | All analysis rules (segmentation, PII, negation, thresholds, "not sure", off-list, recap, SMS) are unit-testable with fake ports, and identical in the browser and in Node. |
| **`packages/models`: transformers.js adapters implementing the core ports** | Same adapter code (language detection, confidence, embedding pooling) in the Web Worker and in the evaluation. transformers.js runs ONNX quantized models in the browser (onnxruntime-web, WASM) and in Node (onnxruntime-node). |
| **`apps/web`: Vite + TypeScript + Preact PWA** | Runs on any phone the household already owns (Android Chrome), no install store, no account (SPEC 1, 8). Preact keeps the JS tiny for low-end phones; the models dominate the download anyway. Service worker precaches app + models so the main function works in airplane mode after first load. Web Share Target receives WhatsApp voice notes / text in one gesture (SPEC 4.2). |
| **Real SMS through the `sms:` URI** | Opens the phone's own SMS app prefilled with the frozen Kinyarwanda recap; a human presses Send; it goes over the SIM with no internet (SPEC 4.6). Honest (nothing simulated) and keeps the human in the loop. A Capacitor APK that sends silently is *not* planned: it would act on behalf of the user. |
| **IndexedDB (via `idb`)** | On-device storage only, nothing in the cloud (SPEC 6). |
| **`eval/`: Node + tsx, `pnpm eval`** | One command for the three levels of SPEC 9, same models, same core. |
| **`tools/`: Python, build time only** | NLLB-200 + back-translation + MMS-TTS kin to freeze the Kinyarwanda catalog once; synthetic test audio; dataset download. Never needed at runtime. |
| **vitest + tsc** | Tests next to the code; `pnpm test` and `pnpm typecheck` from the root. |

## 2. Directory ownership

Each agent touches only its own paths (plus appending to `docs/PROGRESS.md`).

| Path | Owner | Content |
|---|---|---|
| repo root files, `docs/ARCHITECTURE.md`, `docs/PROGRESS.md` (created), `models/README.md` | scaffold / architect | workspace config, this contract |
| `packages/core/` | core agent | analysis logic (section 5) |
| `packages/models/` | scaffold wrote a working version; core-adjacent changes coordinated via PROGRESS.md (web and eval agents may extend, never fork) | transformers.js adapters |
| `apps/web/` | web agent | PWA, worker, storage, share target, SMS, demo |
| `eval/` | evaluation agent | `pnpm eval`, synthetic feedback set, results |
| `catalog/` | catalog agent | `catalog.json` examples/keywords, Kinyarwanda, `audio/` |
| `tools/` | catalog / data agents | Python build-time scripts, dataset download |
| `README.md`, `docs/MANUAL_TESTS.md` | docs agent (anyone may append to MANUAL_TESTS.md) | jury-facing documentation |
| `docs/SPEC.md`, `docs/hackathon-brief.*`, `CLAUDE.md` | nobody (read only; CLAUDE.md commands section may be appended) | |

Git-ignored, re-creatable by script: `node_modules/`, `.venv/`, `models/*` (except README), `datasets/`,
`eval/data/generated/`, `eval/audio/generated/`, `eval/results/raw/`, `tools/cache/`, `*.onnx`.
Committed: `catalog/catalog.json`, `catalog/audio/*` (small), demo sample audio, eval result summaries.

## 3. Models

All verified on Hugging Face on 2026-10-03 and loaded with `@huggingface/transformers` 4.3.0 in Node
(`pnpm smoke:models`). Sizes are the actual downloaded files (ONNX int8 dynamic quantization = dtype `q8`,
plus tokenizer and configs).

| Model | Role | Files | Size | License |
|---|---|---|---|---|
| `onnx-community/whisper-tiny` | ASR candidate | encoder_model_quantized + decoder_model_merged_quantized | 43.6 MB | Whisper MIT / Apache-2.0 conversion |
| `onnx-community/whisper-base` | **ASR default (provisional)** | same | 79.7 MB | idem |
| `onnx-community/whisper-small` | ASR candidate (`--all`) | same | ~252 MB | idem |
| `Xenova/paraphrase-multilingual-MiniLM-L12-v2` | **sentence similarity default** | model_quantized | 135.4 MB | Apache-2.0 |
| `Xenova/multilingual-e5-small` | similarity candidate | model_quantized | 135.4 MB | MIT |

Smoke test (this WSL2 box, 8 CPUs, Node, onnxruntime-node CPU; one 4.5 s synthetic flite English clip):

| | load | transcribe 4.5 s | lang / p | confidence | text |
|---|---|---|---|---|---|
| whisper-tiny q8 | 0.6 s | 1.3 s | en / 0.991 | 0.926 | exact |
| whisper-base q8 | 0.8 s | 1.9 s | en / 0.996 | 0.948 | exact |

Embedding cosine, "The path to the farm was far too long." vs: German paraphrase 0.866 (MiniLM) / 0.924 (e5);
French paraphrase 0.929 / 0.940; unrelated Spanish "El almuerzo estaba delicioso." **−0.050 / 0.798**;
negated "The path was not too long." vs "far too long" 0.455 / 0.944.
→ MiniLM spreads scores far better (e5 compresses everything into 0.8–0.95, which makes a calibrated
threshold and the "off-list" band fragile), so **MiniLM is the default**; the evaluation confirms or replaces.
Neither model handles negation by itself: `detectNegation` in core is mandatory.

Whisper choice: SPEC 4.3 asks for the smallest Whisper with acceptable results, justified by SPEC 9 measures.
The evaluation runs tiny and base (small optional) on FLEURS and on level 3, then the choice is written here.
Default total app download with base + MiniLM: ~215 MB (tiny: ~179 MB).

### Where model files live
- `pnpm models:download` → `models/<org>/<name>/...` (Hugging Face layout, git-ignored, idempotent).
- Node (eval): `useLocalModels(<repo>/models)` from `@echo/models` sets `env.localModelPath`, `env.allowRemoteModels = false`.
- Browser: the web app serves `models/` **from its own origin** at `/models/` (dev middleware or `publicDir`
  copy at build) and sets `env.localModelPath = "/models/"`, `env.allowRemoteModels = false`. The
  onnxruntime-web WASM files must also be self-hosted (`env.backends.onnx.wasm.wasmPaths = "/ort/"`, copied
  from `node_modules/@huggingface/transformers/dist` or `onnxruntime-web/dist`) — otherwise they come from a CDN
  and offline breaks. The service worker precaches `/models/**` and `/ort/**` (large files: use a runtime
  CacheFirst route with a "download models" button and a progress bar rather than blocking install).
  Side-loading: copying the `models/` folder next to the built app is enough.

### Adapter behaviours (`packages/models`)
- transformers.js **does not detect the language** (it silently defaults to English). `createWhisperTranscriber`
  does one decoder pass on `<|startoftranscript|>` and takes the softmax over language tokens (optionally
  restricted to `candidateLanguages`) → `language`, `languageProbability`. Then it transcribes with that language.
- `confidence` = exp(mean log-prob of the chosen tokens), recorded by a custom `LogitsProcessor`.
- `withEnglishTranslation` runs a second decode with `task: "translate"` (for the "To be read by a person" list,
  labelled "machine translation, to be checked"). Must be done **before** the audio is deleted.
- Audio longer than 30 s is processed in 30 s windows (the demo recorder caps at 30 s).
- `createEmbedder` = mean pooling + L2 normalisation; adds `"query: "` for e5 models.

## 4. Catalog (`catalog/catalog.json`)

Schema: `catalog/catalog.schema.json` (JSON Schema 2020-12); TypeScript mirror and validator:
`packages/core/src/catalog.ts` (`validateCatalog`, `fillSlots`). Current file: 21 findings with ids, labels,
polarity; examples, keywords and Kinyarwanda empty (filled by the catalog agent).

```jsonc
{
  "schemaVersion": 1,
  "version": "0.1.0",
  "provenance": {
    "examples": "synthetic",
    "kinyarwanda": {
      "disclaimer": "Machine translation, not validated by a Kinyarwanda speaker / ...",
      "mtModel": "facebook/nllb-200-distilled-600M",
      "similarityModel": "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
      "ttsModel": "facebook/mms-tts-kin", "ttsLicense": "CC-BY-NC 4.0",
      "floresReference": { "metric": "chrF++ eng_Latn→kin_Latn", "value": 0, "source": "NLLB paper / model card" },
      "acceptThreshold": 0.75
    }
  },
  "languages": ["en", "fr", "de", "es"],
  "findings": [{
    "id": "N1",
    "labels": { "fr": "Chemin ou accès trop long ou difficile", "en": "Path or access too long or difficult" },
    "polarity": "negative",
    "examples": { "en": ["5-10 synthetic phrasings"], "fr": [], "de": [], "es": [] },
    "examplesSynthetic": true,
    "keywords": { "en": ["path", "walk", "far"], "fr": [], "de": [], "es": [] },   // keyword baseline (SPEC 9)
    "kinyarwanda": {                       // sentence inserted in {finding}; null until generated
      "rw": "...",
      "source": { "fr": "le chemin est trop long", "en": "the path is too long" },
      "backTranslation": { "fr": "...", "en": "..." },
      "similarity": 0.83, "attempts": 1,
      "audio": "audio/finding-N1.wav",     // relative to catalog/
      "status": "machine_translated_unvalidated"
    }
  }],
  "templates": [                            // recap line templates, same KinyarwandaSentence shape
    { "id": "volume",         "slots": ["n"],                  "kinyarwanda": { "rw": "... {n} ...", "source": { "fr": "Ce mois-ci : {n} retours.", "en": "..." }, ... } },
    { "id": "keep",           "slots": ["finding", "k", "n"] },
    { "id": "fix",            "slots": ["finding", "k", "n"] },
    { "id": "fix_streak",     "slots": ["finding", "k", "n", "x"] },
    { "id": "nothing_urgent", "slots": [] },
    { "id": "unknown_topic",  "slots": ["k"] },
    { "id": "not_understood", "slots": ["p"] },
    { "id": "no_feedback",    "slots": [] }
  ],
  "numbers": { "7": { "rw": "...", "audio": "audio/num-7.wav" } }   // optional, for the audio recap
}
```

Rules: numbers stay digits, slots `{n} {k} {x} {p} {finding}` must survive translation (checked by
`validateCatalog`); every Kinyarwanda string keeps its back-translation and similarity score; nothing is
translated at runtime. Audio recap = template audio split at slots + number clips + finding clips, all
pre-generated (if number clips are not produced, the audio recap reads the fixed parts and the UI shows the
digits; log it as a deviation). Examples used for matching are strictly separate from eval data.

## 5. Core API (`packages/core/src`)

Signatures exist as stubs (`notImplemented`) in the scaffold; the core agent implements them. Types in `types.ts`.

```ts
// ports.ts — implemented by @echo/models (real) and by fakes in tests
type EmbedFn = (texts: string[]) => Promise<Float32Array[]>;          // L2-normalised
interface Transcriber { transcribe(audio16k: Float32Array, o?: { language?: string; withEnglishTranslation?: boolean }): Promise<Transcript> }
interface Transcript { text; language; languageProbability?; confidence /*0..1*/; durationSec; englishTranslation? }
interface Ctx { newId(): string; now(): string }

// config.ts
interface AnalysisConfig { acceptThreshold; offListThreshold; maxFindingsPerChunk /*2*/; secondFindingMargin;
  minTranscriptConfidence; minLanguageProbability; minAudioSeconds /*3*/; minAudioRms; supportedLangs;
  offListClusterThreshold; offListMinVisitors /*3*/ }
const DEFAULT_CONFIG: AnalysisConfig   // thresholds provisional until calibrated by the evaluation

// catalog.ts
validateCatalog(raw: unknown): Catalog
fillSlots(template: string, values: Partial<Record<Slot, string|number>>): string

// segment.ts — sentences, then clauses on but/mais/aber/pero/however/cependant/jedoch/sin embargo...
segment(text: string, lang: DetectedLang): { text; sentenceIndex; clauseIndex }[]
// pii.ts — names, phone numbers, e-mails → [nom]/[numéro]/[e-mail] tokens, before any storage
scrubPii(text: string, lang: DetectedLang): { text; removed: { names; phones; emails } }
// negation.ts — per-language cues (not/n't/no/never, ne…pas/jamais/aucun, nicht/kein/nie, no/nunca/ningún)
detectNegation(chunk: string, lang: DetectedLang): { negated; uncertain; cues: string[] }
// matcher.ts — embeds catalog examples once; per chunk: max cosine per finding
createMatcher(catalog, embed: EmbedFn, config): Promise<Matcher>
Matcher.match(chunks: { text; negation }[], lang): Promise<{ status; findings /*≤2*/; topScores /*top3*/; embedding; reason? }[]>
cosine(a, b): number
// analyze.ts — whole pipeline for one message (transcript already produced)
analyzeMessage(input: MessageInput, deps: { catalog; matcher; config; knownFingerprints? }): Promise<MessageAnalysis>
GUIDE_WORDS: Record<lang, string[]>
// duplicates.ts
fingerprint(text: string): string      // hash of normalised scrubbed text (not reversible)
// offlist.ts — greedy/agglomerative clustering on embeddings; recurring if ≥3 distinct visitors
clusterOffList(items: { chunkId; visitorKey; month; text; embedding }[], cfg): { id; chunkIds; distinctVisitors; recurring }[]
// recap.ts — ONLY frozen catalog sentences + digits, ≤5 lines (SPEC 4.6)
buildMonthlyRecap({ month, messages: { id; month; status; findings; notSureCount }[], recurringUnknownVisitors }, catalog): { month; lines: RecapLine[] }
RecapLine = { templateId; findingId?; slots; rw; fr; en; audio: string[] }
// sms.ts
isGsm7(text): boolean; toGsm7(text): string; splitSms(lines: string[], maxLen = 160): string[]; smsUri(phone, body): string
// baseline.ts — keyword method for the comparison mode and the eval (no negation handling on purpose)
keywordClassify(chunk: string, lang, catalog): FindingId[]
```

### Decision rules (to implement in core, tested with fakes)
- **Inaudible** (message): `audioStats.durationSec < 3`, RMS < `minAudioRms`, or empty/near-empty transcript → `status: "inaudible"`, no chunks counted, no guess.
- **Whole message not sure**: detected language ∉ `supportedLangs`, `languageProbability < minLanguageProbability`, or `confidence < minTranscriptConfidence` → every chunk `not_sure` (`reason: "message_low_confidence"`).
- **Chunk**: best score ≥ `acceptThreshold` → `matched` (add a 2nd finding only if it also passes the threshold and is within `secondFindingMargin`; max 2). `offListThreshold ≤ best < acceptThreshold` → `not_sure`. best < `offListThreshold` → `off_list`.
- **Negation**: a negated chunk must not count the matched finding as is (e.g. "path was not too long" must not give N1). Default: negated + matched → `not_sure` (`reason: "negation"`), unless the core agent implements a safe, tested rule; `uncertain` → `not_sure`.
- **Duplicates**: same `fingerprint` as a stored message → `status: "duplicate"`, not counted.
- **Guide**: chunk containing a `GUIDE_WORDS` word → `mentionsGuide: true` (host only, never in the cooperative view).
- **Message findings**: union over chunks, each finding counted once per message ("k out of n" counts visitors).
- **Recap**: n = non-duplicate, non-inaudible messages of the month (`not_sure` messages count in n? → yes as feedback received; their chunks count in p). Keep = most cited positive. Fix = most cited negative if ≥2 mentions or cited in ≥2 consecutive months; tie → longest streak; else `nothing_urgent`. `fix_streak` when streak x ≥ 2. Unknown topic line if a recurring off-list cluster exists. `not_understood` with p = number of not-sure chunks. No messages → single `no_feedback` line.
- **Distinct visitors** (off-list rule): visitor key = message id after duplicate removal (phone numbers are never stored, so two messages from the same visitor count twice — documented limit).

## 6. Message pipeline (app)

```
WhatsApp "Share" ─▶ Web Share Target (POST multipart, handled in the service worker)
                    └▶ IndexedDB `queue` (audio Blob or text) ─▶ UI "N messages waiting"
Worker (on demand, offline):
  audio ─▶ decode to 16 kHz mono (OfflineAudioContext; WhatsApp sends .opus/.ogg — Chrome decodes Opus)
        ─▶ audioStats (duration, RMS) ─▶ Transcriber.transcribe(withEnglishTranslation)
        ─▶ DELETE the audio Blob from `queue` immediately
  text  ─▶ (no transcription; language = simple detector or user choice)
  ─▶ core.analyzeMessage ─▶ store only what SPEC 6 allows ─▶ recompute off-list clusters ─▶ recap
Recap ─▶ screen (rw + fr/en glosses in the demo) ─▶ "Listen" (pre-generated audio clips)
      ─▶ "Send by SMS" = splitSms + location.href = smsUri(hostPhone, part) per part (human presses Send)
```

Web Share Target manifest (`share_target`): `action: "/share-target"`, `method: "POST"`,
`enctype: "multipart/form-data"`, `params: { title, text, files: [{ name: "audio", accept: ["audio/*", ".opus", ".ogg", ".m4a"] }] }`.
Android Chrome only shows the share target once the PWA is installed. Not testable here → `docs/MANUAL_TESTS.md`.
Fallback: file picker "Import a voice message" and paste box for text.

## 7. Storage schema (IndexedDB `echo`, version 1) — only what SPEC 6 allows

| Store | Key | Fields | Notes |
|---|---|---|---|
| `queue` | `id` | `receivedAt`, `kind: "audio"|"text"`, `blob?`, `text?`, `mime?` | Temporary inbox. Audio deleted right after transcription; text deleted after analysis. |
| `messages` | `id` | `receivedAt`, `month`, `lang`, `source`, `status`, `findings: {id, confidence}[]`, `notSureCount`, `offListCount`, `fingerprint` | No text, no audio, no sender. Index on `month`, `fingerprint`. |
| `reviewChunks` | `id` | `messageId`, `month`, `status: "not_sure"|"off_list"`, `text` (scrubbed), `englishMT?`, `mentionsGuide`, `embedding` (Float32Array, for clustering), `clusterId?` | The "To be read by a person" list. |
| `recaps` | `month` | `lines: RecapLine[]`, `builtAt`, `smsOpenedAt?` | |
| `settings` | `key` | `hostPhone` (the host's own number), `pinHash?`, `coopConsent`, `asrModel`, `thresholds?` | |

`fingerprint` (non-reversible hash) and `embedding` are derived technical data needed for duplicates and
off-list clustering; documented in the README privacy section. Demo data (3 simulated months) is stored with
`synthetic: true` and shown with a "synthetic" badge. Optional PIN (SPEC 6 bonus): hash with PBKDF2 (WebCrypto).

## 8. Evaluation (`eval/`)

`pnpm eval` runs everything (levels may be selected with flags, e.g. `--level 2`). Uses `@echo/models` and
`@echo/core` exactly as the app does.
- `eval/data/feedback.jsonl` (committed): 150–300 synthetic visitor feedbacks, annotated, disjoint from catalog examples.
- Level 1: FLEURS test subsets (en, fr, de, es, + sw) in `datasets/` → WER per language per Whisper size.
- Level 2: text → core pipeline → precision/recall/F1 per finding and overall, not-sure rate, error rate among
  accepted answers, coverage-vs-error curve over thresholds (→ chosen `acceptThreshold`), confusion matrix,
  unknown-topic detection, keyword baseline on the same data.
- Level 3: 60–100 feedbacks synthesised (multilingual TTS, varied voices/speed) + public ambient noise at
  several SNRs (`eval/audio/generated/`, git-ignored) → Whisper → core; WER and loss vs level 2.
- Performance: model sizes, RSS memory, time for a 30 s message (Node here; low-end Android → manual test).
- Outputs: `eval/results/summary.json` + `eval/results/summary.md` (committed), raw outputs git-ignored.

## 9. Commands

```bash
pnpm install                 # workspace install (pnpm 11; build scripts allowed in pnpm-workspace.yaml)
pnpm models:download         # models into models/ (add -- --all for whisper-small)
pnpm smoke:models            # transcribe a synthetic clip + embed sentences with every downloaded model
pnpm test                    # vitest, all packages
pnpm typecheck               # tsc on every package
pnpm dev                     # web app dev server (5173, LAN-visible)
pnpm build                   # web app production build
pnpm eval                    # the three-level evaluation (SPEC 9)
python3 -m venv .venv && .venv/bin/pip install -r tools/requirements.txt   # build-time Python tools
```
