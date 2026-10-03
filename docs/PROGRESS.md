# Echo — build progress log

Append a dated section per work session: what was built, how to run/test it, deviations from `docs/SPEC.md`,
what remains. Never delete a spec feature silently: log it here.

## 2026-10-03 — scaffold (architect)

**Built**
- pnpm 11 monorepo: `packages/core` (pure TS, zero deps), `packages/models` (transformers.js adapters),
  `apps/web` (Vite 8 + Preact skeleton, builds), `eval/` (tsx; `pnpm eval` stub, `pnpm smoke:models` works),
  `tools/` (download script, Python requirements, `.venv` created empty), `catalog/` (schema + minimal catalog).
- `docs/ARCHITECTURE.md`: stack rationale, ownership, models with measured smoke results, catalog schema,
  core API, decision rules, message pipeline, IndexedDB schema, evaluation layout, commands.
- `catalog/catalog.json`: the 21 findings (ids, fr/en labels, polarity), empty examples/keywords,
  `kinyarwanda: null`; the 8 recap templates with fr/en sources and empty `rw`. Validated by
  `validateCatalog` (test in `packages/core/src/catalog.test.ts`).
- Core API stubs (`notImplemented`) with full types for segment, PII, negation, matcher, analyzeMessage,
  duplicates, off-list clustering, recap, SMS, keyword baseline. Implemented: `validateCatalog`, `fillSlots`,
  `cosine`, `smsUri`.
- `packages/models` is working: `createWhisperTranscriber` (own language detection — transformers.js has none and
  silently forces English —, confidence from token log-probs, optional English translation, 30 s windows) and
  `createEmbedder` (mean pooling, L2 norm, e5 prefix). `useLocalModels()` forbids the HF hub in Node.
- `pnpm models:download` fetched whisper-tiny (43.6 MB), whisper-base (79.7 MB),
  paraphrase-multilingual-MiniLM-L12-v2 (135.4 MB), multilingual-e5-small (135.4 MB) into `models/` (git-ignored).

**Verified here**: `pnpm install`, `pnpm test` (3 tests), `pnpm typecheck` (4 packages), `pnpm build`,
`pnpm smoke:models`: whisper tiny and base both transcribe a synthetic 4.5 s English flite clip exactly
(lang en p≈0.99, confidence 0.93/0.95, 1.3 s/1.9 s on this CPU); MiniLM separates paraphrases (0.87–0.93)
from unrelated text (−0.05) much better than e5-small (0.80 for unrelated) → MiniLM default.
Neither embedder handles negation ("not too long" vs "far too long": 0.46 MiniLM, 0.94 e5) → core negation rule is mandatory.

**Deviations / decisions**
- Added `packages/models` (not in the initial plan) so the Web Worker and the evaluation share the exact adapter code.
- Language detection is not provided by transformers.js; implemented in the adapter (one decoder pass over language tokens).
- Distinct-visitor rule for off-list topics uses message ids (phone numbers are never stored), so one visitor
  sending two different messages counts twice: documented limit.
- Whisper size (tiny vs base) not chosen yet: default `whisper-base` is provisional until SPEC 9 measures.
- onnxruntime-node's postinstall also downloads unused CUDA libraries (~300 MB in node_modules); harmless.

**Remains (for the other agents)**: everything marked `notImplemented` in core; the web PWA (worker, SW
precache of `/models` and `/ort`, share target, IndexedDB, sms:, demo); catalog examples, keywords and
Kinyarwanda; the three-level evaluation; README and data sheet; manual tests on a real Android phone and SMS.

## 2026-10-03 — data sheet research (datasheet-research)

**Built**
- `docs/DATASHEET.md`: the SPEC 10 data sheet (problem data, build/eval data and models, what the data does not
  cover, "Echo creates the missing data"). Every license was checked on its primary page (URL + access date
  2026-10-03 in the file).
- `docs/evidence/`: raw World Bank WDI API JSON for Rwanda (`ST.INT.ARVL`, `ST.INT.RCPT.CD`, `ST.INT.RCPT.XP.ZS`,
  `ST.INT.XPND.CD`) plus indicator metadata (source: UN Tourism); Overpass script `overpass_count.py` and its result
  `overpass_result_2026-10-03.json` (tourism / farm-tourism / coffee objects within 15 km of Huye, Nyamasheke and
  Gakenke: 0 farm-tourism tags, 1 coffee tourist attraction); verbatim excerpts of the Enterprise Surveys Rwanda 2023
  profile and of the GSMA Mobile Gender Gap Reports 2025/2026; NLLB-200-distilled-600M FLORES-200 chrF++ for kin
  (eng→kin 44.0, kin→eng 51.3) from Meta's metrics file.

