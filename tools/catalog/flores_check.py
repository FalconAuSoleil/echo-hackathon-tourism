#!/usr/bin/env python3
"""Mesure chrF++ de NLLB-200 distilled 600M sur FLORES-200 devtest, pour eng→kin et fra→kin (référence SPEC 5).

Le score publié pour eng→kin (metrics.csv du modèle) sert à vérifier qu'on reproduit l'évaluation ; fra→kin n'est
pas publié pour ce modèle, d'où la mesure. Résultat : catalog/flores-check.json.
Données : https://dl.fbaipublicfiles.com/nllb/flores200_dataset.tar.gz (CC-BY-SA 4.0), extraites dans tools/cache/.
Usage : .venv/bin/python tools/catalog/flores_check.py [--limit N]
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_kinyarwanda import CACHE, MT_MODEL, ROOT, Translator  # noqa: E402

FLORES = CACHE / "flores200_dataset" / "devtest"


def main() -> None:
    import sacrebleu
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--batch", type=int, default=16)
    args = ap.parse_args()
    ref = (FLORES / "kin_Latn.devtest").read_text(encoding="utf-8").splitlines()
    tr = Translator()
    out = {"model": MT_MODEL, "dataset": "FLORES-200 devtest", "metric": "chrF++ (sacrebleu, word_order=2)",
           "decoding": "beam 4, max 128 new tokens", "directions": {}}
    for src, code in (("en", "eng_Latn"), ("fr", "fra_Latn")):
        lines = (FLORES / f"{code}.devtest").read_text(encoding="utf-8").splitlines()
        n = args.limit or len(lines)
        hyp, t0 = [], time.time()
        for i in range(0, n, args.batch):
            hyp += tr(lines[i:i + args.batch], src, "rw")
            print(f"{code}: {len(hyp)}/{n} ({time.time() - t0:.0f}s)", flush=True)
        chrf = sacrebleu.corpus_chrf(hyp, [ref[:n]], word_order=2)
        out["directions"][f"{code}-kin_Latn"] = {"sentences": n, "chrF++": round(chrf.score, 1), "signature": str(chrf)}
        (CACHE / f"flores-{code}-kin.hyp").write_text("\n".join(hyp) + "\n", encoding="utf-8")
        print(out["directions"][f"{code}-kin_Latn"], flush=True)
    (ROOT / "catalog" / "flores-check.json").write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
