# catalog/ — closed list of findings and frozen Kinyarwanda recap sentences

Everything the host ever reads or hears comes from this folder (SPEC 3, 4.6, 5). Nothing here is translated or
generated at runtime: the Kinyarwanda was produced **once**, offline, by `tools/catalog/build_kinyarwanda.py`.

> **All Kinyarwanda in this folder is machine translation, not validated by a Kinyarwanda speaker.**
> Every sentence carries `"status": "machine_translated_unvalidated"`. All example phrasings are **synthetic**
> (written for this project, no real visitor), flagged `examplesSynthetic: true` and `provenance.examples: "synthetic"`.

| File | Content |
|---|---|
| `catalog.json` | 21 findings (P1–P11, N1–N10): fr/en labels, polarity, 9 synthetic example phrasings × 4 visitor languages (756 in total), keyword lists for the no-AI baseline, the Kinyarwanda sentence of each finding; 8 recap templates; spoken numbers 0–31. Schema: `catalog.schema.json`; TS mirror and validator: `packages/core/src/catalog.ts`. |
| `audio/*.mp3` | 67 pre-generated clips (MMS-TTS kin, mono 16 kHz 24 kbit/s, ~360 KiB in total): 21 finding sentences, 14 fixed parts of templates, 32 numbers. `audio/manifest.json` lists text, spoken text and duration of each clip. |
| `translation-log.json` | Every translation attempt: source (fr, en), raw NLLB output, back-translations, similarity scores, slot check, which attempt was kept. |
| `flores-check.json` | (not produced yet) our own chrF++ measure of the same NLLB model on FLORES-200 devtest, written by `tools/catalog/flores_check.py`. |

## Findings and examples

Example phrasings are written to be natural visitor speech, short and long, with casual lowercase
fragments ("great welcome!!", "toilets??") as well as long sentences. They are kept clearly distinct between findings:
N1 is the **way to the farm** (road, steep climb, hard to find), N3 the **visit lasting too long**, N4 the visit
**too short / rushed**, N8 **thirst, sun, no break** during the visit, N9 **waiting / late start**, N2 **prices
unclear or told late** (not "too expensive"), N6 **meal missing or too small** vs P4 meal enjoyed, N10 **could not
buy** vs P9 **wants to buy**. They are strictly separate from the evaluation set (`eval/data/feedback.jsonl`; `eval/data/check_disjoint.py`
passes). Distinctness check with the app's MiniLM (`tools/catalog/check_examples.py`): for 98.0 % of the 756
examples the nearest other example belongs to the same finding; the 15 exceptions are mostly two-word fragments
("tolle verkostung" ~ "tolle aussicht", "Die Führung war zu kurz." ~ "… zu lang." at 0.74), which is why core
needs its negation and margin rules and the evaluation calibrates the threshold. Negative findings may be phrased
with a negation ("there was no shade"); no example is a polarity-inverted phrasing of its finding (core rule).
The authored source of truth is `tools/catalog/examples_positive.py`, `examples_negative.py` and `keywords.py`;
`build_kinyarwanda.py --stages content` copies them into `catalog.json`.

## How the Kinyarwanda was produced (SPEC 5)

1. **Sources written by hand**, fr and en, short and simple (`tools/catalog/sources.py`). Each finding sentence is
   descriptive ("Visitors felt welcome.", "The path is too long."): Echo never tells the host what to do.
   Each sentence has a list of candidates from the most natural to the simplest.
2. **Translation** with NLLB-200 (`facebook/nllb-200-distilled-600M`, `kin_Latn`, beam 4, deterministic), from
   **both** the English and the French source; the better of the two is kept (`translatedFrom`).
3. **Back-translation** of the Kinyarwanda to French **and** to English with the same model, and meaning
   similarity with the **same sentence-similarity model the app uses** (`Xenova/paraphrase-multilingual-MiniLM-L12-v2`,
   the very same `onnx/model_quantized.onnx` file, mean pooling + L2 norm, run with onnxruntime in Python).
   Score = `min(cos(source_fr, back_fr), cos(source_en, back_en))`. Using both directions catches false friends
   that one language hides (e.g. French "retours" → `kugaruka` → back to "retours", but in English "returning").
4. **Simplify and retry**: if the score is below **0.75**, the next, simpler candidate is translated. 10 of the 29
   sentences needed a retry (P8, N3, N4, N7, N8, keep, fix, nothing_urgent, not_understood, no_feedback); all are logged in
   `translation-log.json`. After a first full pass two templates (`fix`, `nothing_urgent`) were still under the
   threshold: simpler candidates were added to `sources.py` and those sentences re-run (`--only`). Final scores:
   min 0.75, mean 0.88; every sentence passes (`backTranslationCheck: "passed"`).
