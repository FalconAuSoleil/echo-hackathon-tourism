# Recall experiments — calibration half only (echo-recall, 2026-10-04)

Goal: raise the share of remarks correctly captured by Echo while keeping the error among accepted answers ≤ 10 %
(target ≤ 8 %), without weakening the "not sure" and negation guardrails. Everything below is measured on the
**calibration half** of the SYNTHETIC level-2 corpus (125 feedbacks, 130 remarks, `splitCorpus` of
`eval/src/lib/corpus.ts`). The held-out half was **not** evaluated by this task: its numbers in `RESULTS.md`
(48 % captured, 6 % wrong) still describe the previous configuration until `pnpm eval -- --level 2` is re-run.

Scripts (all in `eval/src/experiments/`, run with `cd eval && npx tsx src/experiments/<name>.ts`):
`diagnose.ts` (loss breakdown → `diagnosis.md`), `quick-thresholds.ts` (L2 × floor × threshold), `threshold-strategies.ts`
(margin, agreement, per-language thresholds), `measure.ts` (current code, one line per setting, appended to
`runs.jsonl`), `embedder-cost.ts` (size, memory, speed of an embedder → `embedder-cost.jsonl`), `select.ts` (the
calibration part of `level2.ts`, same functions, → `selection.json`, `select.log`, `--write` writes
`packages/core/src/calibration.ts`).

Columns: capture = remarks correctly captured; err = error among accepted answers; cov = share of chunks counted
(coverage); not-sure = share of chunks flagged "not sure"; neg = cancelling negations correctly not counted (16
passages). "best ≤ 8 %" = threshold with the highest capture such that err ≤ 8 %, ≥ 20 accepted answers and neg ≥ 85 %
(exploration runs; the final selection requires neg = 100 %). Off-list floor 0.59 (the previous calibrated value) in
the exploration runs. One remark = 0.77 point: differences of 1–2 points are noise.

## 0. Starting point (previous shipped configuration)

`linear-minilm-l2=0.00003-neg0`, probability ≥ 0.84, floor 0.59, 756 examples:
**capture 46.2 %, err 4.5 %, cov 32.1 %, not-sure 42.6 %, neg 100 %** (67 accepted answers). Held-out (RESULTS.md):
48.0 % captured, 6.0 % wrong, 43.8 % not sure.

## 1. Threshold strategy (no code change)

| Setting (MiniLM, 756 examples) | best ≤ 5 % | best ≤ 8 % | best ≤ 10 % |
|---|---|---|---|
| l2 3e-5, floor 0.59 (shipped) | t 0.84: 46.2 % / 4.5 % | t 0.77: 52.3 % / 6.5 %, not-sure 37.8 % | same |
| l2 1e-4, floor 0.59 | t 0.77: 44.6 % / 4.6 % | t 0.66: 51.5 % / 5.3 % | t 0.60: 53.1 % / 9.8 % |
| l2 1e-3 … 1e-5, floors 0 … 0.59 (35 settings, `quick-thresholds.ts`) | ≤ 46.9 % | ≤ 54.6 % (l2 1e-4, floor 0.5–0.55) | ≤ 55.4 % |
| Margin rule: also accept top-1 ≥ low when top-1 − top-2 ≥ m (low 0.4–0.6, m 0.3–0.5) | none | ≤ 51.5 % / 6.6–7.8 % | – |
| Agreement rule: lower threshold to `low` when the closest example names the same finding (low 0.3–0.6) | none | ≤ 52.3 % / 7.6 % | – |
| Per-language thresholds, 2-fold CV inside the calibration half (5 repeats) | – | 45.5 % / 7.6 % (global threshold in the same CV: 49.2 % / 7.9 %) | – |

Decision: a single probability threshold; margin, agreement and per-language thresholds are **rejected** (no gain, or
worse out of fold). Per-finding thresholds were not tried: 3–11 remarks per finding cannot calibrate 21 thresholds.
Raising the error budget from 5 % to 8 % alone is worth about +6 points.

## 2. Catalog example coverage (`catalog/catalog.json`, 756 → 1,260 examples)

6 new synthetic phrasings per finding and per language (504), written from the finding definitions
(`tools/catalog/examples_extra.py`, merged by `build_kinyarwanda.py --stages content`), short fragments and long
sentences. Positive findings get no example with a negation cue; negative findings whose natural wording is negative
(no shade, not enough food, could not buy, nobody told us the price, did not have enough time, could not understand)
get some negated phrasings. Two negated examples were replaced by plain ones after review because they could absorb a
cancelling negation: N7 "the toilets weren't clean" (a "the toilets were not dirty" would match) and N9 "les horaires
n'ont pas été tenus". `check_disjoint.py`: 4 accidental near-duplicates with the corpus on the first pass (common short
phrases), all 4 rewritten, then OK. `validate_catalog.py`: OK (limit raised from 8–10 to 8–16 examples per language).
`check_examples.py` (distinctness with MiniLM): 98.7 % of examples have their nearest neighbour in the same finding
(was 98.0 %). Kinyarwanda sentences, templates, numbers, ui labels and audio: byte-identical (checked).

