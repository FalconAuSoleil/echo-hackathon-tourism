# Keyword lists for the no-AI baseline (SPEC 9, "La comparaison sans IA")

**Synthetic / hand-written.** One file per visitor language (`en.json`, `fr.json`, `de.json`, `es.json`), each
mapping the 21 finding ids (P1–P11, N1–N10) to a list of keywords or short phrases.

They were written the way a competent person would in about an hour, without tuning against results: obvious
words and stems for each finding, a few common phrasings. They are **not** sabotaged. They are also not
optimised: no weighting, no negation handling, no disambiguation (e.g. "long" or "price" alone are allowed and
will over-fire). That is the honest point of comparison for "would a spreadsheet / keyword search do the same?".

Known bias, in the baseline's **favour**: the same author wrote these lists and the evaluation feedback
(`eval/data/feedback.jsonl`), on the same day, so vocabulary overlap is likely higher than with real visitors.
The Echo-vs-keywords gap measured on this data is therefore conservative.

## Matching rule (to implement identically in `keywordClassify` or the evaluation)
- Lower-case and fold accents on both the text and the keyword (`é → e`, `ü → u`, `ß` kept as `ss`).
- A keyword matches when it occurs in the text **at the start of a word** (prefix match): `welcom` matches
  "welcome" and "welcoming", `röst` matches "Rösten" and "geröstet" only at a word start. Multi-word keywords
  match as a phrase.
- Every finding with at least one matching keyword is predicted (no limit, no threshold).
- No negation handling (by design: that is one of the things the AI pipeline has to do better).

Sanity figure (not a result; the real numbers come from `pnpm eval` on chunks): applying this rule to whole
messages of the level-2 set gives message-level P≈0.70, R≈0.89 (2026-10-03, with the authoring bias above).
