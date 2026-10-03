#!/usr/bin/env bash
# Recreates all level-3 SYNTHETIC evaluation audio (git-ignored) in one command:
# Piper voices -> clean speech for 80 feedbacks -> ESC-50 outdoor noise -> mixes at 20/10/5 dB SNR.
# Usage: bash tools/tts/make_eval_audio.sh   (from anywhere; needs .venv with piper-tts, soundfile, numpy; ffmpeg)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PY="$ROOT/.venv/bin/python"
[ -x "$PY" ] || { echo "missing $PY: python3 -m venv .venv && .venv/bin/pip install piper-tts soundfile numpy"; exit 1; }
"$PY" -c "import piper, soundfile, numpy" 2>/dev/null || "$PY" -m pip install -r "$ROOT/tools/tts/requirements.txt"
"$PY" "$ROOT/tools/tts/voices.py"
"$PY" "$ROOT/tools/tts/synthesize_eval.py" "$@"
"$PY" "$ROOT/tools/datasets/fetch_noise.py"
"$PY" "$ROOT/tools/datasets/mix_noise.py"
echo "level-3 audio ready in eval/data/generated/audio/{clean,snr20,snr10,snr5}; manifest eval/data/audio_manifest.jsonl"
