#!/usr/bin/env python3
"""Mixes outdoor ambient noise (ESC-50 subset, see fetch_noise.py) into the SYNTHETIC level-3 speech at several SNRs.

For each row of eval/data/audio_manifest.jsonl (deterministic per feedback id):
  - one continuous ambience (rain, wind, birds, crickets, insects, fire, engine), clips concatenated to length,
  - optionally one sparse farm event (rooster, hen, cow, dog, footsteps) 6 dB below the ambience,
  - 0.4 s of noise before and after the speech (like a real voice note),
  - SNR computed on active speech frames (20 ms frames above max-40 dB) vs. the whole noise track,
  - the same noise segment for every SNR, only its gain changes.
Output (git-ignored): eval/data/generated/audio/snr{20,10,5}/<id>.wav; the manifest gets "noise" and "noisy".
Usage: .venv/bin/python tools/datasets/mix_noise.py [--snr 20 10 5]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import random
import subprocess
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

REPO = Path(__file__).resolve().parents[2]
MANIFEST = REPO / "eval" / "data" / "audio_manifest.jsonl"
NOISE_DIR = REPO / "datasets" / "noise" / "esc50"
OUT = REPO / "eval" / "data" / "generated" / "audio"
SR = 16000
AMBIENT = ["rain", "wind", "chirping_birds", "crickets", "insects", "crackling_fire", "engine"]
EVENTS = ["rooster", "hen", "cow", "dog", "footsteps"]
PAD = 0.4


def load16k(path: Path) -> np.ndarray:
    out = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(path), "-ac", "1", "-ar", str(SR), "-f", "f32le", "pipe:1"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(out, dtype=np.float32).copy()


def active_power(x: np.ndarray) -> float:
    frame = SR // 50
    n = len(x) // frame
    if n == 0:
        return float(np.mean(x ** 2) + 1e-12)
    e = (x[: n * frame].reshape(n, frame) ** 2).mean(axis=1)
    thr = e.max() * 1e-4  # -40 dB
    return float(e[e > thr].mean() + 1e-12)


def track(clips: list[dict], length: int, rng: random.Random) -> np.ndarray:
    parts, total = [], 0
    while total < length:
        c = rng.choice(clips)
        a = load16k(REPO / c["file"])
        nz = np.flatnonzero(np.abs(a) > 1e-4)
        if len(nz):
            a = a[nz[0]: nz[-1] + 1]
        parts.append(a)
        total += len(a)
    return np.concatenate(parts)[:length]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--snr", type=int, nargs="+", default=[20, 10, 5])
    args = ap.parse_args()
    nm = json.loads((NOISE_DIR / "noise_manifest.json").read_text())
    by_cat: dict[str, list[dict]] = {}
    for c in nm["clips"]:
        by_cat.setdefault(c["category"], []).append(c)
    rows = [json.loads(l) for l in MANIFEST.read_text(encoding="utf-8").splitlines() if l.strip()]
    for row in rows:
        seed = int(hashlib.sha1(row["id"].encode()).hexdigest()[:8], 16)
        rng = random.Random(seed)
        speech, sr = sf.read(str(REPO / row["clean"]), dtype="float32")
        assert sr == SR
        pad = np.zeros(int(PAD * SR), dtype=np.float32)
        s = np.concatenate([pad, speech, pad])
        amb_cat = rng.choice([c for c in AMBIENT if c in by_cat])
        amb_clips = by_cat[amb_cat]
        rng_amb = random.Random(seed + 1)
        noise = track(amb_clips, len(s), rng_amb)
        noise = noise / np.sqrt(np.mean(noise ** 2) + 1e-12)
        used = sorted({c["file"] for c in amb_clips})
        event_cat = None
        if rng.random() < 0.5:
            event_cat = rng.choice([c for c in EVENTS if c in by_cat])
            ev = track(by_cat[event_cat], len(s), random.Random(seed + 2))
            ev = ev / np.sqrt(np.mean(ev ** 2) + 1e-12) * 10 ** (-6 / 20)
            noise = noise + ev
            used += sorted({c["file"] for c in by_cat[event_cat]})
        ps = active_power(speech)
        pn = float(np.mean(noise ** 2))
        noisy = {}
        for snr in args.snr:
            g = np.sqrt(ps / (pn * 10 ** (snr / 10)))
            mix = s + g * noise
            peak = np.max(np.abs(mix))
            if peak > 0.99:
                mix = mix * (0.99 / peak)
            rel = OUT.relative_to(REPO) / f"snr{snr}" / f"{row['id']}.wav"
            (REPO / rel).parent.mkdir(parents=True, exist_ok=True)
            sf.write(str(REPO / rel), mix, SR, subtype="PCM_16")
            noisy[str(snr)] = str(rel)
        info = {c["file"]: c for c in nm["clips"]}
        row["noise"] = {
            "source": "ESC-50 (https://github.com/karolpiczak/ESC-50)",
            "ambience": amb_cat,
            "event": event_cat,
            "padSec": PAD,
            "clipPool": [{"file": f, "datasetLicense": info[f]["datasetLicense"], "sourceLicense": info[f]["sourceLicense"],
                          "author": info[f]["author"], "sourceUrl": info[f]["sourceUrl"]} for f in used],
        }
        row["noisy"] = noisy
        print(f"{row['id']} {amb_cat}+{event_cat}", flush=True)
    with MANIFEST.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(f"mixed {len(rows)} feedbacks at SNR {args.snr} dB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
