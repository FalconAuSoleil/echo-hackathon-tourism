#!/usr/bin/env python3
"""Downloads a small subset of outdoor ambient sounds from ESC-50 (K. J. Piczak, 2015) for the level-3 noise mix.

Source:  https://github.com/karolpiczak/ESC-50 (clips fetched one by one from the GitHub repository)
License: ESC-50 as a whole CC BY-NC 3.0; ESC-10 subset (rain, rooster, dog, crackling fire...) CC BY 3.0.
         Each clip is derived from a Freesound recording whose own license (CC0 / CC-BY / CC-BY-NC) is listed in
         the ESC-50 LICENSE file; we keep only clips whose Freesound source is CC0 or CC-BY, and record both
         licenses and the attribution per clip in datasets/noise/esc50/noise_manifest.json.
Use:     non-commercial evaluation only (never shipped in the app).
Output:  datasets/noise/esc50/*.wav (git-ignored). Usage: python3 tools/datasets/fetch_noise.py [--per-class 4]
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import re
import sys
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "datasets" / "noise" / "esc50"
RAW = "https://raw.githubusercontent.com/karolpiczak/ESC-50/master"
MEDIA = "https://github.com/karolpiczak/ESC-50/raw/master/audio"
# Ambiances extérieures plausibles autour d'une ferme ; pas de classes contenant de la voix humaine.
CLASSES = ["rain", "wind", "chirping_birds", "crickets", "insects", "rooster", "hen", "cow", "dog",
           "crackling_fire", "engine", "footsteps"]


def get(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read()


def parse_license(text: str) -> dict[str, dict]:
    """[1-100032-A.ogg]: clip derived from X (url) by author [CC0] -> {"1-100032-A": {...}}"""
    out = {}
    rx = re.compile(r"^- \[(?P<clip>[^\]]+)\.ogg\]:\s+clip derived from (?P<title>.*) \((?P<url>http[^)]*)\) by (?P<author>.*) \[(?P<lic>[^\]]+)\]\s*$")
    for line in text.splitlines():
        m = rx.match(line.strip())
        if m:
            out[m["clip"]] = {"sourceTitle": m["title"], "sourceUrl": m["url"], "author": m["author"],
                              "sourceLicense": m["lic"]}
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-class", type=int, default=4)
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    meta = list(csv.DictReader(io.StringIO(get(f"{RAW}/meta/esc50.csv").decode())))
    lic = parse_license(get(f"{RAW}/LICENSE").decode())
    import numpy as np
    import soundfile as sf

    clips = []
    for cls in CLASSES:
        rows = sorted((r for r in meta if r["category"] == cls), key=lambda r: r["filename"])
        kept = 0
        for r in rows:
            if kept >= args.per_class:
                break
            stem = r["filename"].rsplit("-", 1)[0]  # 1-100032-A-0.wav -> 1-100032-A
            info = lic.get(stem)
            if not info or info["sourceLicense"] not in ("CC0", "CC-BY"):
                continue
            path = OUT / r["filename"]
            if not path.exists():
                data = get(f"{MEDIA}/{r['filename']}")
                path.write_bytes(data)
            audio, sr = sf.read(str(path), dtype="float32")
            if audio.ndim > 1:
                audio = audio.mean(axis=1)
            active = float(np.mean(np.abs(audio) > 1e-4))
            if active < 0.6:  # clip trop rembourré de silence numérique
                continue
            esc10 = r["esc10"] == "True"
            clips.append({
                "file": str(path.relative_to(REPO)),
                "category": cls,
                "esc10": esc10,
                "datasetLicense": "CC-BY-3.0" if esc10 else "CC-BY-NC-3.0",
                **info,
                "durationSec": round(len(audio) / sr, 2),
                "sampleRate": sr,
            })
            kept += 1
        print(f"{cls}: {kept} clips", flush=True)
    manifest = {
        "dataset": "ESC-50: Dataset for Environmental Sound Classification (Piczak, ACM MM 2015)",
        "url": "https://github.com/karolpiczak/ESC-50",
        "doi": "https://dx.doi.org/10.7910/DVN/YDEPUT",
        "license": "CC BY-NC 3.0 (ESC-10 subset: CC BY 3.0); per-clip Freesound source license listed",
        "selection": "outdoor classes, Freesound source CC0 or CC-BY only, clips with < 40% digital silence",
        "clips": clips,
    }
    (OUT / "noise_manifest.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False))
    print(f"{len(clips)} clips in {OUT}")
    return 0 if clips else 1


if __name__ == "__main__":
    sys.exit(main())