**How to rerun**: `python3 docs/evidence/overpass_count.py` (stdlib; Overpass is rate-limited, the script retries);
WDI: `curl "https://api.worldbank.org/v2/country/RWA/indicator/ST.INT.ARVL?format=json&per_page=100"`.

**Findings worth knowing for the README**
- WDI (UN Tourism) Rwanda: 1.634 M arrivals and US$ 635.9 M receipts = 28.2 % of exports in 2019; WDI has no
  arrivals after 2019 and no receipts after 2020. RDB 2024: US$ 647 M, 1.36 M visitors (different definition).
- Enterprise Surveys 2023: access to finance is the biggest obstacle for 30.0 % of small firms. The survey excludes
  agriculture, firms under 5 employees and informal firms.
- GSMA: Rwanda was surveyed only in 2024 (2025 edition): women 23 % smartphone vs men 37 %, mobile ownership 59 %
  vs 72 %, 36 % of women have a basic or feature phone as their best handset. The 2026 edition (14 countries)
  does not include Rwanda; SSA women smartphone ownership 34 %, gap 22 %.
- Whisper has no Kinyarwanda token (99 languages); FLEURS has no Kinyarwanda config.
- Common Voice moved to Mozilla Data Collective (CC0-1.0) in Oct 2025; not downloaded.
- `piper-tts` 1.8.0 (installed by the eval tooling) is GPL-3.0-or-later (build-time only, not shipped); ESC-50 is
  CC BY-NC 3.0 overall (ESC-10 CC BY 3.0); NLLB-200 and MMS-TTS are CC-BY-NC 4.0, so Echo as built is non-commercial.

**Deviations**: the UN Tourism dashboard is interactive and "All rights reserved"; Rwanda values were taken from the
WDI redistribution of the UN Tourism series (CC BY 4.0) instead of the dashboard itself.

**Remains**: two clearly marked TODO slots in `docs/DATASHEET.md` (Piper voice list / clip count / hours, and ESC-50
clip count / SNR levels) to fill from the evaluation manifests once level 3 is final; the README agent copies or
links the data sheet into README section 6.

## 2026-10-03 — core analysis (`packages/core`, core-analysis agent)

**Built** (pure TS, zero dependency, test-first with a fake embedder of controlled concept vectors and a fake
transcriber; 100 tests in `packages/core/src/*.test.ts`). API documented in `packages/core/README.md`,
`docs/ARCHITECTURE.md` §5 and §7 updated.
- `analyzeMessage` (whole pipeline) and `analyzeAudioMessage` (audio stats → inaudible without transcription, or
  transcribe with English MT → audio buffer zero-filled → analyse).
- PII scrubbing (`scrubPii`): introductions in en/fr/de/es ("my name is", "je m'appelle", "ich heiße", "me llamo"…),
  honorifics and roles ("Frau Müller", "our guide Eric"), thanks + name, capitalised mid-sentence words (en/fr/es,
  with a list of places/languages/days/brands kept), phone numbers (≥7 digits), e-mails (written or dictated
  "at … dot com"), @handles. Also applied to Whisper's English translation.
- Sentence then clause segmentation (contrastive connectors always; and/et/und/y only between clauses of ≥3 words;
  leading concessive "Although X, Y").
- Negation per language with non-negating idioms (not only, sans doute, nicht nur, sin duda, never forget) and
  uncertain forms (litotes, attenuation, en/de double negation; fr/es negative concord is not doubt).
- Matcher: max or top-k-mean cosine, cross-lingual or same-language, **negation agreement** rule (examples tagged
  negated/not; acceptance only through examples of the same negation status; inverted meaning → not sure).
  ≤2 findings per chunk, accept / off-list thresholds as parameters, `score` + pure `decideChunk` for threshold
  sweeps, `precomputed` example embeddings (cache: 756 examples take 13 s to embed with MiniLM in Node).
- Inaudible (<3 s, silence, steady noise by frame-energy dynamic range, Whisper phantom transcripts, very low
  confidence), whole-message not sure (unsupported language, low language probability, low ASR confidence).