| | best ≤ 5 % | best ≤ 8 % |
|---|---|---|
| l2 3e-5, floor 0.59, 756 examples | 46.2 % / 4.5 % / cov 32.1 % / not-sure 42.6 % | 52.3 % / 6.5 % / cov 36.8 % / not-sure 37.8 % |
| l2 3e-5, floor 0.59, 1,260 examples | 49.2 % / 4.3 % / cov 33.5 % / not-sure 45.0 % | 56.1 % / 7.2 % / cov 39.7 % / not-sure 38.8 % (neg 94 %) |
| l2 1e-4, floor 0.59, 1,260 examples | 48.5 % / 4.3 % | 53.1 % / 7.6 % (neg 94 %) |

Kept. (+3 to +4 points.) At the lower thresholds one cancelling negation ("Wir haben kein bisschen gewartet" → N9,
agree 0.596 vs inverted 0.590 with the original N9 examples) slips through: see 5.

## 3. Negation idioms (`packages/core/src/negation.ts`)

"sans hésiter", "sans hésitation", "without hesitation", "without a second thought", "ohne zu zögern", "sin dudarlo",
"sin pensarlo"… added to the existing list of phrases whose cue does not invert the meaning ("not only", "sans doute").
Real negations in the same chunk are still detected (tests).

| l2 3e-5, floor 0.59 | best ≤ 5 % | best ≤ 8 % |
|---|---|---|
| before | 49.2 % / 4.3 % | 56.1 % / 7.2 % |
| after | 50.0 % / 4.2 % / cov 34.0 % / not-sure 44.5 % | 56.9 % / 7.1 % / cov 40.2 % / not-sure 38.3 % |

Kept (+1 remark).

Note added by the verification pass (2026-10-04): the only calibration-half trigger was fr-031 "sans hésiter"; the
other phrases were written as translations of it. Checked afterwards against the whole corpus: "sin dudar" occurs only
in held-out feedback es-026 ("lo recomendamos sin dudar"); "sans hésiter" only in fr-031 (calibration); "without
hesitation", "ohne zu zögern", "sin dudarlo" and "sin pensarlo" in no feedback. So one entry of the list matches
held-out text only. Nothing in this log shows it was chosen by looking at es-026, but it can only affect that one held-out message; it is
left in place (removing it now would itself be a change decided on held-out text) and this is stated here.

## 4. Language detection of written messages (`packages/core/src/language.ts`)

~30 frequent function words per language (never a word shared by two of the four languages, no content word taken
from the corpus) and á/í/ó/ú as a Spanish hint. Calibration messages whose language is not recognised: 9 → 7 (the
remaining 7 are one- or two-word messages such as "Génial.", "Meh."; they stay "not sure", the guardrail that also
protects against Kinyarwanda / Swahili text). No calibration message that was right before became wrong.

| l2 3e-5, floor 0.59 | best ≤ 5 % | best ≤ 8 % |
|---|---|---|
| before | 50.0 % / 4.2 % | 56.9 % / 7.1 % |
| after | 50.8 % / 4.2 % / cov 34.4 % / not-sure 44.0 % | 57.7 % / 7.1 % / cov 40.7 % / not-sure 37.8 % |

Kept (+1 remark).

## 5. Stricter negation agreement (negative `negationMargin`)

A chunk is accepted for a finding only if the examples with its negation status beat the opposite ones by at least
|margin| (0 = previous strict rule; positive margins, which relax the rule, stay never selectable).

| | l2 1e-4 best ≤ 8 % | l2 3e-5 best ≤ 8 % |
|---|---|---|
| margin 0 | 54.6 % / 7.4 % (neg 94 %) | 57.7 % / 7.1 % (neg 94 %) |
| margin −0.02 | 55.4 % / 7.2 % (neg 100 %) | 56.1 % / 6.1 % (neg 100 %) |
| margin −0.05 | 56.1 % / 7.1 % (neg 100 %) | 55.4 % / 5.0 % (neg 100 %) |

Added to the selectable variants (it can only make the guardrail stricter).

## 6. Clause splitting (`packages/core/src/segment.ts`, options in `AnalysisConfig`)

| Setting (l2 3e-5, floor 0.59) | chunks | best ≤ 5 % | best ≤ 8 % |
|---|---:|---|---|
| current splitting | 209 | 50.8 % / 4.2 % | 57.7 % / 7.1 % |
| + causal connectors (because / parce que / weil / porque …) | 209 | identical (none in the calibration half) | identical |
| + bare comma when both sides ≥ 3 words | 275 | 26.9 % / 5.0 % | 43.1 % / 6.2 % |
| + bare comma when both sides ≥ 4 words | 258 | 27.7 % / 4.9 % | 43.9 % / 6.2 % |

Rejected: comma splitting cuts sentences into fragments that the classifier is less sure about (not-sure rate 38 → 54 %);
causal splitting has no evidence either way. Both stay in the code as options, **off** (`clauseCommaMinWords: 0`,
`clauseCausalSplit: false`), so the keyword baseline and the app keep the same chunks as before.