5. **Numbers stay digits.** Before translation `{n} {k} {x} {p}` are replaced by guard numbers (17, 13, 14, 15:
   two-digit numbers NLLB copies verbatim, unlike 2 or 3 which it sometimes writes as words). After translation
   each guard must appear exactly once, no other digit may appear, then the slot is restored. A candidate failing
   this check is rejected. `{finding}` is never sent to the translator: templates that name a finding translate only
   their prefix ("The biggest problem ({k} out of {n})") and the frozen line is `<prefix>: {finding}`, where
   `{finding}` is a finding sentence translated and checked on its own. `tools/catalog/validate_catalog.py` and
   `validateCatalog` in core re-check every slot.
   A candidate is also rejected when NLLB copies a source word unchanged (5+ letters, same first 5 letters, e.g.
   "message" or "comments were not understood"); `validate_catalog.py` re-checks every frozen sentence against its
   sources (proper nouns such as WhatsApp allowed).
6. **Audio** with MMS-TTS Kinyarwanda (`facebook/mms-tts-kin`, VITS, fixed seed 1234 for reproducible clips),
   compressed to mp3 mono 16 kHz 24 kbit/s with ffmpeg. Only clips whose spoken text changed are regenerated
   (`audio/manifest.json` is the reference; `--fresh-audio` redoes all).

### The audio recap: concatenating pre-generated clips