- Guide mentions flagged; `coopFindings` excludes findings supported only by guide chunks.
- Duplicates: normalised-text fingerprint + near-identical message embedding, within a date window.
- Off-list clustering (average linkage), recurring when ≥3 distinct visitors, topic never named.
- Monthly recap: only frozen catalog templates + digits, ≤5 lines, exact SPEC 4.6 rules, rw + FR/EN glosses +
  audio clip list (+ `missingAudio`). Test asserts on 1000 random months that every line is exactly a catalog
  template with digits in numeric slots and a frozen finding sentence in `{finding}`; the same check runs on
  `catalog/catalog.json` automatically once its Kinyarwanda is filled.
- SMS: GSM-7 check/length/transliteration, splitting into ≤160-char self-contained SMS (lines never split unless
  too long alone), optional "(i/N)" numbering.
- Keyword baseline: lists are data; reads the `eval/keywords/<lang>.json` format (`keywordListsFromFiles`);
  default matching = word start + any continuation (the eval lists are stems, e.g. "welcom", "röst"); "word" mode.
- `toStoredMessage` / `toReviewChunks` = exactly what SPEC 6 allows to persist; `aggregateCooperative` = numbers
  per finding over consenting farms only.

**How to run**: `pnpm vitest run packages/core`, `pnpm typecheck`. Sanity run with the real MiniLM and the current
catalog (756 examples) works end to end: e.g. "Die Röstung war wunderbar, aber der Weg zur Farm war viel zu lang"
→ P3 (+P11) and N1; "The path was not too long" → not sure (negation); a vague message → not sure.

**Deviations / decisions**
- Added config fields: `aggregation`, `topK`, `crossLingual`, `inaudibleConfidence`, `minAudioDynamicRangeDb`,
  `duplicateEmbeddingThreshold`, `duplicateWindowDays`; added types fields `ChunkResult.id/embedding`,
  `MessageAnalysis.coopFindings/notSureCount/offListCount/reason/messageEmbedding`, `ScrubResult.removed.handles`,
  optional catalog `templates[].audioParts`. `keywordClassify` takes keyword lists or a catalog (+ match mode).
- Negation: instead of "negated + matched → not sure" for everything, the negation-agreement rule keeps negative
  findings that are expressed with a negation ("no shade", "couldn't buy coffee"). The catalog must therefore never
  contain polarity-inverted phrasings in a finding's examples (written in the core README for the catalog agent).
- Duplicates are only duplicates within `duplicateWindowDays` (7) when both dates are known, so a common short
  sentence a month later is not dropped. Two visitors sending the identical sentence within a week count once.
- The recap throws `RecapError` while the catalog has no Kinyarwanda (never a fallback text).
- `not-implemented.ts` removed (no stub left).

**Remains**
- Threshold calibration (`acceptThreshold` 0.6 / `offListThreshold` 0.4 are provisional; with real MiniLM the
  off-list "cherry picking" sentences score 0.75–0.86 against P2/P3, so the eval must calibrate, possibly with
  `topk_mean`). `minAudioDynamicRangeDb` (3 dB) and `inaudibleConfidence` (0.2) to check on level-3 noisy audio.
- PII for German relies on cue phrases only (nouns are capitalised); spelled-out phone numbers not detected.

## 2026-10-04 — evaluation corpus, keywords, test audio, demo samples (eval-corpus agent)

**Built** (all SYNTHETIC, labelled as such in every README and manifest)
- `eval/data/feedback.jsonl`: 250 synthetic visitor feedbacks (en 62, fr 62, de 63, es 63), authored in
  `eval/data/src/fb_*.py`, validated and written by `python3 eval/data/build_feedback.py` (spans are exact
  substrings, composition checks). Per feedback: `expectedFindings`, `mustNotFindings`, `chunks` (span + kind
  `finding` | `not_sure` | `off_list` (+topic) | `negated` (+negates)), flags (negation cancels/inherent,
  multiFinding, typo, length, offList + topics, ambiguous, picking, mentionsGuide). Composition: 28 off-list (11 %,
  25 distinct non-picking topics, none ×3), exactly 3 coffee-cherry picking (en-026, fr-025, de-025), 17 ambiguous,
  23 cancelling negations, 46 inherent negations ("no shade" → N8), 46 multi-finding, 21 typos, 18 very short,
  8 long, every finding 8–21 times. Schema and semantics: `eval/data/README.md`.
