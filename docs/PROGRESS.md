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
