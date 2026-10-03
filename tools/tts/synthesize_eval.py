#!/usr/bin/env python3
"""Level 3 (SPEC 9): turns a stratified, deterministic selection of the SYNTHETIC feedbacks of
eval/data/feedback.jsonl into SYNTHETIC speech with varied Piper voices, speakers and speeds.

Output (git-ignored, re-creatable): eval/data/generated/audio/clean/<id>.wav (16 kHz mono PCM16)
Manifest (committed):              eval/data/audio_manifest.jsonl (voice, speaker, speed, licenses; the noise
                                    fields are filled by tools/datasets/mix_noise.py)

Usage: .venv/bin/python tools/tts/synthesize_eval.py [--count 80] [--seed 7] [--force]
Everything is deterministic for a given seed: re-running gives the same selection and the same voices.
"""
from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from synth import num_speakers, synthesize, voices_for, write_wav  # noqa: E402
from voices import VOICES  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
FEEDBACK = REPO / "eval" / "data" / "feedback.jsonl"
MANIFEST = REPO / "eval" / "data" / "audio_manifest.jsonl"
OUT = REPO / "eval" / "data" / "generated" / "audio" / "clean"
LANGS = ["en", "fr", "de", "es"]
# length_scale > 1 = parole plus lente ; speed = 1 / length_scale
LENGTH_SCALES = [0.8, 0.9, 1.0, 1.0, 1.1, 1.25]


def select(records: list[dict], count: int, rng: random.Random) -> list[dict]:
    per_lang = count // len(LANGS)
    chosen: list[dict] = []
    for lang in LANGS:
        pool = [r for r in records if r["lang"] == lang]
        rng.shuffle(pool)
        picked: list[dict] = []

        def take(pred, k):
            for r in pool:
                if len([x for x in picked if pred(x)]) >= k:
                    break
                if pred(r) and r not in picked:
                    picked.append(r)

        take(lambda r: r["flags"]["picking"], 1)
        take(lambda r: r["flags"]["negation"] == "cancels", 3)
        take(lambda r: r["flags"]["negation"] == "inherent", 2)
        take(lambda r: r["flags"]["ambiguous"], 2)
        take(lambda r: r["flags"]["offList"] and not r["flags"]["picking"], 2)
        take(lambda r: r["flags"]["length"] == "long", 1)
        take(lambda r: r["flags"]["length"] == "very_short", 2)
        take(lambda r: r["flags"]["multiFinding"], 4)
        take(lambda r: r["flags"]["typo"], 2)
        for r in pool:
            if len(picked) >= per_lang:
                break
            if r not in picked:
                picked.append(r)
        chosen.extend(sorted(picked[:per_lang], key=lambda r: r["id"]))
    return chosen


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=80)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--force", action="store_true", help="re-synthesise even if the wav exists")
    ap.add_argument("--manifest-only", action="store_true", help="write the manifest without synthesising")
    args = ap.parse_args()
    if not 60 <= args.count <= 100:
        print("SPEC 9: 60 to 100 feedbacks", file=sys.stderr)
        return 2

    records = [json.loads(l) for l in FEEDBACK.read_text(encoding="utf-8").splitlines() if l.strip()]
    rng = random.Random(args.seed)
    chosen = select(records, args.count, rng)
    old = {}
    if MANIFEST.exists():
        for l in MANIFEST.read_text(encoding="utf-8").splitlines():
            if l.strip():
                row = json.loads(l)
                old[row["id"]] = row

    rows = []
    for i, r in enumerate(chosen):
        lang_voices = voices_for(r["lang"])
        key = lang_voices[i % len(lang_voices)]
        n_spk = VOICES[key]["speakers"]
        speaker = rng.randrange(n_spk) if n_spk > 1 else None
        ls = rng.choice(LENGTH_SCALES)
        rel = OUT.relative_to(REPO) / f"{r['id']}.wav"
        path = REPO / rel
        stale = r["id"] in old and old[r["id"]].get("text") != r["text"]  # texte modifié depuis la synthèse
        if not args.manifest_only and (args.force or stale or not path.exists()):
            if n_spk > 1:
                assert num_speakers(key) == n_spk, key
            pcm = synthesize(key, r["text"], speaker, ls)
            write_wav(path, pcm)
            print(f"{r['id']} {key} spk={speaker} ls={ls} {len(pcm) / 16000:.1f}s", flush=True)
        dur = None
        if path.exists():
            import soundfile as sf
            dur = round(sf.info(str(path)).duration, 2)
        prev = old.get(r["id"], {})
        rows.append({
            "id": r["id"],
            "lang": r["lang"],
            "text": r["text"],
            "synthetic": True,
            "expectedFindings": r["expectedFindings"],
            "flags": r["flags"],
            "tts": {
                "engine": "piper-tts 1.8.0",
                "voice": key,
                "speaker": speaker,
                "lengthScale": ls,
                "speed": round(1 / ls, 3),
                "voiceLicense": VOICES[key]["license"],
                "voiceDataset": VOICES[key]["dataset"],
                "voiceSource": f"https://huggingface.co/rhasspy/piper-voices/tree/main/{VOICES[key]['path']}",
            },
            "durationSec": dur,
            "clean": str(rel),
            "noisy": prev.get("noisy", {}),
            "noise": prev.get("noise"),
        })
    with MANIFEST.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(f"wrote {MANIFEST} ({len(rows)} rows)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
