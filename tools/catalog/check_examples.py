#!/usr/bin/env python3
"""Contrôle de distinction des exemples : plus proche voisin (hors soi-même) avec le modèle de l'app.

Pour chaque exemple, cherche l'exemple le plus similaire parmi tous les autres ; s'il appartient à un autre
constat, la paire est listée. Sert à garder les constats bien séparés (ex. N3 trop longue / N4 trop courte / N1
chemin). Indicatif seulement : ce n'est pas l'évaluation (eval/), qui utilise des retours distincts.
Usage : .venv/bin/python tools/catalog/check_examples.py
"""
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_kinyarwanda import CATALOG, Embedder  # noqa: E402


def main() -> None:
    cat = json.loads(CATALOG.read_text(encoding="utf-8"))
    items = [(f["id"], lang, e) for f in cat["findings"] for lang, ex in f["examples"].items() for e in ex]
    emb = Embedder()
    vecs = []
    for i in range(0, len(items), 64):
        vecs.extend(emb.embed([t for _, _, t in items[i:i + 64]]))
    import numpy as np
    m = np.array(vecs)
    sims = m @ m.T
    np.fill_diagonal(sims, -1)
    nn = sims.argmax(1)
    wrong = [(items[i], items[j], float(sims[i, j])) for i, j in enumerate(nn) if items[i][0] != items[j][0]]
    print(f"{len(items)} examples; nearest neighbour in the same finding: {1 - len(wrong) / len(items):.1%}")
    print("confused pairs by finding:", dict(Counter(f"{a[0]}->{b[0]}" for a, b, _ in wrong).most_common()))
    for a, b, s in sorted(wrong, key=lambda w: -w[2]):
        print(f"  {s:.2f} {a[0]}/{a[1]} {a[2]!r}  ~  {b[0]}/{b[1]} {b[2]!r}")


if __name__ == "__main__":
    main()
