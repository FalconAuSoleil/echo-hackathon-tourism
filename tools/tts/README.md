# tools/tts — synthetic voices for the evaluation and the demo (build time only)

Everything produced here is **synthetic speech** (Piper TTS), never a real visitor. Voice licenses: see
`voices.py` and `eval/data/README.md` (all CC0 / CC-BY / CC-BY-SA / Unlicense, none non-commercial).

| File | Purpose |
|---|---|
| `voices.py` | registry of the 13 Piper voices (en, fr, de, es) with dataset licenses; `python voices.py` downloads them into `tools/cache/piper/` (~0.9 GB, git-ignored) |
| `synth.py` | shared synthesis (Piper → 16 kHz mono PCM16 via ffmpeg) |
| `synthesize_eval.py` | level 3 (SPEC 9): 80 feedbacks of `eval/data/feedback.jsonl` → `eval/data/generated/audio/clean/` + `eval/data/audio_manifest.jsonl` |
| `synthesize_demo.py` | the 10 demo messages of SPEC 8 → `eval/data/demo-samples/` (committed) + `manifest.json`; `--only id1,id2` re-takes some |
| `make_eval_audio.sh` | **one command** for all level-3 audio: voices, speech, ESC-50 noise (`tools/datasets/`), mixes at 20/10/5 dB |
| `check_demo.mts` | runs the demo samples (or candidate takes) through the shipped pipeline (whisper-base + `@echo/core`, calibrated thresholds) and compares with each sample's `expected`; used by `synthesize_demo.py` to pick takes (`cd eval && npx tsx ../tools/tts/check_demo.mts`) |
| `check_asr.mts` | intelligibility sanity check with the shipped Whisper adapter (`cd eval && npx tsx ../tools/tts/check_asr.mts <manifest.jsonl> [clean|20|10|5] [model]`) |
| `requirements.txt` | `piper-tts==1.8.0`, `soundfile`, `numpy` (+ `ffmpeg` on the PATH) |

```bash
.venv/bin/pip install -r tools/tts/requirements.txt
bash tools/tts/make_eval_audio.sh            # level-3 audio (≈5 min)
.venv/bin/python tools/tts/synthesize_demo.py  # demo samples (needs models/ for the take selection)
```

Determinism: the selection of feedbacks, voices, speakers, speeds and noise clips is seeded. Piper itself draws
noise inside its ONNX graph (not seedable), so re-generated waveforms differ slightly from run to run (same
words, same voice). The engine `piper-tts` is GPL-3.0; it is only used offline to make test files, never shipped.
