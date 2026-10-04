# Where remarks are lost — calibration half only (echo-recall, 2026-10-04)

Script: `eval/src/experiments/diagnose.ts` (`cd eval && npx tsx src/experiments/diagnose.ts`). It runs the shipped path
(`analyzeMessage` + `decideChunk` of `@echo/core`, MiniLM) on the **calibration half** of the SYNTHETIC level-2 corpus
(125 feedbacks, 130 annotated remarks; split of `eval/src/lib/corpus.ts`, seed 20261004). The held-out half was not
loaded. For each remark (annotated `finding` passage) the first matching cause is kept:

1. captured — an aligned chunk counts exactly that finding;
2. whole message not sure (language detection failed → `unsupported_language`);
3. no aligned chunk;
4. otherwise, on the aligned chunk: wrong finding counted (and whether the right one was 2nd / the two-finding cap);
   below the off-list floor (cosine) → off list; uncertain negation; negation-agreement rule (chunk negated or plain
   whose closest examples of the right finding have the opposite negation); below the probability threshold (with the
   rank of the right finding in the classifier).
   A chunk is "merged" when it also overlaps another annotated passage (clause splitting too coarse).

## Before: configuration shipped at the start of the task

`linear-minilm-l2=0.00003-neg0`, probability ≥ 0.84, off-list floor 0.59, 756 catalog examples.
Calibration: **capture 46.2 %**, error among accepted 4.5 %, not-sure rate 42.6 % of chunks, 67 accepted answers.

| Cause | Remarks | Share | of which in a merged chunk |
|---|---:|---:|---:|
| captured | 60 | 46.2 % | 0 |
| not sure, below threshold, right finding is top-1 with p ≥ 0.5 | 16 | 12.3 % | 1 |
| not sure, below threshold, right finding not top-1 | 14 | 10.8 % | 1 |
| not sure, negation rule, chunk negated | 10 | 7.7 % | 0 |
| off list (below floor 0.59), right finding top-1 | 7 | 5.4 % | 0 |
| off list (below floor), right finding not top-1 | 6 | 4.6 % | 2 |
| not sure, negation rule, chunk not negated | 5 | 3.8 % | 0 |
| whole message not sure: language not recognised | 4 | 3.1 % | 0 |
| not sure, below threshold, right finding top-1 with p < 0.5 | 4 | 3.1 % | 0 |
| wrong finding (right one 2nd) | 2 | 1.5 % | 1 |
| not sure, uncertain negation | 2 | 1.5 % | 0 |
| two-finding cap | 0 | 0 % | – |

Reading:
- **Threshold** (16 remarks top-1 above 0.5 but under 0.84): the largest single cause, but lowering the threshold also
  accepts wrong answers; the sweep shows +6 points at most within an 8 % error bound.
- **Catalog coverage / model** (14 + 6 remarks where the classifier prefers another finding; P1 vs P3/P7/P11, N3 vs N4,
  N8 vs P3): more varied examples or a better embedder.
- **Negation rule** (15): the right finding wins the classifier (often p > 0.9) but its examples with the opposite
  negation status are closer. This is the guardrail working conservatively; it is not relaxed. Part of it is fixable
  by examples (negated phrasings of negative findings whose natural wording is negative, plain phrasings of findings
  whose examples were mostly negated) and by idioms that are not negations ("sans hésiter", "without hesitation").
- **Language detection** (4 remarks, 9 messages): very short messages ("Génial.", "Superb.") have no function word;
  one Spanish message was taken for English (tie on "a"). The guardrail (unknown language → whole message not sure)
  is kept: it also protects against Kinyarwanda / Swahili written messages.
- **Clause splitting** (5 remarks in a merged chunk): small. The only merged cases are two clauses joined by a bare
  comma. Causal connectors ("because", "parce que", "weil", "porque") do not occur in the calibration half.
- **Two-finding cap**: never binding.

Per language (before): de 12/29 captured, en 14/33, es 15/34, fr 19/34; English loses 8 remarks below the floor.
Per finding (before), weakest: N5 0/3, N4 1/8, N3 1/6, N6 1/5, N10 1/5, N2 3/9.

## After: configuration chosen by this task

`linear-minilm-l2=0.00003-neg0`, probability ≥ 0.82, floor 0.62 (Youden), 1,260 catalog examples, wider
language-detection word lists, non-negating idioms. Calibration: **capture 53.8 %**, error among accepted **3.9 %**,
not-sure rate 36.4 %, 77 accepted answers, cancelling negations 16/16.

| Cause | Before | After |
|---|---:|---:|
| captured | 60 | **70** |
| not sure, below threshold, right finding top-1 p ≥ 0.5 | 16 | 10 |
| not sure, below threshold, right finding not top-1 | 14 | 14 |
| not sure, below threshold, top-1 p < 0.5 | 4 | 4 |
| not sure, negation rule (chunk negated / not negated) | 10 / 5 | 8 / 4 |
| off list, right finding top-1 / not top-1 | 7 / 6 | 9 / 5 |
| language not recognised | 4 | 3 |
| uncertain negation | 2 | 2 |
| wrong finding | 2 | 1 |

Per finding (after): N4 1/8 → 4/8, N9 4/6 → 5/6, N10 1/5 → 2/5, N3 1/6 → 2/6, N1 2/4 → 3/4, P3/P4/P5/P10 +1 each,
N8 2/5 → 1/5; N5 still 0/3. Per language: de 14/29, en 16/33, es 18/34, fr 22/34 captured.

What is left: the threshold / classifier ranking (28 remarks), the negation guardrail (12, kept on purpose), the
off-list floor (14; 9 of them English short sentences: the Youden floor rose from 0.59 to 0.62 with the larger
catalog) and very short messages without any function word (3).
