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
translated at runtime. Audio recap = template audio split at slots (optional `templates[].audioParts`: one clip per
fixed part of `rw` between slots, length = slot occurrences + 1, checked by `validateCatalog`) + number clips + finding clips, all
pre-generated (if number clips are not produced, the audio recap reads the fixed parts and the UI shows the
digits; log it as a deviation). Examples used for matching are strictly separate from eval data.

## 5. Core API (`packages/core/src`)

Implemented and tested (fake embedder with controlled vectors, fake transcriber). Full reference and rules:
`packages/core/README.md`. Types in `types.ts`.

```ts
// ports.ts — implemented by @echo/models (real) and by fakes in tests
type EmbedFn = (texts: string[]) => Promise<Float32Array[]>;          // L2-normalised
interface Transcriber { transcribe(audio16k: Float32Array, o?: { language?: string; withEnglishTranslation?: boolean }): Promise<Transcript> }
interface Transcript { text; language; languageProbability?; confidence /*0..1*/; durationSec; englishTranslation? }
interface Ctx { newId(): string; now(): string }

// config.ts — thresholds provisional until calibrated by the evaluation
interface AnalysisConfig { acceptThreshold; offListThreshold; maxFindingsPerChunk /*2*/; secondFindingMargin;
  aggregation /*"max"|"topk_mean"*/; topK; crossLingual; minTranscriptConfidence; inaudibleConfidence;
  minLanguageProbability; minAudioSeconds /*3*/; minAudioRms; minAudioDynamicRangeDb; supportedLangs;
  offListClusterThreshold; offListMinVisitors /*3*/; duplicateEmbeddingThreshold; duplicateWindowDays }
DEFAULT_CONFIG; makeConfig(overrides)

// catalog.ts
validateCatalog(raw): Catalog; fillSlots(template, values): string   // templates[].audioParts? optional

// whole pipeline
analyzeMessage(input: MessageInput, deps: { catalog; matcher; config; knownFingerprints?; knownMessages? }): Promise<MessageAnalysis>
analyzeAudioMessage({ id, receivedAt, audio16k }, { ...deps, transcriber, withEnglishTranslation? }): Promise<MessageAnalysis>
  // stats → inaudible without transcription, or transcribe; the audio buffer is zero-filled afterwards
MessageAnalysis = { id; receivedAt; month; source; lang; status; reason?; scrubbedText; chunks: ChunkResult[];
  findings: {id, score}[]; coopFindings: FindingId[] /*not from guide chunks*/; notSureCount; offListCount;
  fingerprint; messageEmbedding?; englishTranslation? /*scrubbed*/; transcriptConfidence? }
ChunkResult = { id /*`${messageId}:${i}`*/; text; sentenceIndex; clauseIndex; status; findings /*≤2*/; topScores;
  negation; mentionsGuide; reason?; embedding? }
toStoredMessage(analysis): StoredMessage        // exactly the `messages` store row (no text)
toReviewChunks(analysis): ReviewChunk[]         // exactly the `reviewChunks` rows (scrubbed not-sure / off-list text)

// building blocks
segment(text, lang): { text; sentenceIndex; clauseIndex }[]     // splitSentences, splitClauses
scrubPii(text, lang): { text; removed: { names; phones; emails; handles } }   // [nom] [numéro] [e-mail] [pseudo]
detectNegation(chunk, lang): { negated; uncertain; cues }
detectTextLanguage(text): { lang; probability }                 // written messages only
createMatcher(catalog, embed, config, { precomputed?: Map<text, Float32Array> }): Promise<Matcher>
Matcher.match(chunks, lang) / .score(chunks, lang) / .embed / .examples
scoreFindings(...), decideChunk(rawScores, negation, config)   // pure: threshold sweeps in the eval
exportExampleEmbeddings(matcher)                               // cache for the app (13 s to embed 756 examples in Node)
mentionsGuide(text, lang); GUIDE_WORDS; isPhantomTranscript(text)
fingerprint(text); checkDuplicate(candidate, known, cfg)
computeAudioStats(samples, sampleRate) → { durationSec; rms; dynamicRangeDb }; audioInaudibleReason(stats, cfg)
clusterOffList(items, cfg): { id; chunkIds; distinctVisitors; months; recurring }[]; recurringUnknownVisitors(clusters)
buildMonthlyRecap({ month, messages: MonthMessage[], recurringUnknownVisitors }, catalog): { month; lines; stats }
RecapLine = { templateId; findingId?; slots; rw; fr; en; audio: string[]; missingAudio: string[] }
recapRwLines(recap); recapAudio(recap)
isGsm7; gsm7Length; toGsm7; splitSms(lines, maxLen = 160, { numbered? }); smsUri(phone, body)
keywordClassify(chunk, lang, lists | catalog, mode = "prefix"); keywordAnalyze(...); keywordListsFromFiles(eval/keywords/*.json)
aggregateCooperative(farms: { farmId; consent; messages: { month; status; coopFindings }[] }[], catalog, { months? })
```

