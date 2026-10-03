
## Kinyarwanda catalog: speaker check (catalog agent, 2026-10-04)

Cannot be done here: no Kinyarwanda speaker. Everything in `catalog/` is flagged
`machine_translated_unvalidated`. Procedure for a speaker (guide, cooperative member, ~30 min):

1. Open `catalog/README.md`, table "The frozen sentences" (29 lines: 21 findings, 8 recap templates). For each line,
   read `rw` and the English/French source. Mark: correct / understandable but odd / wrong meaning.
   Check first the known drifts listed under the table (P2, P3, P6, P7, P8, N5, unknown_topic, keep/fix "ku" vs "kuri").
2. Read three full recap lines aloud with numbers, e.g. "Ibyo abashyitsi bakunda (3 ku 7): Abashyitsi bumvaga bakiriwe neza."
   Is the word order natural once `{finding}` follows the colon?
3. Listen to every clip in `catalog/audio/` (68 mp3, `audio/manifest.json` gives the text of each): is the word
   intelligible, is the pronunciation acceptable? Listen to `num-0` … `num-31` (counting form, e.g. "cumi na gatatu").
4. Listen to a concatenated line (template part + number + part + number + finding clip, played by the app's
   "Listen" button): are the gaps between clips acceptable?
5. For each wrong sentence: write the correct Kinyarwanda in `catalog/catalog.json` (`rw`, keep the slots), set
   `"status": "speaker_validated"` and add `"validatedBy": "<role>, <date>"`; re-record or regenerate its clip;
   run `.venv/bin/python tools/catalog/validate_catalog.py`.
Expected result: a list of sentences marked correct / odd / wrong, to be copied into `docs/PROGRESS.md`.
