# tools/ — build-time tooling (never needed at runtime)

| Script | Language | Purpose |
|---|---|---|
| `scripts/download-models.mjs` | Node | Downloads the quantized ONNX models into `models/` (`pnpm models:download`, `--all` adds whisper-small). |
| `kinyarwanda/` (to write) | Python | NLLB-200 fr/en → kin, back-translation kin → fr, similarity score, slot check, MMS-TTS kin audio → fills `catalog/catalog.json` and `catalog/audio/`. |
| `tts/` (to write) | Python | Multilingual synthetic voices for the level-3 evaluation and the demo sample messages (marked synthetic). |
| `datasets/` (to write) | Python/Node | FLEURS (en, fr, de, es, sw) subsets and ambient-noise download into `datasets/` (git-ignored). |

Python: `python3 -m venv .venv` then see `requirements.txt` (CPU-only torch from the PyTorch CPU index).
