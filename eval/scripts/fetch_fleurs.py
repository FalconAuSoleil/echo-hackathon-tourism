"""Télécharge FLEURS (google/fleurs, CC BY 4.0) pour le niveau 1 de l'évaluation (SPEC 9).

Le chargeur par script de `google/fleurs` n'est plus pris en charge par `datasets` 4+ : on lit les fichiers
parquet de la branche `refs/convert/parquet` (conversion automatique du hub), split `test`.
Échantillon fixe : N énoncés par langue tirés au hasard avec une graine (défaut 100, graine 20261004),
écrits en WAV 16 kHz mono dans datasets/fleurs/<lang>/ + manifest.jsonl (git-ignorés, recréables).

Usage : .venv/bin/python eval/scripts/fetch_fleurs.py [--n 100] [--langs en,fr,de,es,sw]
"""
import argparse, io, json, random, sys
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq
import soundfile as sf
from huggingface_hub import hf_hub_download

ROOT = Path(__file__).resolve().parents[2]
CONFIGS = {"en": "en_us", "fr": "fr_fr", "de": "de_de", "es": "es_419", "sw": "sw_ke"}
SEED = 20261004


def resample(x: np.ndarray, sr: int) -> np.ndarray:
    if sr == 16000:
        return x.astype(np.float32)
    n = int(round(len(x) * 16000 / sr))
    return np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=100)
    ap.add_argument("--langs", default="en,fr,de,es,sw")
    a = ap.parse_args()
    for lang in a.langs.split(","):
        cfg = CONFIGS[lang]
        out = ROOT / "datasets" / "fleurs" / lang
        man = out / "manifest.jsonl"
        if man.exists() and sum(1 for _ in open(man)) >= a.n:
            print(f"[{lang}] déjà présent ({man})")
            continue
        out.mkdir(parents=True, exist_ok=True)
        print(f"[{lang}] téléchargement {cfg}/test/0000.parquet …", flush=True)
        path = hf_hub_download("google/fleurs", f"{cfg}/test/0000.parquet", repo_type="dataset",
                               revision="refs/convert/parquet", cache_dir=str(ROOT / "datasets" / "hf-cache"))
        pf = pq.ParquetFile(path)
        meta = pf.read(columns=["id", "transcription", "raw_transcription", "gender", "num_samples"]).to_pylist()
        # Un énoncé FLEURS (id) est lu par plusieurs locuteurs : on tire des lignes, en évitant deux fois la même phrase.
        idx = list(range(len(meta)))
        random.Random(SEED).shuffle(idx)
        chosen, seen = [], set()
        for i in idx:
            if meta[i]["id"] in seen:
                continue
            seen.add(meta[i]["id"])
            chosen.append(i)
            if len(chosen) == a.n:
                break
        chosen_set = set(chosen)
        rows = {}
        offset = 0
        for rg in range(pf.num_row_groups):
            t = pf.read_row_group(rg, columns=["audio"]).to_pylist()
            for j, r in enumerate(t):
                if offset + j in chosen_set:
                    rows[offset + j] = r["audio"]
            offset += len(t)
        with open(man, "w") as f:
            for k, i in enumerate(chosen):
                aud = rows[i]
                x, sr = sf.read(io.BytesIO(aud["bytes"]), dtype="float32")
                if x.ndim > 1:
                    x = x.mean(axis=1)
                x = resample(x, sr)
                name = f"{lang}-{k:03d}.wav"
                sf.write(out / name, x, 16000, subtype="PCM_16")
                m = meta[i]
                f.write(json.dumps({"key": f"{lang}-{k:03d}", "lang": lang, "fleursId": m["id"], "row": i,
                                    "file": f"datasets/fleurs/{lang}/{name}", "durationSec": round(len(x) / 16000, 3),
                                    "transcription": m["transcription"], "rawTranscription": m["raw_transcription"],
                                    "gender": m["gender"]}, ensure_ascii=False) + "\n")
        print(f"[{lang}] {len(chosen)} énoncés écrits dans {out} (sur {len(meta)} lignes test)", flush=True)


if __name__ == "__main__":
    sys.exit(main())
