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
