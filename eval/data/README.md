# eval/data — evaluation corpus (ALL SYNTHETIC)

**Everything in this folder is synthetic.** The visitor feedbacks were written by the Echo team (an AI agent
acting for it) on 2026-10-03; no real visitor wrote or spoke any of them. The audio is produced by open-source
text-to-speech voices (Piper), not by people. Label every number derived from it "synthetic" (SPEC 9, CLAUDE.md).

| File | What | Committed |
|---|---|---|
| `feedback.jsonl` | 250 synthetic visitor feedbacks (en 62, fr 62, de 63, es 63), annotated — SPEC 9 level 2 | yes |
| `src/fb_{en,fr,de,es}.py` | authored source of the feedbacks (compact form) | yes |
| `build_feedback.py` | validates the annotations and writes `feedback.jsonl` (`python3 eval/data/build_feedback.py`) | yes |
| `check_disjoint.py` | checks that no feedback sentence is near-identical to a `catalog/catalog.json` example | yes |
| `audio_manifest.jsonl` | level 3: the 80 feedbacks turned into speech — voice, speaker, speed, voice license, noise clips and their licenses, SNR files | yes |
| `generated/audio/{clean,snr20,snr10,snr5}/<id>.wav` | level-3 audio, 16 kHz mono | **no** (git-ignored, ~55 MB) — `bash tools/tts/make_eval_audio.sh` |
| `demo-samples/*.wav` + `manifest.json` | the 10 demo messages of SPEC 8 (synthetic voices), with transcripts and expected outcomes | yes (1.6 MB) |

## 1. Level 2 — `feedback.jsonl`

One JSON object per line:

```jsonc
{
  "id": "en-004", "lang": "en", "synthetic": true,
  "text": "The lunch with beans and plantains was delicious but the road up from the village is brutal, my knees still hurt.",
  "expectedFindings": ["P4", "N1"],           // message level: each finding once (SPEC "k out of n" counts visitors)
  "mustNotFindings": [],                      // findings negated in the text: producing one is an error
  "chunks": [                                 // chunk level: exact substrings of text
    { "span": "The lunch with beans and plantains was delicious", "kind": "finding", "finding": "P4" },
    { "span": "the road up from the village is brutal, my knees still hurt.", "kind": "finding", "finding": "N1" }
  ],
  "flags": { "negation": null, "multiFinding": true, "typo": false, "length": "medium",
             "offList": false, "offListTopics": [], "ambiguous": false, "picking": false, "mentionsGuide": false }
}
```

Chunk `kind`:
- `finding`: the span expresses that finding (P1–P11, N1–N10, see `catalog/catalog.json`).
- `not_sure`: ambiguous on purpose ("Too long." — the path or the visit?; "C'était spécial."). The expected
  outcome is **not sure / ask a person**; any finding there is an error.
- `off_list`: a topic the catalog does not know, with a `topic` tag (`picking` for coffee-cherry picking).
  Expected: off-list, no finding.
- `negated` (with `negates`): a negation that cancels a finding ("the walk up wasn't too long"). Expected: no
  finding — off-list or not sure are both acceptable — and **never** the negated finding (SPEC 7).

Text that is not covered by any span (fillers like "So, where to start.") expects no finding.

Flags: `negation` = `"cancels"` (negation that must not trigger the finding) or `"inherent"` (the negation *is*
the finding: "there was no shade" → N8, "we couldn't buy coffee" → N10; a naive "negated → not sure" rule loses
these), `length` = `very_short` (≤3 words) / `short` (≤8) / `medium` / `long` (≥40), `mentionsGuide` = the text
mentions the guide or translation (SPEC 7: host-only).

### Composition (SPEC 9 level 2) — checked by `build_feedback.py`
| | count |
|---|---|
| feedbacks | 250 (en 62, fr 62, de 63, es 63) |
| with an off-list topic | 28 (11 %), 27 of them only off-list; 25 distinct non-picking topics, none repeated 3 times (no true recurring signal besides picking) |
| coffee-cherry picking | **exactly 3**: en-026, fr-025, de-025 (one each in en, fr, de) → must trigger "unknown topic recurring at 3 visitors" |
| ambiguous (expected not sure) | 17 |
| negations that cancel a finding | 23 messages (29 chunks) |
| negations inherent to a finding | 46 |
| several findings | 46 messages (up to 8 findings in one long message) |
| typos | 21 |
| very short / short / long | 18 / 33 / 8 |
| mentions the guide | 14 |
| per finding (messages) | every finding 8–21 times (min N5: 8) |

Off-list topics were chosen to be semantically far apart (wifi, dog, phone charging, a wedding procession,
accommodation tip, family memory, lost sunglasses, sunburn, kids drawing, birds, church choir, rain umbrellas,
bike rental, beehives, camping, town market, photo print, football, night sky, taxi, drums and dancing,
Instagram, gorilla trekking, pharmacy, school visit) so that they should **not** cluster into a false recurring
signal; a false alert on them is a measured failure.

