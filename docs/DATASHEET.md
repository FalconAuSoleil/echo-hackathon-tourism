# Echo — data sheet (SPEC section 10)

Every source used to argue the problem, build the product or measure it. For each one: name, source, license
(checked by us on the primary page, with the URL and the access date), size, use in Echo, and what it does not
cover. All pages were accessed on **2026-10-03** unless stated otherwise. Raw files and verbatim excerpts are in
[`docs/evidence/`](evidence/). Anything synthetic is labelled **synthetic**.

---

## 1. Data that shows the problem (Rwanda)

### 1.1 International tourism: UN Tourism series, via the World Bank WDI

The World Bank's World Development Indicators (WDI) republish the UN Tourism series (indicator metadata, field
`sourceOrganization`: *"Yearbook of Tourism Statistics, Compendium of Tourism Statistics and data files, UN
Tourism"*). We fetched them from the WDI API and saved the raw JSON.

| Indicator (WDI code) | 2019 | 2020 | Latest non-empty year in WDI |
|---|---|---|---|
| International tourism, number of arrivals (`ST.INT.ARVL`) | **1,634,000** | (empty) | 2019 |
| International tourism, receipts, current US$ (`ST.INT.RCPT.CD`) | **US$ 635.9 million** | US$ 212.0 million | 2020 |
| International tourism, receipts, % of total exports (`ST.INT.RCPT.XP.ZS`) | **28.2 %** | 11.0 % | 2020 |
| International tourism, expenditures, current US$ (`ST.INT.XPND.CD`) | US$ 382.8 million | US$ 127.0 million | 2020 |

Earlier years for context (same files): arrivals 908,000 (2011) → 1,711,000 (2018); receipts were between 26 % and
30 % of Rwanda's exports every year 2012–2019.

- **Source:** `https://api.worldbank.org/v2/country/RWA/indicator/<code>?format=json&per_page=100`, database last
  updated 2026-07-13 (API field `lastupdated`). Raw files: `docs/evidence/wdi_RWA_ST.INT.ARVL.json`,
  `wdi_RWA_ST.INT.RCPT.CD.json`, `wdi_RWA_ST.INT.RCPT.XP.ZS.json`, `wdi_RWA_ST.INT.XPND.CD.json`; indicator metadata
  in `wdi_meta_*.json`.
