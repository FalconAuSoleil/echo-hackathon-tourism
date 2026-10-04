#!/usr/bin/env python3
"""Produces the demo sample messages of SPEC section 8 as small committed audio files (SYNTHETIC voices).

Output: eval/data/demo-samples/<id>.wav (16 kHz mono PCM16) + eval/data/demo-samples/manifest.json
(transcript, language, voice, license, expected outcome). Re-run with:
  .venv/bin/python tools/tts/synthesize_demo.py
Voices, speakers and speeds were chosen among several candidates for intelligibility with whisper-base
(tools/tts/check_asr.mts), so that the demo shows the pipeline rather than TTS artefacts. Piper samples noise
inside its ONNX graph (not seedable), so each run gives new takes: the script makes --takes random takes per
sample and runs them through the shipped pipeline (tools/tts/check_demo.mts: whisper-base + @echo/core with the
calibrated thresholds, on Node). It keeps a take whose outcome matches the sample's `expected` block, the one
with the lowest whisper-base WER among those (or the lowest WER overall, flagged, if none matches). Needs
`pnpm models:download`; falls back to take 0. This is a deliberate selection for the DEMO only, written in the
manifest; the level-3 evaluation audio is NOT selected that way (voices rotate, speakers are random).
`--only id1,id2` re-takes just those samples and keeps the other files and manifest entries as they are.
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
    # Chemin : « hinauf zur Farm » était mal transcrit par whisper-base (« in Naufzur fahren », « zu fahren ») et la
    # phrase tombait sous le seuil ; « bis hierher » se transcrit bien et reste un constat N1 net (2026-10-04).
    ("de-roasting-path", "de", "de_DE-thorsten-medium", None, 1.1,
     "Das Rösten der Bohnen über dem Feuer hat mir am meisten Spaß gemacht. Aber der Weg vom Dorf bis hierher war viel zu lang.",
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
    # Message hésitant : proche de « visite trop longue » sans l'affirmer (une seule proposition, pour que Whisper ne
    # la coupe pas en deux). Les phrases précédentes ne montraient pas le « pas sûr » une fois transcrites :
    # « c'était particulier… je ne sais pas trop quoi en penser » tombait « hors liste », et « …, enfin je ne sais pas
    # trop » était coupé avant « enfin », la fin seule tombant « hors liste » (2026-10-04).
    # Lent (1.3) : à 1.1 la prise ne durait que 3,1 s, juste au-dessus des 3 s sous lesquelles un message est « inaudible ».
    ("fr-ambiguous", "fr", "fr_FR-upmc-medium", 1, 1.3,
     "Bon, je dirais que c'était peut-être un peu long par moments.",
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


def pick_best_takes(takes: dict[str, list[Path]], meta: dict[str, tuple[str, str, dict]]) -> dict[str, tuple[int, str]]:
    """Fait passer chaque prise par le parcours livré (check_demo.mts) : prise conforme à l'attendu, puis WER minimal."""
    samples = [{"id": f"{sid}#{k}", "file": str(p), "lang": meta[sid][0], "transcript": meta[sid][1], "expected": meta[sid][2]}
               for sid, ps in takes.items() for k, p in enumerate(ps)]
    jf = TAKES_DIR / "takes.json"
    jf.write_text(json.dumps({"samples": samples}, ensure_ascii=False))
    proc = subprocess.run(["npx", "tsx", "../tools/tts/check_demo.mts", str(jf), "--json"],
                          cwd=REPO / "eval", capture_output=True, text=True, timeout=3600)
    rows = [json.loads(l) for l in proc.stdout.splitlines() if l.startswith("{")]
    if not rows:
        print(f"take selection unavailable ({proc.stderr[-300:]}); keeping take 0", file=sys.stderr)
        return {sid: (0, "take 0 (selection unavailable)") for sid in takes}
    best: dict[str, tuple[bool, float, int]] = {}
    for r in rows:
        sid, k = r["id"].rsplit("#", 1)
        cand = (r["ok"], -r["wer"], -int(k))
        print(f"  {r['id']} ok={r['ok']} wer={r['wer']} {'; '.join(r['mismatches'])}")
        if sid not in best or cand > best[sid]:
            best[sid] = cand
    out = {}
    for sid in takes:
        ok, negw, negk = best.get(sid, (False, 0.0, 0))
        n = len(takes[sid])
        why = "matches the expected outcome, lowest whisper-base WER among those" if ok else \
              "NO take matched the expected outcome; lowest whisper-base WER kept"
        out[sid] = (-negk, f"{-negk + 1} of {n} ({why}; checked with tools/tts/check_demo.mts)")
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--takes", type=int, default=4, help="random Piper takes per sample; the most intelligible is kept")
    ap.add_argument("--only", default="", help="comma-separated sample ids to re-take; others are kept as they are")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    only = {x for x in args.only.split(",") if x}
    unknown = only - {s[0] for s in SAMPLES}
    if unknown:
        ap.error(f"unknown sample ids: {sorted(unknown)}")
    previous = {}
    if only and (OUT / "manifest.json").exists():
        previous = {it["id"]: it for it in json.loads((OUT / "manifest.json").read_text())["samples"]}
    todo = [s for s in SAMPLES if not only or s[0] in only]
    takes: dict[str, list[Path]] = {}
    meta = {}
    for sid, lang, voice, spk, ls, text, expected in todo:
        meta[sid] = (lang, text, expected)
        takes[sid] = []
        for k in range(args.takes):
            p = TAKES_DIR / sid / f"take{k}.wav"
            write_wav(p, synthesize(voice, text, spk, ls))
            takes[sid].append(p)
    choice = pick_best_takes(takes, meta) if args.takes > 1 else {sid: (0, "1 of 1") for sid in takes}
    items = []
    for sid, lang, voice, spk, ls, text, expected in SAMPLES:
        if sid not in takes:
            items.append(previous[sid])
            continue
        shutil.copyfile(takes[sid][choice[sid][0]], OUT / f"{sid}.wav")
        import soundfile as sf
        dur = sf.info(str(OUT / f"{sid}.wav")).duration
        items.append({
            "id": sid, "file": f"{sid}.wav", "lang": lang, "transcript": text, "synthetic": True,
            "voice": {"engine": "piper-tts 1.8.0", "model": voice, "speaker": spk, "lengthScale": ls,
                      "license": VOICES[voice]["license"], "dataset": VOICES[voice]["dataset"],
                      "source": f"https://huggingface.co/rhasspy/piper-voices/tree/main/{VOICES[voice]['path']}",
                      "take": choice[sid][1]},
            "durationSec": round(dur, 2),
            "expected": expected,
        })
        print(sid, f"{dur:.1f}s take {choice[sid][0]}")
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
