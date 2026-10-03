#!/usr/bin/env python3
"""Checks that the synthetic evaluation feedback is strictly disjoint from the catalog examples (SPEC 9 level 2).

Every feedback sentence and every annotated span is compared with every catalog example of the same language
(and, more loosely, of any language: identical strings). A pair is reported when, after normalisation
(lower case, accents folded, punctuation removed):
  - the strings are equal, or
  - difflib similarity ratio >= 0.85, or
  - token Jaccard >= 0.8 with at least 3 tokens on both sides, or
  - one contains the other and the shorter has at least 4 tokens.
Exit code 1 when a near-duplicate is found, 0 otherwise (also 0, with a notice, when the catalog has no examples).
Stdlib only. Usage: python3 eval/data/check_disjoint.py [--catalog catalog/catalog.json] [--feedback eval/data/feedback.jsonl]
"""
from __future__ import annotations

import argparse
import difflib
import json
import re
import sys
import unicodedata
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s.lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.replace("ß", "ss")
    s = re.sub(r"[^\w\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def sentences(text: str) -> list[str]:
    return [p for p in re.split(r"(?<=[.!?¡¿])\s+", text) if p.strip()]


def near(a: str, b: str) -> str | None:
    if not a or not b:
        return None
    if a == b:
        return "identical"
    ta, tb = a.split(), b.split()
    short, long_ = (a, b) if len(ta) <= len(tb) else (b, a)
    if len(short.split()) >= 4 and f" {short} " in f" {long_} ":
        return "contained"
    if difflib.SequenceMatcher(None, a, b).ratio() >= 0.85:
        return "ratio>=0.85"
    sa, sb = set(ta), set(tb)
    if len(sa) >= 3 and len(sb) >= 3 and len(sa & sb) / len(sa | sb) >= 0.8:
        return "jaccard>=0.8"
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", default=str(REPO / "catalog" / "catalog.json"))
    ap.add_argument("--feedback", default=str(REPO / "eval" / "data" / "feedback.jsonl"))
    args = ap.parse_args()

    catalog = json.loads(Path(args.catalog).read_text(encoding="utf-8"))
    examples: list[tuple[str, str, str, str]] = []  # (lang, finding, raw, normalised)
    for f in catalog.get("findings", []):
        for lang, items in (f.get("examples") or {}).items():
            for ex in items or []:
                examples.append((lang, f["id"], ex, norm(ex)))
    if not examples:
        print("catalog has no examples yet: nothing to compare (re-run once catalog/catalog.json is filled)")
        return 0

    hits = []
    n_units = 0
    for line in Path(args.feedback).read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        r = json.loads(line)
        units = set(sentences(r["text"])) | {c["span"] for c in r["chunks"]} | {r["text"]}
        for u in units:
            nu = norm(u)
            n_units += 1
            for lang, fid, raw, ne in examples:
                why = near(nu, ne) if lang == r["lang"] else ("identical" if nu == ne else None)
                if why:
                    hits.append((r["id"], u, fid, lang, raw, why))
    print(f"compared {n_units} feedback units with {len(examples)} catalog examples")
    for rid, u, fid, lang, raw, why in hits:
        print(f"NEAR-DUPLICATE {rid}: {u!r}  ~  catalog {fid}/{lang}: {raw!r}  ({why})")
    if hits:
        print(f"{len(hits)} near-duplicate pair(s): rewrite the feedback or the catalog example", file=sys.stderr)
        return 1
    print("OK: evaluation feedback is disjoint from catalog examples")
    return 0


if __name__ == "__main__":
    sys.exit(main())