- `eval/data/check_disjoint.py`: near-duplicate check feedback vs `catalog/catalog.json` examples. First run against
  the catalog's 756 examples found 11 near-duplicates; 9 feedbacks rewritten; now passes. Re-run when the catalog changes.
- `eval/keywords/{en,fr,de,es}.json` + README: keyword lists per finding for the no-AI baseline (stems, prefix
  match, no negation handling). Bias noted: same author as the feedback → favours the baseline.
- Real-review sources checked (Amazon reviews multi: defunct + non-commercial; Yelp: own non-redistributable
  agreement, English; SemEval-2016 ABSA: no explicit license, no German; Wikivoyage: not reviews) → none used,
  documented as a limitation in `eval/data/README.md`.
- Level 3: `tools/tts/` (Piper TTS 1.8.0, 13 voices en/fr/de/es, licenses verified in each MODEL_CARD: CC0, CC-BY,
  CC-BY-SA, Unlicense; NC/AGPL voices excluded). `synthesize_eval.py` → 80 feedbacks (20/lang, stratified, seeded,
  rotating voices, random speakers, length_scale 0.8–1.25). `tools/datasets/fetch_noise.py` → 48 ESC-50 outdoor
  clips (Freesound source CC0/CC-BY only; ESC-50 CC BY-NC 3.0, ESC-10 CC BY 3.0; per-clip author/license
  recorded); `mix_noise.py` → SNR 20/10/5 dB. Manifest `eval/data/audio_manifest.jsonl` (voice, speaker, speed,
  licenses, noise clips, paths). Audio git-ignored in `eval/data/generated/audio/`.
- `eval/data/demo-samples/`: the 10 SPEC 8 demo messages (de roasting+path, en prices+buy, fr welcome+meal,
  es visit too long, en negation, fr ambiguous, picking en/de/fr, 1.6 s inaudible noise), WAV 16 kHz, 1.6 MB,
  `manifest.json` with transcripts, voices, licenses and expected outcomes.
- `tools/tts/check_asr.mts`: intelligibility check with the shipped Whisper adapter.

**How to run**
```bash
python3 eval/data/build_feedback.py            # validate + rewrite feedback.jsonl
python3 eval/data/check_disjoint.py            # disjointness vs catalog examples
.venv/bin/pip install -r tools/tts/requirements.txt
bash tools/tts/make_eval_audio.sh              # all level-3 audio in one command (~5 min)
.venv/bin/python tools/tts/synthesize_demo.py  # demo samples (4 takes each, keeps lowest whisper-base WER)
cd eval && npx tsx ../tools/tts/check_asr.mts ../eval/data/audio_manifest.jsonl clean   # or 20 / 10 / 5
```
Measured (sanity, not the evaluation): whisper-base on the 80 clean clips WER 0.17 (en 0.12, fr 0.27, de 0.24,
es 0.24), language right on 79/80; demo takes WER 0–0.22, all languages right.

**Deviations / notes for other agents**
- `.gitignore` line `datasets/` also matches `tools/datasets/`: I force-added my three files there
  (`git add -f`). Suggest the owner changes it to `/datasets/`.
- Generated audio lives in `eval/data/generated/audio/` (already ignored), not `eval/audio/generated/`.
- Piper samples noise inside its ONNX graph (not seedable): selection/voices/speeds/noise are seeded, but a
  re-generated waveform differs slightly. Demo samples are *selected* takes (best of 4 by whisper-base WER), so
  they demonstrate, they do not measure; the level-3 audio is not selected.
- Very short feedbacks ("Thanks!", "Meh.") become < 3 s clips → inaudible by the SPEC 7 rule; the eval should
  report them separately at level 3. 18 level-2 feedbacks are ≤ 3 words.
- Unannotated text in a feedback (fillers) expects no finding; `negated` chunks accept off-list or not sure.
- The level-3 noise is ESC-50 (CC BY-NC for most classes): fine for evaluation, never ship it.
- Keyword lists also live in my `eval/keywords/`, the catalog's `keywords` field is the catalog agent's call.

**Remains**: nothing blocking for this task. Running levels 2/3 and the comparison is the evaluation agent's
(`pnpm eval`). No real human voices or real reviews (limitation documented).