### Decision rules (implemented in core, tested with fakes)
- **Inaudible** (message, never counted, no guess): audio < `minAudioSeconds`, RMS < `minAudioRms`, frame-energy
  dynamic range < `minAudioDynamicRangeDb` (steady noise without speech), Whisper phantom transcript
  (`[Music]`, Amara.org subtitle credits…), ASR confidence < `inaudibleConfidence` (too noisy), empty text.
- **Whole message not sure**: language ∉ `supportedLangs` (`unsupported_language`), `languageProbability <
  minLanguageProbability` (`low_language_probability`), or `confidence < minTranscriptConfidence`
  (`message_low_confidence`) → every chunk `not_sure`, nothing counted.
- **Chunk, `scoring: "linear"` (shipped default, chosen by the evaluation)**: logistic regression on the catalog examples'
  embeddings (trained in `createMatcher`, cacheable via `matcher.classifier`); accept the most probable finding if
  probability ≥ `acceptProbability` and negation agreement holds for it; floor and uncertain negation as below.
- **Chunk, `scoring: "similarity"`**: score per finding = max (or top-k mean) cosine with its examples (all languages, or detected language
  only with `crossLingual: false`). Best ≥ `acceptThreshold` → `matched` (2nd finding only if it also passes and is
  within `secondFindingMargin`; max 2). `offListThreshold ≤ best < acceptThreshold` → `not_sure`. Below → `off_list`.
- **Negation agreement** (the "safe, tested rule"): every catalog example is tagged negated or not with
  `detectNegation`. A chunk is only accepted through examples with the same negation status. If the closest example
  has the opposite status, the meaning is inverted → never counted, `not_sure` (`reason: "negation"`). So "the path was
  not too long" never gives N1 and "the food was not good" never gives P4, while "there was no shade" still gives N8
  through its negated examples. Uncertain negation (litotes, attenuation, en/de double negation) → `not_sure`.
  Catalog rule: examples phrase the finding itself, never a polarity-inverted version of it.
- **Duplicates**: same `fingerprint` (normalised scrubbed text) or message-embedding cosine ≥
  `duplicateEmbeddingThreshold`, within `duplicateWindowDays` when dates are known → `status: "duplicate"`.
- **Guide**: chunk containing a `GUIDE_WORDS` word → `mentionsGuide: true`; counts for the host, excluded from
  `coopFindings` (cooperative view and exports).
- **Message findings**: union over chunks, each finding counted once per message ("k out of n" counts visitors).
- **Recap**: n = non-duplicate, non-inaudible messages of the month (a `not_sure` message counts in n; its chunks in p).
  Keep = most cited positive (tie → longest streak, then catalog order; no line if none). Fix = most cited negative
  among those with ≥2 mentions or cited in ≥2 consecutive calendar months; tie → longest streak; else
  `nothing_urgent`. `fix_streak` when streak x ≥ 2. Unknown-topic line if `recurringUnknownVisitors > 0`.
  `not_understood` with p = number of not-sure chunks. No messages → single `no_feedback` line. ≤ 5 lines.
  Throws `RecapError` if a frozen Kinyarwanda sentence is missing (never a fallback text).