- **License:** WDI: **Creative Commons Attribution 4.0** ("This dataset is licensed under Creative Commons
  Attribution 4.0"), checked on https://datacatalog.worldbank.org/search/dataset/0037712/World-Development-Indicators.
  The UN Tourism Data Dashboard itself (https://www.untourism.int/tourism-data/un-tourism-tourism-dashboard) states
  "© Copyrights UN Tourism 2025. All rights reserved": we use the WDI redistribution, not the dashboard.
- **Size:** 4 series × 66 years, ~60 KB of JSON.
- **Use in Echo:** problem statement (tourism is a large share of Rwanda's exports).
- **Does not cover:** anything after 2019 for arrivals and after 2020 for receipts in WDI (the dashboard has newer
  data but we could not extract Rwanda values from it programmatically); no split by region, by type of
  activity, or for farm and rural visits. Arrivals count all international visitors, including cross-border.

**More recent national figure (primary national source, not UN Tourism):** the Rwanda Development Board reports
that in 2024 tourism "generated USD 647 million in revenue, with 1.36 million visitors welcomed throughout the year"
(RDB press release, 15 April 2025,
https://rdb.rw/rwanda-development-board-annual-report-highlights-strong-economic-performance-and-strategic-progress-in-2024/).
RDB's visitor definition differs from the UN Tourism arrivals series, so the two figures are not comparable year
to year. No license is stated on the page; we quote two figures with attribution.

### 1.2 World Bank Enterprise Surveys, Rwanda 2023

- **Source:** Rwanda 2023 Country Profile,
  https://www.enterprisesurveys.org/content/dam/enterprisesurveys/documents/country/Rwanda-2023.pdf; microdata
  catalog entry RWA_2023_WBES_v01_M, https://microdata.worldbank.org/index.php/catalog/6468. Verbatim excerpts:
  `docs/evidence/enterprise_surveys_rwanda_2023_excerpt.txt`.
- **Survey:** "Business owners and top managers in 598 firms were interviewed between May 2023 and February 2024."
  Small = 5–19 employees.
- **Findings (biggest obstacle, % of firms):**

| Biggest obstacle | All firms | **Small firms (5–19)** | Sub-Saharan Africa |
|---|---|---|---|
| Access to finance | 28.8 | **30.0** | 26.4 |
| Tax rates | 15.5 | **15.7** | 8.3 |
| Access to land | 15.2 | **14.9** | 4.7 |
| Practices of the informal sector | 8.7 | 9.1 | 10.0 |

  48.1 % of small firms compete against unregistered or informal firms (41.4 % of all firms).
- **License / access:** we used only the published country profile (a public World Bank report, quoted with
  attribution). The firm-level microdata sit behind the World Bank Microdata Library access policy and were not
  downloaded.
- **Size:** 12-page PDF; 598 firms.
- **Use in Echo:** context: small Rwandan businesses are short of money, so a tool must cost nothing and need
  no new hardware.
- **Does not cover (important):** the survey **excludes agriculture, firms with fewer than 5 employees and
  informal firms** (Figure 1 of the profile). A family farm hosting visitors is outside its scope. There is no
  question on customer feedback. This gap is part of our argument.

### 1.3 GSMA, The Mobile Gender Gap Report (2025 and 2026 editions)

- **Source:** 2026 edition (published June 2026, GSMA Consumer Survey 2025):
  https://www.gsma.com/wp-content/uploads/2026/07/The-Mobile-Gender-Gap-Report-2026.pdf. 2025 edition (GSMA
  Consumer Survey 2024): https://www.gsma.com/wp-content/uploads/2025/12/The-Mobile-Gender-Gap-Report-2025.pdf.
  Verbatim excerpts: `docs/evidence/gsma_mobile_gender_gap_excerpt.txt`.
- **Country coverage, exactly:** the 2026 edition surveyed 14 LMICs face to face (Sept–Nov 2025, ~1,000 adults
  each), including Egypt, Ethiopia, Ghana, Kenya, Nigeria, Senegal and Uganda in Africa. **Rwanda was surveyed by
  the GSMA once, in 2024** (methodology footnote of both editions), so the latest Rwanda figures are in the 2025
  edition. Regional figures mix survey results with modelled data.
- **Rwanda, GSMA Consumer Survey 2024 (2025 edition, Figures 2 and 8), % of adults 18+:**

| | Men | Women | Gender gap |
|---|---|---|---|
| Mobile ownership | 72 % | 59 % | 18 % |
| Smartphone ownership | **37 %** | **23 %** | **37 %** |
| Mobile internet adoption | 36 % | 23 % | 35 % |
| Most advanced handset is a basic phone | 20 % | 20 % | |
| Most advanced handset is a feature phone | 16 % | 16 % | |

  So in Rwanda, among women who own a handset, more own a basic or feature phone (36 % of all women) than a
  smartphone (23 %). The report also notes that in Rwanda "around 20% of female smartphone owners" do not use
  mobile internet.
- **Sub-Saharan Africa, 2026 edition (2025 data):** 34 % of women own a smartphone; gender gap in smartphone
  ownership 22 %; 230 million women without a smartphone (Figure 9). Gender gap in mobile internet adoption
  narrowed "from 30% in 2024 to 26% in 2025".
- **License:** © GSMA; the report has no open license. We quote figures with attribution only and do not
  redistribute the PDF.
- **Use in Echo:** the host (often a woman, SPEC section 2) may have a basic phone: the recap must reach her by
  **SMS** and a voice clip, never through an app she must install.
- **Does not cover:** the 2024 Rwanda sample is ~1,000 adults with no rural/urban breakdown published at
  country level; nothing specific to farm households or cooperative members; no 2025 Rwanda data.

### 1.4 OpenStreetMap via Overpass: how visible are farm visits around coffee areas?

We ran the queries ourselves on 2026-10-03 against `https://overpass-api.de/api/interpreter`, counting OSM
objects (nodes, ways, relations) within **15 km** of three Rwandan coffee areas.

| Area (centre lat, lon) | any `tourism=*` | of which attraction / viewpoint / museum / artwork | of which accommodation | tagged farm tourism / agritourism | named or tagged coffee | named coffee washing station | coffee tour / experience in name |
|---|---|---|---|---|---|---|---|
| Huye (−2.596, 29.739) | 41 | 6 | 35 | **0** | 14 objects (7 names) | 2 | **0** |
| Nyamasheke (−2.340, 29.090) | 20 | 2 | 14 | **0** | 2 | 2 | **0** |
| Gakenke (−1.688, 29.788) | 5 | 2 | 3 | **0** | 0 | 0 | **0** |

- Across the three areas, exactly **one** coffee-related object is tagged as a tourist attraction
  ("Huye Mountain Coffee", `tourism=attraction`); one tea estate (Gisakura) is tagged near Nyamasheke. No object
  carries a farm-tourism or agritourism tag, and no small farm offering visits is mapped. The only coffee sites
  mapped are four washing stations and a cooperative. Most tourism objects are hotels and guest houses in towns.
- **Files:** script `docs/evidence/overpass_count.py` (it writes every exact Overpass QL query into the result);
  result `docs/evidence/overpass_result_2026-10-03.json` (counts, up to 60 distinct names per category, queries).
  Rerun: `python3 docs/evidence/overpass_count.py` (stdlib only; it retries when the server returns 429 or 504).
- **License:** OpenStreetMap data is under the **Open Data Commons Open Database License (ODbL)**, attribution
  "© OpenStreetMap contributors", checked on https://www.openstreetmap.org/copyright.
- **Use in Echo:** shows that small farms receiving visitors do not appear in public data: nobody can see their
  quality or problems.
- **Does not cover:** OSM coverage depends on volunteers, so a zero is a measure of what is mapped, not proof that
  nothing exists. Tag choices (and the 15 km radius) are ours. It is a snapshot taken on that date.

---

## 2. Data and models used to build and evaluate Echo

| Name | Source (checked) | License (verified on primary page) | Size | Use in Echo | Does not cover |
|---|---|---|---|---|---|
| **Whisper** tiny / base (small optional), OpenAI | https://github.com/openai/whisper ; ONNX q8 conversions `onnx-community/whisper-tiny`, `-base` on Hugging Face | **MIT**: LICENSE "MIT License, Copyright (c) 2022 OpenAI"; README: "Whisper's code and model weights are released under the MIT License". HF `openai/whisper-*` cards are tagged apache-2.0; the onnx-community conversions carry no license tag, so we rely on the upstream MIT. | tiny 43.6 MB, base 79.7 MB (q8 files downloaded) | On-device speech-to-text, language detection, optional English translation | **No Kinyarwanda**: Whisper's tokenizer has 99 language tokens and none for Kinyarwanda (`<|rw|>` absent, checked in `models/onnx-community/whisper-base/tokenizer.json`). Weaker outside English, on accents and in noise. |
| **paraphrase-multilingual-MiniLM-L12-v2** (sentence similarity, chosen in `docs/ARCHITECTURE.md`) | https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2 ; ONNX q8: `Xenova/paraphrase-multilingual-MiniLM-L12-v2` | **Apache-2.0** (HF license tag of the upstream model; the Xenova conversion has no tag) | 135.4 MB (q8) | Matches each chunk of a visitor message to the 21 catalog findings; back-translation check of the Kinyarwanda catalog | 50 languages, Kinyarwanda not among them. Does not understand negation by itself ("not too long" vs "far too long": 0.46 cosine), hence the rule-based negation step. |
| multilingual-e5-small (candidate, not default) | https://huggingface.co/intfloat/multilingual-e5-small | **MIT** (HF tag) | 135.4 MB (q8) | Compared in the smoke test only | Same limits; scores compressed (0.80 for unrelated text). |
| **FLEURS** (Google) | https://huggingface.co/datasets/google/fleurs | **CC-BY 4.0** (HF dataset card `license: cc-by-4.0`) | Test splits we use: en_us 647 utt. / 1.77 h / 290 MB; fr_fr 676 / 1.95 h / 349 MB; de_de 862 / 3.15 h / 569 MB; es_419 908 / 3.09 h / 582 MB; sw_ke 487 / 1.93 h / 333 MB (hours computed from `num_samples` at 16 kHz in each `test.tsv`; MB = `test.tar.gz`) | Evaluation level 1: Whisper word error rate on real human speech | Read Wikipedia sentences in quiet conditions, not spontaneous outdoor speech; no tourism vocabulary; **no Kinyarwanda** config (`data/rw_rw` does not exist). |
| **Mozilla Common Voice** (Scripted Speech) | Since October 2025 distributed only on Mozilla Data Collective (HF `mozilla-foundation/common_voice_17_0` now says so); e.g. "Common Voice Scripted Speech 23.0 – English", https://mozilladatacollective.com/datasets/cmflnn4815p33e4fb0591ef4y | **CC0-1.0** ("Creative Commons Zero v1.0 Universal (CC0-1.0)", license field on the Data Collective page) | Optional; **not downloaded** at the time of writing (only if the evaluation needs more accent variety, SPEC 9) | Optional complement to level 1 for accent variety | Read sentences; uneven quality and demographics; not outdoor. Has Kinyarwanda, but Whisper cannot transcribe it, so it is out of scope. |
| **NLLB-200 distilled 600M** (Meta) | https://huggingface.co/facebook/nllb-200-distilled-600M | **CC-BY-NC 4.0** (HF tag `license:cc-by-nc-4.0`); the card says it is a research model "not intended for production deployment" | 2.46 GB (`pytorch_model.bin`) | **Build time only** (`tools/catalog/build_kinyarwanda.py`): translates the frozen fr/en catalog sentences into Kinyarwanda and back-translates them for checking. Never shipped, never run for the host. | Published chrF++ on FLORES-200 (model's own metrics file): **eng→kin 44.0, kin→eng 51.3** (`docs/evidence/nllb200_distilled_600M_flores200_kin_chrf.csv`). Not validated by a Kinyarwanda speaker. **Non-commercial**: a commercial Echo would need the catalog re-translated by a person or another permitted model. |
| **FLORES-200** (Meta) | https://github.com/facebookresearch/flores (README section "Licenses"); HF `facebook/flores` | **CC-BY-SA 4.0** ("FLORES-200: CC-BY-SA 4.0") | 3,001 sentences from 842 web articles, 200 languages (dev, devtest, hidden test) | Reference only: we cite the published NLLB score toward Kinyarwanda (SPEC 5); we do not redistribute FLORES text | General web articles, not tourism feedback; a translation score does not show a translation is correct for a given host. |
| **MMS-TTS Kinyarwanda** (Meta, `facebook/mms-tts-kin`) | https://huggingface.co/facebook/mms-tts-kin | **CC-BY-NC 4.0** (HF tag) | 145 MB (`model.safetensors`, 36.3 M parameters, VITS) | **Build time only**: one clip per frozen catalog sentence (the recap the host listens to), fixed seed | One synthetic voice; pronunciation not checked by a speaker; **non-commercial** license (audio clips derived from it carry the same restriction in practice). |
| **Multilingual test voices: Piper** (eval level 3) — *provisional, owned by the evaluation agent* | Engine: `piper-tts` 1.8.0, https://github.com/OHF-Voice/piper1-gpl ; voices: https://huggingface.co/rhasspy/piper-voices | Engine **GPL-3.0-or-later** (build-time tool, not shipped; the older `rhasspy/piper` is MIT and archived). Voice repo tagged **MIT**; each voice is trained on a dataset whose license is in its MODEL_CARD: e.g. de thorsten / kerstin CC0, de/fr MLS CC-BY 4.0, en_GB VCTK CC-BY 4.0, en_US LibriTTS-R CC-BY 4.0, es_AR daniela CC-BY-SA 4.0, es_ES sharvard CC-BY 3.0, es_ES davefx CC0, es_MX ald Unlicense, fr siwis CC-BY 4.0, fr upmc CC-BY-SA 4.0 | 13 voices in `tools/cache/piper/` at the time of writing. **TODO (README agent): copy final voice list, clip count and hours from the level-3 manifest in `eval/`.** | Turns 60–100 written feedbacks into audio with varied voices and speeds (SPEC 9, level 3) | Read-aloud studio voices, much cleaner and more regular than real visitors; no spontaneous hesitations, no non-native accents. |
| **Ambient noise: ESC-50** (eval level 3) — *provisional, owned by the evaluation agent* | https://github.com/karolpiczak/ESC-50 (fetched by `tools/datasets/fetch_noise.py`) | Dataset **CC BY-NC 3.0**; ESC-10 subset **CC BY 3.0** (README "License" and LICENSE file); each clip comes from Freesound with its own license listed in LICENSE. The script keeps only clips whose Freesound source is CC0 or CC-BY and records attribution per clip. | **TODO (README agent): number of clips, classes, seconds and SNR levels from `datasets/noise/esc50/noise_manifest.json`.** | Outdoor background (rain, wind, birds, insects, rooster, cows, dogs, engine, footsteps) mixed at several SNRs | 5-second clips, not recorded on a Rwandan farm; no wind on the phone microphone, no crowd chatter. |
| **Synthetic visitor feedbacks** (written by the Echo team's agents) — **synthetic** | `eval/data/feedback.jsonl`, built from `eval/data/src/fb_{en,fr,de,es}.py` by `eval/data/build_feedback.py` | Our own work, released with the project | **250** feedbacks (62 en, 62 fr, 63 de, 63 es), 137 KB; 140 with one finding, 46 with two or more, 64 with none of the 21 findings; 28 with an off-list topic, 69 with a negation, 21 with typos, 17 marked ambiguous (counts on 2026-10-03) | Evaluation level 2 (text → findings: precision, recall, "not sure" rate, keyword baseline) and source text for level 3 audio | Written, not spoken; written by people who know the catalog, so their phrasing is closer to the catalog than real visitors' would be; disjoint from the catalog examples (`check_disjoint.py`), but same authors. |
| **Catalog examples** (5–10 sentences per finding per visitor language) — **synthetic** | `catalog/catalog.json`, `tools/catalog/examples_*.py` | Our own work | 21 findings × 4 languages | The reference sentences the matcher compares visitor chunks with | Same as above: authored, not collected. |

Verification notes:
- License tags for Hugging Face entries were read from the Hub API (`https://huggingface.co/api/{models|datasets}/<repo>`)
  and the model card pages on 2026-10-03.
- Model sizes are the files actually downloaded by `pnpm models:download` (see `docs/ARCHITECTURE.md` section 3),
  or the file sizes listed by the Hub API for models we do not ship.

---

## 3. What the data does not cover

The jury will look at this, so we state it plainly:

1. **There is no public collection of visitor feedback about farm visits in Africa.** We searched for one and found
   none. The tourism statistics (UN Tourism, WDI, RDB) count arrivals and money at country level. The Enterprise
   Surveys leave out agriculture, firms with fewer than 5 employees and informal firms. OpenStreetMap barely maps
   farm visits (one coffee-related tourist attraction across three coffee areas). The level a small farm works at,
   one host and her visitors, has no data at all.
   The closest public datasets we found (searched 2026-10-03; neither is used in Echo):
   - "Dataset of Tourist Sentiments and Satisfaction in African Destinations" (Mendeley Data, 2025,
     https://data.mendeley.com/datasets/6tyv663nrs, CC BY 4.0): 5,043 TripAdvisor reviews of ten African
     *destinations*, 2018–2023. These are written reviews of destinations, in English, not of family farms.
   - `mbazaNLP/NMT_Tourism_parallel_data_en_kin` (Hugging Face, CC-BY 2.0, 10K–100K pairs): English–Kinyarwanda
     tourism sentence pairs for machine translation. It contains no visitor feedback, and it could serve a later
     check of the catalog translation.
2. **Our test feedbacks are written, and our test voices are synthetic.** The 250 feedbacks are written by us
   (labelled synthetic). The level-3 audio is Piper speech, cleaner and more regular than a real visitor talking
   outdoors, even after we add ESC-50 noise. Level 1 (FLEURS, real human speech) is there to correct this, but
   FLEURS is read speech in quiet rooms.
3. **The Kinyarwanda is machine-translated and has not been checked by a speaker.** NLLB-200 produced it and
   back-translation checked it (published chrF++ eng→kin 44.0 on FLORES-200). MMS-TTS voices it. Everything in
   Kinyarwanda is marked "machine translation, not validated by a speaker".
4. **Whisper is weaker outside English and has no Kinyarwanda.** Visitors speak English, French, German or
   Spanish, and Echo measures the error rate per language (level 1). The host never speaks to the model: she only
   receives frozen sentences.
5. **The GSMA Rwanda figures come from one 2024 survey of about 1,000 adults**, with no breakdown for farming
   households. Rwanda's tourism numbers in WDI stop in 2019 (arrivals) and 2020 (receipts).
6. **Two licenses are non-commercial** (NLLB-200 and MMS-TTS, CC-BY-NC 4.0; ESC-50 as a whole is CC BY-NC 3.0).
   That is fine for this hackathon prototype. Commercial use would mean replacing the catalog translation and the
   Kinyarwanda audio, and keeping only CC0/CC-BY noise clips (which the script already does).

## 4. Echo creates the missing data

Today nobody records what visitors to small farms think. Echo produces exactly that: **structured feedback for each
farm**, made of the 21 catalog findings with counts per month, "not sure" items flagged for a person to check, and
off-list topics. It is built offline on the farm's smartphone (the host's own Android, or the household
smartphone when the host only has a basic phone), and it keeps no audio, no names and no visitor phone numbers.
With the host's consent, aggregated counts per finding feed a **cooperative view** (SPEC 4.7; never message text,
never remarks about the guide), which gives the cooperative its first comparable picture of visit quality across
its farms, for example "5 farms out of 12: path too long". That picture can support training, new offers and
funding requests. This matters because access to finance is the top obstacle for small Rwandan firms (Enterprise
Surveys 2023).