## 2026-10-04 — catalog and Kinyarwanda (catalog agent, SPEC 5)

**Built**
- `catalog/catalog.json`: 21 findings with 9 synthetic example phrasings × en/fr/de/es (756, `examplesSynthetic: true`),
  keyword lists per finding and language (no-AI baseline), the Kinyarwanda sentence of each finding, 8 recap
  templates, spoken numbers 0–31. Authored sources: `tools/catalog/examples_positive.py`, `examples_negative.py`,
  `keywords.py`, `sources.py` (fr/en sources with simpler fallback candidates, number words).
- `tools/catalog/build_kinyarwanda.py` (stages content / translate / audio, `--only` to redo one sentence):
  NLLB-200 distilled 600M from both the en and fr source → kin_Latn; back-translation kin→fra and kin→eng;
  score = min of the two cosines with the app's own MiniLM ONNX q8 file (onnxruntime in Python, same pooling);
  numeric slots protected by guard numbers 17/13/14/15 (must survive exactly once, no stray digit) then restored;
  `{finding}` never translated (prefix templates); threshold 0.75, simplify-and-retry over authored candidates;
  every attempt in `catalog/translation-log.json`. Result: 29 sentences, all ≥ 0.75 (min 0.75, mean 0.87),
  9 needed a retry. Two templates (`fix`, `nothing_urgent`) failed after the first pass: simpler candidates added and
  re-run. Back-translation drifts a speaker should check are listed in `catalog/README.md`.
- 68 MMS-TTS kin clips in `catalog/audio/` (mp3 mono 16 kHz 24 kbit/s, 362 KiB, seed 1234): 21 findings, 15 fixed
  template parts (`templates[].audioParts`, the core contract: one entry per fixed part around the slots, null when
  empty), 32 numbers (`numbers["n"].audio`). `audio/manifest.json` lists each clip's text. Concatenation checked with
  ffmpeg (keep-line, 6.3 s). MMS-TTS kin licence verified on the model card: CC-BY-NC 4.0.
- FLORES-200 reference recorded in `catalog/README.md` and `provenance.kinyarwanda.floresReference`: eng→kin chrF++
  **44.0** for nllb-200-distilled-600M (its metrics.csv, linked from the model card); fra→kin is not published for this
  model (MoE 54.5B: 46.2, cited as such).
- `tools/catalog/validate_catalog.py` (JSON Schema + SPEC 5 rules + audio files), `test_catalog.py` (15 unit tests:
  slot guards, segment split, number words, validator negative cases), `check_examples.py` (nearest-neighbour
  distinctness: 98.0 % of examples closest to their own finding), `flores_check.py`, `requirements.txt`.

**How to run**: see `catalog/README.md` § Rebuild and validate. Quick checks:
`.venv/bin/python tools/catalog/validate_catalog.py && .venv/bin/python tools/catalog/test_catalog.py`.
`pnpm test` (118) and `pnpm typecheck` pass with the new catalog; `eval/data/check_disjoint.py` passes.

**Deviations / decisions**
- Template wording changed from the scaffold sources so the translation survives: `keep` = "What visitors like
  ({k} out of {n}): {finding}", `fix` = "The biggest problem ({k} out of {n}): {finding}", `fix_streak` adds
  "for {x} months" (instead of "{x}th month in a row", which NLLB turned into an ordinal word), `volume` = "This
  month: {n} messages from visitors", `nothing_urgent` = "No big problem this month.", `no_feedback` = "No message
  from visitors this month.", `not_understood` = "{p} messages were not understood: ask a person." `{finding}` is
  always at the end of the line, after a colon.
- Finding sentences are short descriptive sentences ("Visitors felt welcome."), not the labels, so the inserted
  phrase reads as a sentence in Kinyarwanda.
- Added fields (schema allows them): `similarityDetail`, `translatedFrom`, `chosenAttempt`, `backTranslationCheck`
  on each sentence; `templates[].audioParts`; `provenance.kinyarwanda.scoring/slotProtection/audioFormat`;
  `numbers[].source/status`. A future speaker validation sets `status: "speaker_validated"` + `validatedBy`.
- Numbers are hand-written counting forms (public references cited), not machine translated; no noun-class
  agreement; values > 31 have no clip (core reports `missingAudio`, digits still shown).
- Back-translation uses the same NLLB model, so errors can cancel out; the score is a filter, not a validation.