## 7. Alternative embedder: `Xenova/paraphrase-multilingual-mpnet-base-v2` (q8)

| Model (q8 ONNX) | Files | Peak memory, onnxruntime-web WASM, 1 thread, model alone | Peak, onnxruntime-node | Speed WASM 1 thread (32 tokens) | Speed node 1 thread / sentence |
|---|---:|---:|---:|---:|---:|
| MiniLM-L12 (shipped) | 135 MB | **643 MB** | 622 MB | 21 ms | 5.8 ms |
| mpnet-base | 296 MB | **1,397 MB** | 835 MB | 70 ms | 16.2 ms |

(`embedder-cost.ts`; peak = VmHWM of a process that only loads that model, includes the model file buffer as the
browser does; graph optimisation level "disabled" or "basic" does not lower it.) Accuracy on the calibration half,
1,260 examples:

| | best ≤ 5 % | best ≤ 8 % |
|---|---|---|
| mpnet, floor 0.59 (l2 3e-4 / 1e-4 / 3e-5) | 61.5 / 60.8 / 60.8 % at 4.5–4.6 % | 67.7 / 69.2 / 66.9 % at 7.8–8.0 %, not-sure 33–34 % |
| mpnet, Youden floor 0.69 (selection procedure) | 54.6–55.4 % at 4.9–5.0 % | 55.4–56.9 % at 7.1–7.2 % |
| MiniLM, floor 0.59 | 50.8 % at 4.2 % | 57.7 % at 7.1 % |

mpnet is clearly better (+10 points at the same error with a 0.59 floor), but it needs about 1.4 GB in the browser
for the embedding model alone, more than twice MiniLM, plus 160 MB more to download. On a 2 GB phone (one model at a
time) that does not fit next to Android and Chrome. **Not shipped**; its variants are measured by `level2.ts` and
marked not selectable (skipped when the model is not downloaded; `tools/scripts/download-models.mjs` was not changed:
`models/Xenova/paraphrase-multilingual-mpnet-base-v2` was fetched by hand for this experiment). Worth offering on
phones with ≥ 3 GB after a real-phone measurement. Note: with mpnet the Youden off-list floor (0.69) costs 12 points.

## 8. Final selection (`select.ts`, same functions as `level2.ts`)

Rule, written into `level2.ts` so that `pnpm eval -- --level 2` reproduces it:
1. off-list floor = Youden index on the calibration half (unchanged procedure);
2. per variant, threshold = highest calibration capture with err ≤ **8 %** (was 5 %), ≥ 20 accepted answers and
   cancelling negations **100 %** (was 85 %: lowering the threshold must not let any calibration cancelling negation
   through, so the negation guardrail does not get weaker);
3. among selectable variants (MiniLM / e5 linear with margin ≤ 0, similarity variants), those within **2 capture
   points** of the best (≈ 2–3 remarks, below the resolution of the measure), the one with the **lowest error**.
   Rule 3 and the 100 % negation constraint were added after looking at calibration numbers (never at test numbers):
   without them the pick was `l2=1e-4, margin −0.02`, t 0.62 (55.4 % / 7.2 %), or with margin 0, l2 3e-5, t 0.77
   (56.1 % / 7.1 % but one cancelling negation counted). Rule 3 trades 1.6 capture points for 3.3 points less error.

Result (`selection.json`, `select.log`): **`linear-minilm-l2=0.00003-neg0`, probability ≥ 0.82, off-list floor 0.62,
unknown-topic cluster threshold 0.57** (catalog-only rule, unchanged), written to `packages/core/src/calibration.ts`.

| Calibration half | capture | err (accepted) | coverage | not-sure (chunks) | cancelling negations | accepted answers |
|---|---:|---:|---:|---:|---:|---:|
| previous configuration (756 examples, t 0.84, floor 0.59) | 46.2 % | 4.5 % | 32.1 % | 42.6 % | 16/16 | 67 |
| **new configuration** (1,260 examples, t 0.82, floor 0.62) | **53.8 %** | **3.9 %** | 36.8 % | 36.4 % | 16/16 | 77 |
| same code, best point ≤ 8 % without rule 3 (l2 1e-4, margin −0.02, t 0.62) | 55.4 % | 7.2 % | 39.7 % | 33.5 % | 16/16 | 83 |
| not shippable: mpnet, floor 0.59, l2 1e-4, t 0.61 | 69.2 % | 7.8 % | 49.3 % | 33.0 % | 16/16 | 103 |

The shipped path (`analyzeMessage` with `DEFAULT_CONFIG`) gives exactly 53.8 % / 3.9 % on the calibration half
(`diagnose.ts`). Most of the gain (+7.6 points) comes from the catalog, the negation idioms and language detection, at a
lower error than before; the larger error budget is barely used by the chosen point.

**To do (not done by this task, on purpose): run the held-out evaluation once** (`pnpm eval -- --level 2 --level 3
--level report`) and update the README problem sentence from its output. Expect wide intervals (125 feedbacks).