A template with slots is cut at its slots; each non-empty fixed part has its own clip. `templates[i].audioParts`
has one entry per fixed part (`null` when the part is only punctuation), in the order of the slots in `rw`
(contract of `packages/core/src/catalog.ts`): play part 0, then the clip of slot 0 (`numbers["<value>"].audio` or
the finding's `kinyarwanda.audio`), then part 1, and so on. Templates without slots also have `kinyarwanda.audio`.
Numbers 0–31 are spoken in the Kinyarwanda **counting form** (rimwe, kabiri, gatatu… cumi na gatatu, makumyabiri,
mirongo itatu na rimwe), hand-written from Omniglot ("Numbers in Kinyarwanda"), languagesandnumbers.com ("How to
count in Kinyarwanda") and Harvard ELIAS ("Cardinal and ordinal numbers"), modern orthography (r, not l).
Limits: no noun-class agreement (a speaker would say "abashyitsi batatu", the clip says "gatatu"); a value above 31
has no clip (core reports it in `missingAudio`, the digits are still shown and sent by SMS).

## The frozen sentences

| id | Kinyarwanda (`rw`) | source (en) | back-translation (en) | score | attempt |
|---|---|---|---|---|---|
| P1 | Abashyitsi bumvaga bakiriwe neza. | Visitors felt welcome. | The visitors felt welcomed. | 0.98 | 1 |
| P2 | Abashyitsi bakundaga gusura umurima w'ikawa. | Visitors liked the visit of the coffee field. | Guests often visited the coffee plantation. | 0.81 | 1 |
| P3 | Abashyitsi bishimiye kureba uko ikawa yateguwe no kuyirya. | Visitors liked seeing the coffee prepared and tasting it. | The guests were thrilled to see how the coffee was prepared and consumed. | 0.87 | 1 |
| P4 | Abashyitsi bishimiye ibyo kurya. | Visitors liked the meal. | The guests enjoyed the meal. | 0.91 | 1 |
| P5 | Ibisobanuro byawe ku birebana n'ikawa birasobanutse neza. | Your explanations about coffee are clear. | Your definition of coffee is clear. | 0.91 | 1 |
| P6 | Abashyitsi bakundaga kubona ubuzima nyakuri bwo mu isambu. | Visitors liked seeing real farm life. | Visitors enjoyed real life on the farm. | 0.93 | 1 |
| P7 | Abashyitsi bakundaga aho hantu. | Visitors liked the landscape. | Visitors loved this place. | 0.76 | 1 |
| P8 | Urwo ruzinduko rufite agaciro. | The visit is worth its price. | That visit is worthwhile. | 0.76 | 2 |
| P9 | Abashyitsi bifuza kugura ikawa yawe. | Visitors want to buy your coffee. | Guests want to buy your coffee. | 0.97 | 1 |
| P10 | Abashyitsi bifuza kugaruka bakabwira incuti zabo ibyawe. | Visitors want to come back and tell their friends about you. | Guests want to come back and tell their friends about you. | 0.91 | 1 |
| P11 | Abashyitsi barishimye cyane. | Visitors are very happy. | The guests were thrilled. | 0.83 | 1 |
| N1 | Inzira igana ku isambu irareshya cyane cyangwa ikaba igoye cyane. | The road to the farm is too long or difficult. | The road to the farm is either too long or too difficult. | 0.99 | 1 |
| N2 | Igiciro cyayo ntikizwi neza n'abashyitsi. | The price is not clear to visitors. | The price is not well known to visitors. | 0.88 | 1 |
| N3 | Urwo ruzinduko rwamaze igihe kirekire cyane. | The visit lasts too long. | The visit took a very long time. | 0.86 | 2 |
| N4 | Urwo ruzinduko ntiruzamara igihe gihagije. | The visit does not last long enough. | The visit will not be long enough. | 0.82 | 2 |
| N5 | Abashyitsi biragoye kukumva. | Visitors find it hard to understand you. | It is difficult for visitors to understand. | 0.89 | 1 |
| N6 | Nta byokurya bihagije. | There is not enough food. | There is not enough food. | 1.00 | 1 |
| N7 | Inzu y'isuku si isukuye. | The toilets are not clean. | The toilet is not clean. | 0.86 | 2 |
| N8 | Abashyitsi bafite inyota. | Visitors are thirsty. | The guests are thirsty. | 0.87 | 2 |
| N9 | Abashyitsi bategereje igihe kirekire cyane. | Visitors wait too long. | The guests waited a very long time. | 0.78 | 1 |
| N10 | Abashyitsi ntibashobora kugura ikawa. | Visitors cannot buy coffee. | Guests cannot buy coffee. | 0.95 | 1 |
| volume | Muri uku kwezi: Ubutumwa {n} bwatanzwe n'abashyitsi. | This month: {n} messages from visitors. | This month: 17 messages from guests. | 0.93 | 1 |
| keep | Ibyo abashyitsi bakunda ({k} ku {n}): {finding} | What visitors like ({k} out of {n}): {finding} | What guests like (13 out of 17) | 0.75 | 2 |
| fix | Ikibazo gikomeye kurusha ibindi ({k} ku {n}): {finding} | The biggest problem ({k} out of {n}): {finding} | The most important issue (13 out of 17) | 0.76 | 5 |
| fix_streak | Ikibazo gikomeye kurusha ibindi ({k} kuri {n}), mu gihe cy'amezi {x}: {finding} | The biggest problem ({k} out of {n}), for {x} months: {finding} | The biggest problem (13 out of 17) in 14 months | 0.95 | 1 |
| nothing_urgent | Nta kibazo gikomeye muri uku kwezi. | No big problem this month. | There are no major problems this month. | 0.88 | 3 |
| unknown_topic | Abashyitsi {k} baganira ku ngingo nshya: usabe umuntu gusoma amagambo yabo. | {k} visitors talk about a new topic: ask a person to read their words. | 13 guests discuss a new topic: Ask someone to read their words. | 0.92 | 1 |
| not_understood | {p} Amagambo adasobanutse neza: jya usaba umuntu. | {p} unclear remarks: ask someone. | 15 Confused words: Ask someone. | 0.82 | 2 |
| no_feedback | Nta butumwa bw'umushyitsi muri uku kwezi. | No message from visitors this month. | There are no guest messages this month. | 0.82 | 2 |

**What the back-translations show (read before trusting the scores).** A score above the threshold does not
mean the sentence is right; the embedding model is lenient and the back-translation uses the same NLLB model, so
errors can cancel out. Visible drifts a speaker should check first: P2 and P6 use a habitual past ("used to like");
P3 says `kuyirya` ("consume it") for tasting; P7 says "this place" rather than "the landscape"; P8 lost "price" ("the visit is
worthwhile"); N5 lost "you"; `not_understood` says "words" (`amagambo`) for "remarks" and keeps a capital after the
number; `keep`/`fix` use `ku` and `fix_streak` uses `kuri` for "out of"; `fix_streak` ("for {x}
months") replaces "{x}th month in a row". These are honest limits of machine translation without a speaker.
Fixed on 2026-10-04 (sources reworded, sentences re-run with `--only`, clips regenerated): `not_understood` said
"{p} messages were not understood" while `{p}` counts remarks (not-sure chunks, a message can hold several);
`unknown_topic` kept the English word "message" ("izo message"); P3 back-translated as "cooking" (NLLB has no word
for roasting, so the source now says "seeing the coffee prepared and tasting it").
For a language machine translation covers badly, a speaker can simply rewrite these ~30 sentences and record
them, no model needed (set `status: "speaker_validated"`).

## Reference score of the translation model on FLORES-200

| Direction | chrF++ | Source |
|---|---|---|
| eng_Latn → kin_Latn, NLLB-200 distilled 600M (the model used) | **44.0** | `metrics.csv` of the checkpoint, linked as "metrics" from the model card https://huggingface.co/facebook/nllb-200-distilled-600M → https://tinyurl.com/nllb200densedst600mmetrics → https://dl.fbaipublicfiles.com/large_objects/nllb/models/nllb_200_dense_distill_600m/metrics.csv, row `eng_Latn-kin_Latn,44` (downloaded 2026-10-03, sha256 `6feb8ca1…d666`) |
| kin_Latn → eng_Latn, same model | 51.3 | same file, row `kin_Latn-eng_Latn,51.3` |
| fra_Latn → kin_Latn, same model | not published | the 600M file lists only a subset of directions (all xx↔eng plus a few others); no `fra_Latn-kin_Latn` row |
| fra_Latn → kin_Latn, NLLB-200 MoE 54.5B (the full model, not the one used) | 46.2 | https://dl.fbaipublicfiles.com/large_objects/nllb/models/nllb_200_moe_54b/metrics.csv (linked from the NLLB-200 model cards), row `fra_Latn-kin_Latn,46.2,23.1,28.8` (chrF++, spBLEU spm-200, spBLEU spm-100); eng→kin 49.7 in the same file |

The metrics file does not name the split; the NLLB paper (NLLB Team et al., "No Language Left Behind: Scaling
Human-Centered Machine Translation", arXiv:2207.04672, 2022) reports FLORES-200 **devtest** results.
`tools/catalog/flores_check.py` re-measures eng→kin and fra→kin for the 600M model on FLORES-200 devtest
(FLORES-200, CC-BY-SA 4.0, https://dl.fbaipublicfiles.com/nllb/flores200_dataset.tar.gz) and writes
`flores-check.json`. **Not run yet**: on this shared CPU (load ~38 from parallel jobs) NLLB took 25–230 s per
FLORES sentence, so 2 × 1012 sentences did not fit; only the published figures above are reported.

## Licences

| Asset | Licence | Consequence |
|---|---|---|
| `facebook/nllb-200-distilled-600M` (translation, build time only) | CC-BY-NC 4.0 (model card) | non-commercial; used once offline, not shipped |
| `facebook/mms-tts-kin` (the clips in `audio/`) | **CC-BY-NC 4.0** (model card front matter `license: cc-by-nc-4.0`, checked 2026-10-03) | the shipped clips are outputs of a non-commercial model: a commercial deployment must re-record them (a speaker can) or use another voice |
| `Xenova/paraphrase-multilingual-MiniLM-L12-v2` (scoring) | Apache-2.0 | |
| Examples, keywords, sources, numbers list | written for this project (synthetic) | |

## Rebuild and validate

```bash
python3 -m venv .venv
.venv/bin/pip install --index-url https://download.pytorch.org/whl/cpu torch
.venv/bin/pip install -r tools/requirements.txt -r tools/catalog/requirements.txt
pnpm models:download                                    # the MiniLM ONNX file used for scoring
.venv/bin/python tools/catalog/build_kinyarwanda.py     # content + translate (~15 min CPU) + audio (~2 min)
.venv/bin/python tools/catalog/build_kinyarwanda.py --stages translate --only template:fix   # redo one sentence
.venv/bin/python tools/catalog/validate_catalog.py      # JSON Schema + SPEC 5 rules + audio files
.venv/bin/python tools/catalog/test_catalog.py          # unit tests of slot protection and the validator
.venv/bin/python tools/catalog/check_examples.py        # nearest-neighbour distinctness of the examples
.venv/bin/python tools/catalog/flores_check.py          # optional: chrF++ on FLORES-200 devtest (long)
```
Models are cached in `tools/cache/hf` (git-ignored). Changing the catalog for another activity (SPEC 11.9) means
editing the three authored Python files and re-running the script.

Built with: torch 2.14.1+cpu, transformers 5.18.0, onnxruntime 1.30.0, tokenizers 0.23.2, ffmpeg 6.1.1
(WSL2, 8 CPUs, no GPU), 2026-10-03/04.