**Remains**
- Speaker validation of the 29 sentences and 68 clips: impossible here → `docs/MANUAL_TESTS.md` (procedure).
- Our own FLORES-200 devtest chrF++ measure (`tools/catalog/flores_check.py`) not run: the shared CPU was saturated
  by parallel jobs (25–230 s per sentence). Only published figures are reported.
- `tools/README.md` still lists `kinyarwanda/ (to write)`: the tool lives in `tools/catalog/` (README not mine to edit).

## 2026-10-04 — web app / PWA (`apps/web`, web-app agent; SPEC 12 P0 + P2, parts of P3/P4)

**Built** (Vite 8 + Preact + TypeScript, all analysis in a Web Worker with `@echo/core` + `@echo/models`)
- `scripts/prepare-assets.ts` (run by `dev`/`build`, output git-ignored in `public/`): hard-links the shipped models
  (`DEFAULT_ASR_MODEL` + the embedding model of `CALIBRATION`, quantized ONNX only; runs `models:download --only` if
  missing) into `public/models/`, the onnxruntime-web WASM runtime into `public/ort/`, the catalog + 68 clips, the 10 demo
  samples (`eval/data/demo-samples/`), the eval keyword lists; **precomputes the 756 catalog-example embeddings and the
  linear classifier in Node** with the same adapter and core code (`public/precomputed/examples-<hash>.bin`, 1.2 MB,
  keyed by catalog + model + classifier settings) and writes `assets-manifest.json` (file sizes, models, threshold source).
- Worker (`src/worker/analysis.worker.ts`): models from the app's own origin only (`allowRemoteModels = false`, WASM
  paths `/ort/`), one-time download into Cache Storage with a streamed progress bar, then Whisper + embedder; the
  precomputed example vectors are **checked on the device** (cosine of 4 re-embedded examples ≥ 0.99, measured 0.9937 in
  Chromium with the build of 01:45) or recomputed there; the precompute cache key includes the embedder/matcher/classifier source and the whole config; refuses assets prepared for another embedding model than the calibrated one.
  `analyzeAudioMessage` with a wrapped transcriber that tells the UI the moment transcription ends, so the queued audio
  Blob is deleted from IndexedDB right then (buffer zero-filled by core). Language detection and token log-prob
  confidence come from `@echo/models` (no-speech probability is not exposed by transformers.js: not used).
- Thresholds: `DEFAULT_CONFIG` from `packages/core/src/calibration.ts` (generated by `pnpm eval -- --level 2` from
  `eval/results/`); the model box shows the threshold and its source. No separate default was needed.
- Host app (`#/host`, modes A and B): Web Share Target (manifest `share_target`, POST `/share-target` handled in the
  service worker → IndexedDB `queue`), file import, paste text, queue, "Analyse N messages offline", IndexedDB stores of
  ARCHITECTURE §7 with only `toStoredMessage`/`toReviewChunks` rows (`src/lib/db.ts`), monthly recap (core
  `buildMonthlyRecap` + off-list clustering per month), Kinyarwanda only by default (toggle for the frozen FR/EN sources),
  "Listen" = catalog clips decoded and concatenated in one buffer, "Send SMS i/N" = `sms:` URI per GSM-7 part of ≤160 chars
  (`splitSms`, numbered) to the configured host number (a person presses Send), "To be read by a person" list (scrubbed
  text + Whisper English translation labelled "machine translation, to be checked", recurring unknown topic grouped and
  never named), "what is stored" table (no text).
- Settings (`#/settings`): farm name, farm WhatsApp number, host phone, mode A/B, optional PIN (PBKDF2-SHA256 150k,
  salted, only the hash stored; locks host, settings and coop views), cooperative consent toggle (off by default),
  persistent-storage request, delete all messages.
- Cooperative view (`#/coop`): `aggregateCooperative` over 11 **synthetic** farms (deterministic generator, labelled) +
  this farm only if consent is on; only `coopFindings` (guide chunks excluded), "k farms out of N".
