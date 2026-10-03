#!/usr/bin/env python3
"""Produces the demo sample messages of SPEC section 8 as small committed audio files (SYNTHETIC voices).

Output: eval/data/demo-samples/<id>.wav (16 kHz mono PCM16) + eval/data/demo-samples/manifest.json
(transcript, language, voice, license, expected outcome). Re-run with:
  .venv/bin/python tools/tts/synthesize_demo.py
Voices, speakers and speeds were chosen among several candidates for intelligibility with whisper-base
(tools/tts/check_asr.mts), so that the demo shows the pipeline rather than TTS artefacts. Piper samples noise
inside its ONNX graph (not seedable), so each run gives new takes: the script makes --takes random takes per
sample and keeps the one with the lowest whisper-base WER (needs `pnpm models:download`; falls back to take 0). The level-3 evaluation
audio is NOT selected that way (voices rotate, speakers are random).
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from synth import TARGET_SR, synthesize, write_wav  # noqa: E402
from voices import VOICES  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "eval" / "data" / "demo-samples"

# (id, lang, voice, speaker, length_scale, transcript, expected)
SAMPLES = [
    ("de-roasting-path", "de", "de_DE-thorsten-medium", None, 1.1,
     "Das Rösten der Bohnen über dem Feuer hat mir am meisten Spaß gemacht. Aber der Weg vom Dorf hinauf zur Farm war wirklich viel zu lang.",
     {"status": "analyzed", "findings": ["P3", "N1"], "notSure": False,
      "note": "SPEC 8: German, roasting appreciated + path too long"}),
    ("en-prices-buy", "en", "en_US-libritts_r-medium", 3, 1.0,
     "We only found out what the visit cost at the very end, it should be said earlier. And I would really love to buy a bag of your coffee to take home.",
     {"status": "analyzed", "findings": ["N2", "P9"], "notSure": False,
      "note": "SPEC 8: English, unclear prices + wants to buy coffee"}),
    ("fr-welcome-meal", "fr", "fr_FR-siwis-medium", None, 1.0,
     "Merci pour cet accueil si chaleureux, on s'est sentis attendus. Et le repas préparé par la famille était vraiment délicieux.",
     {"status": "analyzed", "findings": ["P1", "P4"], "notSure": False,
      "note": "SPEC 8: French, welcome + meal"}),
    ("es-visit-too-long", "es", "es_ES-davefx-medium", None, 1.0,
     "La visita duró demasiado. Después de casi cuatro horas de pie estábamos agotados.",
     {"status": "analyzed", "findings": ["N3"], "notSure": False,
      "note": "SPEC 8: Spanish, visit too long"}),
    ("en-negation", "en", "en_GB-vctk-medium", 10, 1.0,
     "The walk up to the farm was not too long at all, honestly it was fine.",
     {"status": "analyzed", "findings": [], "mustNot": ["N1"], "notSure": "allowed",
      "note": "SPEC 7/8: negation, must NOT give N1 (path too long); not sure is acceptable"}),
    ("fr-ambiguous", "fr", "fr_FR-upmc-medium", 1, 1.1,
     "Bon, c'était particulier, comme expérience. Honnêtement, je ne sais pas trop quoi en penser.",
     {"status": "analyzed", "findings": [], "notSure": True,
      "note": "SPEC 8: ambiguous, must end in not sure (ask a person)"}),
    ("en-picking", "en", "en_US-libritts_r-medium", 40, 1.05,
     "I wish we could have picked some of the ripe red coffee cherries ourselves during the harvest.",
     {"status": "analyzed", "findings": [], "offList": True, "topic": "picking",
      "note": "SPEC 8: picking 1/3, off-list; with the two others: unknown recurring topic signal (3 visitors)"}),
    ("de-picking", "de", "de_DE-thorsten_emotional-medium", 1, 1.0,
     "Wir hätten so gern selbst bei der Ernte geholfen und ein paar Kaffeekirschen vom Strauch gepflückt.",
     {"status": "analyzed", "findings": [], "offList": True, "topic": "picking",
      "note": "SPEC 8: picking 2/3"}),
    ("fr-picking", "fr", "fr_FR-upmc-medium", 0, 1.1,
     "On aurait aimé participer à la cueillette, ramasser nous-mêmes les grains de café mûrs sur les arbustes.",
     {"status": "analyzed", "findings": [], "offList": True, "topic": "picking",
      "note": "SPEC 8: picking 3/3"}),
]
INAUDIBLE = ("inaudible-noise", {"status": "inaudible", "findings": [],
                                 "note": "SPEC 7/8: 1.6 s of faint generated noise, under the 3 s minimum: inaudible, not counted"})


def brown_noise(seconds: float, rms: float, seed: int = 3) -> np.ndarray:
    rng = np.random.default_rng(seed)
    x = np.cumsum(rng.standard_normal(int(seconds * TARGET_SR)))
    x = x - np.convolve(x, np.ones(800) / 800, mode="same")  # retire la dérive basse fréquence
    x = x / (np.sqrt(np.mean(x ** 2)) + 1e-9) * rms
    fade = np.linspace(0, 1, 800)
    x[:800] *= fade
    x[-800:] *= fade[::-1]
    return (x * 32767).astype(np.int16)


TAKES_DIR = REPO / "eval" / "data" / "generated" / "demo-takes"


def pick_best_takes(takes: dict[str, list[Path]], texts: dict[str, tuple[str, str]]) -> dict[str, int]:
    """Transcrit chaque prise avec whisper-base (adaptateur de l'app) et garde la prise au WER le plus bas."""
    rows = [{"id": f"{sid}#{k}", "lang": texts[sid][0], "text": texts[sid][1], "clean": str(p)}
            for sid, ps in takes.items() for k, p in enumerate(ps)]
    jl = TAKES_DIR / "takes.jsonl"
    jl.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n")
    try:
        out = subprocess.run(["npx", "tsx", "../tools/tts/check_asr.mts", str(jl), "clean", "onnx-community/whisper-base"],
                             cwd=REPO / "eval", capture_output=True, text=True, check=True, timeout=1800).stdout
    except (subprocess.SubprocessError, OSError) as e:
        print(f"ASR selection unavailable ({e}); keeping take 0", file=sys.stderr)
        return {sid: 0 for sid in takes}
    best: dict[str, tuple[float, int]] = {}
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) >= 5 and parts[4].startswith("wer=") and "#" in parts[0]:
            sid, k = parts[0].rsplit("#", 1)
            w = float(parts[4][4:])
            if sid not in best or w < best[sid][0]:
                best[sid] = (w, int(k))
            print(f"  {parts[0]} {parts[4]} {parts[-1]}")
    return {sid: best.get(sid, (0.0, 0))[1] for sid in takes}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--takes", type=int, default=4, help="random Piper takes per sample; the most intelligible is kept")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    takes: dict[str, list[Path]] = {}
    texts = {}
    for sid, lang, voice, spk, ls, text, _ in SAMPLES:
        texts[sid] = (lang, text)
        takes[sid] = []
        for k in range(args.takes):
            p = TAKES_DIR / sid / f"take{k}.wav"
            write_wav(p, synthesize(voice, text, spk, ls))
            takes[sid].append(p)
    choice = pick_best_takes(takes, texts) if args.takes > 1 else {sid: 0 for sid in takes}
    items = []
    for sid, lang, voice, spk, ls, text, expected in SAMPLES:
        shutil.copyfile(takes[sid][choice[sid]], OUT / f"{sid}.wav")
        import soundfile as sf
        dur = sf.info(str(OUT / f"{sid}.wav")).duration
        items.append({
            "id": sid, "file": f"{sid}.wav", "lang": lang, "transcript": text, "synthetic": True,
            "voice": {"engine": "piper-tts 1.8.0", "model": voice, "speaker": spk, "lengthScale": ls,
                      "license": VOICES[voice]["license"], "dataset": VOICES[voice]["dataset"],
                      "source": f"https://huggingface.co/rhasspy/piper-voices/tree/main/{VOICES[voice]['path']}",
                      "take": f"{choice[sid] + 1} of {args.takes} (lowest whisper-base WER)"},
            "durationSec": round(dur, 2),
            "expected": expected,
        })
        print(sid, f"{dur:.1f}s take {choice[sid]}")
    sid, expected = INAUDIBLE
    pcm = brown_noise(1.6, 0.01)
    write_wav(OUT / f"{sid}.wav", pcm)
    items.append({"id": sid, "file": f"{sid}.wav", "lang": None, "transcript": "", "synthetic": True,
                  "voice": None, "generator": "numpy brown noise (seed 3), no third-party audio",
                  "durationSec": round(len(pcm) / TARGET_SR, 2), "expected": expected})
    manifest = {
        "description": "Demo sample messages of SPEC section 8. SYNTHETIC voices (Piper TTS), not real visitors. "
                       "Label them 'synthetic voice' in the UI.",
        "synthetic": True,
        "sampleRate": TARGET_SR,
        "recurringUnknownTopic": {"ids": ["en-picking", "de-picking", "fr-picking"], "expectedVisitors": 3},
        "samples": items,
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {len(items)} samples to {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