- **Distinct visitors** (off-list rule): visitor key = message id after duplicate removal (phone numbers are never
  stored, so two messages from the same visitor count twice — documented limit).

## 6. Message pipeline (app)

```
WhatsApp "Share" ─▶ Web Share Target (POST multipart, handled in the service worker)
                    └▶ IndexedDB `queue` (audio Blob or text) ─▶ UI "N messages waiting"
Worker (on demand, offline):
  audio ─▶ decode to 16 kHz mono (OfflineAudioContext; WhatsApp sends .opus/.ogg — Chrome decodes Opus)
        ─▶ core.analyzeAudioMessage: audioStats (duration, RMS, dynamic range) ─▶ Transcriber.transcribe(withEnglishTranslation)
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
| `messages` | `id` | `StoredMessage` from `toStoredMessage`: `receivedAt`, `month`, `lang`, `source`, `status`, `findings: {id, confidence}[]`, `coopFindings`, `notSureCount`, `offListCount`, `fingerprint`, `embedding?` (message embedding, near-duplicates), `synthetic?` | No text, no audio, no sender. Index on `month`, `fingerprint`. |
| `reviewChunks` | `id` | `ReviewChunk` from `toReviewChunks`: `messageId`, `month`, `status: "not_sure"|"off_list"`, `text` (scrubbed), `englishMT?` (scrubbed), `mentionsGuide`, `reason?`, `embedding` (Float32Array, for clustering), `clusterId?` (set by the app) | The "To be read by a person" list. |
| `recaps` | `month` | `lines: RecapLine[]`, `builtAt`, `smsOpenedAt?` | |
| `settings` | `key` | `hostPhone` (the host's own number), `pinHash?`, `coopConsent`, `asrModel`, `thresholds?` | |

`fingerprint` (non-reversible hash) and the embeddings are derived technical data needed for duplicates and
off-list clustering; documented in the README privacy section. Demo data (3 simulated months) is stored with
`synthetic: true` and shown with a "synthetic" badge. Optional PIN (SPEC 6 bonus): hash with PBKDF2 (WebCrypto).

## 8. Evaluation (`eval/`)

`pnpm eval` runs everything; `pnpm eval -- --level 1|2|3|perf|report` (repeatable) runs one part,
`--whisper tiny,base,small` picks the ASR sizes. Uses `@echo/models` and `@echo/core` exactly as the app does.
Full results: `eval/results/RESULTS.md` (generated) + `level1.json`, `level2.json`, `level3.json`, `perf.json`,
`thresholds.json`, `coverage-error-curve.svg` (committed); transcript caches in `eval/results/raw/` (git-ignored).
- Level 1: FLEURS test (en_us, fr_fr, de_de, es_419, sw_ke) fetched from the hub's `refs/convert/parquet` branch by
  `eval/scripts/fetch_fleurs.py` into `datasets/fleurs/` (fixed seeded sample, 100 utterances/language; whisper-small 50).
- Level 2: `eval/data/feedback.jsonl` split 50/50 calibration / held-out test (stratified, seeded). On the calibration
  half: variant (embedding model × scoring × L2), off-list floor, then acceptance threshold (max remarks captured s.t.
  error among accepted answers ≤ 5 % and cancelling-negation accuracy ≥ 85 %). The chosen values are **written to
  `packages/core/src/calibration.ts`**, which `DEFAULT_CONFIG` reads, and `DEFAULT_EMBEDDING_MODEL` (`@echo/models`)
  follows `CALIBRATION.embeddingModel`. Unknown-topic cluster threshold calibrated on catalog examples only.
- Level 3: the 80 Piper clips (clean, clean + 0.4 s silence, 20/10/5 dB SNR ESC-50) → `analyzeAudioMessage`.
- Performance: per-process peak RSS and 30 s message timings with 8/2/1 cores (`taskset`), WebAssembly overhead measured
  with onnxruntime-web vs onnxruntime-node on the same ONNX files, low-end Android = labelled estimate
  (real measurement: `docs/MANUAL_TESTS.md`).

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