- Visitor card (`#/card`): printable en/fr/de/es text of SPEC 4.1 with explicit consent sentence, farm number from settings.
- "Try it" demo (`#/`, default): no account, Online/Offline badge, model box (sizes: Whisper base 80 MB + MiniLM 135 MB +
  runtime 27 MB = 242 MB once, "everything runs on this device"), 10 one-click samples labelled "synthetic voices", "Run all",
  record 30 s max (MediaRecorder), typed text; per message: transcript, language, transcription confidence, on-device time,
  chunks with findings + confidence, not-sure in orange with "ask a person", off-list apart, guide flag, keyword-baseline
  comparison side by side; recap in Kinyarwanda with FR/EN glosses side by side, Listen, SMS parts; 3 synthetic months
  (hand-written finding lists, labelled synthetic, not passed through the models) + live month: trends table and the
  recap of any month (streak "for x months" shows); "To be read by a person" list.
- Service worker (vite-plugin-pwa injectManifest, `src/sw.ts`): precaches app shell, catalog, clips, samples, keywords,
  precomputed vectors and the ORT runtime (102 entries, 30 MB); serves `/models/**` cache-first from the model cache; share target.
  COOP/COEP headers in dev/preview → 4 WASM threads when cross-origin isolated (single thread otherwise).
- Tests: `src/lib/{pin,db,recap-service}.test.ts` (8 tests, fake-indexeddb, real catalog). E2E: `scripts/e2e.ts`.

**How to run / test**
```bash
pnpm models:download                     # once
pnpm build                               # = prepare-assets + vite build (apps/web/dist, ~260 MB with models)
pnpm --filter @echo/web preview          # http://localhost:4173 (COOP/COEP headers set)
pnpm --filter @echo/web e2e              # builds nothing: serves dist/, real models in headless Chromium
pnpm --filter @echo/web icons            # re-render the PWA icons from public/icons/icon.svg
```
E2E result here (headless Chromium 153, WSL2, 8 shared CPUs busy with the evaluation; final run with the
`calibration.ts` on disk at 02:00, MiniLM + linear p ≥ 0.84): **PASSED, 27 checks**. First load (242 MB from localhost +
load) 38 s; the 10 samples end to end through the real models 129 s (≈ 8 s Whisper per 6 s clip incl. English
translation); language right on all 9 speech samples; inaudible → inaudible (not transcribed); negation sample counts
nothing (the keyword baseline wrongly gives N3); FR welcome+meal → P1+P4, EN prices+buy → N2+P9, ES → N3, DE
roasting+path → P3 only (Whisper base misheard the path clause, which fell to not sure); picking ×3 → "unknown topic
comes back from 3 visitors". **The ambiguous FR sample ends off-list, not "not sure"** as SPEC 8 expects: it is still never
counted and is listed in "To be read by a person", but the not-sure/off-list split is decided by the calibrated floor in
core (eval agent's call); with the earlier calibration it was "not sure". Host flow: text + imported wav queued,
analysed, queue emptied, IndexedDB has no name, no phone number, no full text; SMS link `sms:+250…?body=<rw>`.
Then `context.setOffline(true)` + reload: app served by the service worker, "Offline" badge, models loaded from the
device cache in 9 s, voice and text analysis and recap work. Screenshots: `docs/screenshots/01…13*.png`; JSON report:
`apps/web/test-results/e2e-report.json` (git-ignored).

**Deviations / decisions**
- Models are not in the service-worker precache manifest (would block SW install on 215 MB): the worker downloads them
  once with a progress bar into Cache Storage (`transformers-cache`, which transformers.js also reads) and the SW serves
  them cache-first. Auto-download on first load unless the browser asks to save data (then a button).
- Synthetic history = hand-written finding lists (no text), not model output; labelled. Demo session data lives in memory only.
- Received date of a shared/imported message = import time (WhatsApp does not pass the send date).
- Unknown-topic clustering in the host recap uses the chunks of the recap's month only.
- Glosses in the host app are hidden by default (toggle "for a helper"); always shown in the demo.
- `pnpm-lock.yaml` updated (playwright, tsx, workbox-precaching, workbox-routing in apps/web).
- Playwright's Chromium needs `--disable-gpu` under WSL2 for screenshots.

**Remains**: everything needing real hardware → `docs/MANUAL_TESTS.md` § "Web app on a real Android phone" (install,
airplane mode on a low-end phone, WhatsApp share target, real SMS to a basic phone, 30 s timing). Not done: Capacitor
APK (not needed: `sms:` keeps a human pressing Send, see ARCHITECTURE §1); swahili UI; a smaller Whisper option in
settings (only the evaluated default model is shipped).
