# Blind keyword baseline

A second set of keyword lists for the no-AI comparison method (SPEC 9), written to remove a bias of the first set.

## Why

The first lists (`eval/keywords/`) were written by the same author (an agent) who wrote the synthetic test corpus
(`eval/data/`). They can repeat the corpus wording, which makes keyword matching look better than it would on visitors it
has never seen. This set was written so that it cannot repeat the corpus wording.

## Protocol (exactly what was done)

Written on 2026-10-04 by a separate agent session, in about the time a person would spend on it (an hour, single pass, no
iterations).

- **Not opened, grepped, listed or printed**: anything under `eval/data/` (the corpus and audio manifest),
  `eval/results/` (including `RESULTS.md`, `level2.json`, per-message outputs) or `eval/keywords/` (the first lists).
  No evaluation was run with these lists before they were committed, so they were not tuned on any score, on the
  calibration half or the test half.
- **Read**: `catalog/catalog.json`, for the finding ids, labels (fr/en), polarities and the English example phrasings
  of the catalog. A real keyword designer would have the catalog; the catalog examples are disjoint from the corpus.
  The catalog also has a `keywords` field; it was not used (its P1 entry was visible once on screen while the
  structure of the file was printed, nothing else).
- **Read**: the matching code (`packages/core/src/baseline.ts`, `text.ts`), for the file format and matching rules.
  The file format comes from the `KeywordFile` type, not from the first lists.
- **Own knowledge** of how visitors write in English, French, German and Spanish.

Design choices a competent person would make, knowing the matching rules (prefix match at a word start, accents and case
ignored, no negation, no threshold):

- Short stems where a word family is unambiguous (`explain`, `torréfi`, `röst`, `degust`).
- Phrases instead of bare words when the bare word would fire on everything: `too far` rather than `far` (would match
  *farm*), `the sun` rather than `sun` in English, `el sol` rather than `sol` in Spanish (*solo*), `der weg` rather
  than `weg` in German (*weg* = away), `echte` rather than `echt` (intensifier), `la espera` rather than `espera`
  (*esperamos volver* = we hope to come back).
- General satisfaction (P11) uses thanks plus phrases such as *great day*, not bare *great*, which would fire on every
  positive remark.
- Overlaps that cannot be avoided without negation handling are left in, as a naive method would (for example *buy* in
  P9 and *couldn't buy* in N10, *lunch* in P4 and *no lunch* in N6).
- Nothing was written to make the baseline fail. Phrasings that visitors are likely to use were included even when
  they make keyword matching look good.

## Format

One file per language, `<lang>.json`: `{ "lang": "en", "findings": { "P1": ["welcom", ...], ... } }`, all 21
findings in each of en, fr, de, es (`KeywordFile` in `packages/core/src/baseline.ts`).

## Use

`pnpm eval -- --level 2` always reports both sets (`keywordSets.original` and `keywordSets.blind` in
`eval/results/level2.json`, both rows in `RESULTS.md`). The *primary* set (the `keywords` field, level 3, the headline
column) is this blind set by default since 2026-10-04 (eval-and-readme); `pnpm eval -- --keywords original` (or
`ECHO_KEYWORDS=original`) switches back to the first lists. Results on the held-out half: `eval/results/RESULTS.md`.
Code: `eval/src/lib/keyword-sets.ts`.