### Disjoint from the catalog
The feedbacks were written independently of the catalog examples. `check_disjoint.py` compares every feedback
sentence, span and full text with every catalog example (same language: identical, difflib ratio ≥ 0.85, token
Jaccard ≥ 0.8, or containment of ≥ 4 tokens; any language: identical) and exits 1 on a hit. On 2026-10-03,
against the 756 catalog examples then present, it first reported 11 near-duplicates (mostly a catalog sentence
contained in a longer feedback); the 9 feedbacks concerned were rewritten and the check now passes:

```bash
python3 eval/data/check_disjoint.py      # re-run whenever catalog/catalog.json examples change
```

### Public real reviews: none usable (limitation)
SPEC 9 asks to add a public multilingual source of real reviews if its license is compatible. Checked on 2026-10-03:

| Candidate | Finding | Verdict |
|---|---|---|
| Multilingual Amazon Reviews Corpus (`amazon_reviews_multi`, en/de/fr/es/ja/zh) | Hugging Face page: "Defunct: no longer accessible due to the decision of data providers". License was Amazon-specific, non-commercial research only, no republishing. Product reviews, not visits. | not available, not compatible |
| Yelp Open Dataset | Yelp presents it as "intended for educational use", under its own dataset agreement (no redistribution, non-commercial); US/Canada businesses, essentially English. | not compatible (no redistribution of a sample in a public repo), wrong languages |
| SemEval-2016 Task 5 ABSA (restaurant reviews in en, fr, es, nl, ru, tr) | "publicly available for research purposes"; no explicit license on the task pages (only "All rights reserved"); no German; restaurant aspects, not farm visits. | license unclear → not used |
| Wikivoyage | travel guide text, CC BY-SA, but not reviews | not applicable |
| TripAdvisor / Booking scrapes on Kaggle | scraped from platforms whose terms forbid it, mostly English | not used |

So **no real reviews are included**: all level-2 data is synthetic and written by the team. This is a limitation
for the README data sheet: real visitor messages are messier (code-switching, local names, emoji, very long
voice notes) than ours, and there is no public corpus of feedback on farm visits in Africa (SPEC 10).

## 2. Level 3 — audio (`audio_manifest.jsonl`, `generated/audio/`)

`bash tools/tts/make_eval_audio.sh` recreates everything (≈5 min on 8 CPUs, ~1 GB of voices in `tools/cache/`):
1. `tools/tts/voices.py` downloads 13 Piper voices; `tools/tts/synthesize_eval.py` picks 80 feedbacks
   (20 per language, seeded, stratified: the 3 picking ones, negations, ambiguous, off-list, long, very short,
   multi-finding, typos) and synthesises each with a rotating voice, a random speaker of multi-speaker voices and
   a speed (`length_scale` 0.8–1.25) → `clean/<id>.wav`.
2. `tools/datasets/fetch_noise.py` downloads 48 outdoor clips from ESC-50 (rain, wind, birds, crickets, insects,
   fire, engine, rooster, hen, cow, dog, footsteps), keeping only clips whose Freesound source is CC0 or CC-BY.
3. `tools/datasets/mix_noise.py` adds one continuous ambience (+ a farm event 6 dB lower in half of the cases)
   and 0.4 s of noise before/after, at **20, 10 and 5 dB SNR** (SNR on active speech frames) → `snr{20,10,5}/`.
   Same noise segment for each SNR, so the levels are comparable.

The manifest row per feedback records: text, expected findings, flags, `tts` (engine, voice, speaker,
lengthScale, speed, voice license, voice dataset, source URL), `durationSec`, the `clean` path, `noisy`
paths per SNR, and `noise` (ambience, event, clip pool with dataset license, source license, author, URL).

### TTS voices (Piper, https://huggingface.co/rhasspy/piper-voices — licenses read in each voice's MODEL_CARD)
| Voice | Lang | Speakers | Voice/dataset license | Used for |
|---|---|---|---|---|
| en_US-libritts_r-medium | en | 904 | CC BY 4.0 (LibriTTS-R) | eval, demo |
| en_GB-vctk-medium | en | 109 | CC BY 4.0 (VCTK) | eval, demo |
| fr_FR-mls-medium | fr | 125 | CC BY 4.0 (MLS) | eval, demo |
| fr_FR-siwis-medium | fr | 1 | CC BY 4.0 (SIWIS) | eval, demo |
| fr_FR-upmc-medium | fr | 2 | CC BY-SA 4.0 (UPMC Pierre) | eval, demo |
| de_DE-mls-medium | de | 236 | CC BY 4.0 (MLS) | eval |
| de_DE-thorsten-medium | de | 1 | CC0 (Thorsten-Voice) | eval, demo |
| de_DE-thorsten_emotional-medium | de | 8 | CC0 (Thorsten-Voice) | eval, demo |
| de_DE-kerstin-low | de | 1 | CC0 | eval |
| es_ES-sharvard-medium | es | 2 | CC BY 3.0 (Sharvard) | eval |
| es_ES-davefx-medium | es | 1 | CC0 | eval, demo |
| es_MX-ald-medium | es | 1 | Unlicense | eval |
| es_AR-daniela-high | es | 1 | CC BY-SA 4.0 (OpenSLR 61) | eval |

Engine: `piper-tts` 1.8.0 (GPL-3.0, build-time only, never shipped). No voice is non-commercial. Voices excluded
on purpose: `en_US-l2arctic` (CC BY-NC), `fr_FR-tom` (AGPL).

### Ambient noise: ESC-50
K. J. Piczak, "ESC: Dataset for Environmental Sound Classification", ACM MM 2015,
https://github.com/karolpiczak/ESC-50. License: CC BY-NC 3.0 for the dataset, CC BY 3.0 for the ESC-10 subset;
each clip is derived from a Freesound recording whose license and author are listed in the ESC-50 LICENSE file
and copied into the manifest. We use only clips with a CC0 or CC-BY Freesound source, for non-commercial
evaluation only; the noise is never shipped and never committed. 5 s clips, 44.1 kHz, resampled to 16 kHz and
concatenated to the speech length. Not covered: real farm ambience in Rwanda, wind on a phone microphone,
other people talking in the background, phone/codec artefacts (WhatsApp Opus).

### Intelligibility sanity check (not the evaluation)
`cd eval && npx tsx ../tools/tts/check_asr.mts ../eval/data/audio_manifest.jsonl clean` transcribes the clean
clips with the shipped Whisper adapter. Measured on 2026-10-03 with whisper-base q8 (synthetic, clean, 80 clips,
1242 words; references contain the deliberate typos, which inflates WER slightly): overall WER 0.17 — en 0.12,
fr 0.27, de 0.24, es 0.24 (mean per clip); language detected correctly for 79/80 (the miss is the 2-word
"Bof, mitigé."). By voice: en_US-libritts_r 0.04, es_ES-davefx 0.07, fr_FR-upmc 0.13, es_ES-sharvard 0.17,
de_DE-kerstin 0.19, fr_FR-mls 0.20, en_GB-vctk 0.21, de_DE-thorsten_emotional 0.21, de_DE-mls 0.27,
de_DE-thorsten 0.27, es_MX-ald 0.30, es_AR-daniela 0.42, fr_FR-siwis 0.50 (one bad 2-word clip dominates).
The official level-3 numbers come from `pnpm eval`. Known effect: very short feedbacks ("Thanks!", "Meh.") give clips under 3 s, which the app marks
"inaudible" by design (SPEC 7); the level-3 evaluation should report them separately.

## 3. Demo samples — `demo-samples/` (SPEC 8)

10 committed WAV files (16 kHz mono, 1.6 MB in total), **synthetic voices**, to be labelled as such in the demo.
`manifest.json` gives for each: transcript, language, voice + license, duration and the expected outcome.

| id | lang | content | expected |
|---|---|---|---|
| de-roasting-path | de | roasting appreciated + path too long | P3 + N1 |
| en-prices-buy | en | unclear prices + wants to buy coffee | N2 + P9 |
| fr-welcome-meal | fr | warm welcome + meal | P1 + P4 |
| es-visit-too-long | es | visit too long | N3 |
| en-negation | en | "the walk up was not too long at all" | never N1 (not sure acceptable) |
| fr-ambiguous | fr | "c'était particulier… je ne sais pas quoi en penser" | not sure |
| en-picking, de-picking, fr-picking | en, de, fr | wish to pick coffee cherries | off-list ×3 → "unknown topic recurring at 3 visitors" |
| inaudible-noise | – | 1.6 s of faint generated brown noise (numpy, no third-party audio) | inaudible, not counted |

Recreate: `.venv/bin/python tools/tts/synthesize_demo.py`. Voices/speakers were chosen for intelligibility, and
Piper's sampling is random, so the script makes 4 takes per sample and keeps the one with the lowest
whisper-base WER (recorded as `voice.take` in the manifest). Unlike the level-3 audio, the demo samples are
therefore *selected* clean takes: they show the pipeline, they are not evidence of accuracy.
Whisper-base on the committed takes: WER 0 to 0.22 per sample, all languages detected correctly; the
inaudible sample is transcribed as "you" with confidence 0.12 and lasts 1.6 s (< 3 s rule).
