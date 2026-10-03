#!/usr/bin/env python3
"""Builds eval/data/feedback.jsonl (SYNTHETIC, SPEC 9 level 2) from the authored sources in eval/data/src/.

Validates every annotation (span is an exact substring, labels known, corpus composition) and derives the flags.
Stdlib only. Usage: python3 eval/data/build_feedback.py [--check]  (--check: validate, do not write)
"""
from __future__ import annotations

import importlib.util
import json
import re
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "feedback.jsonl"
LANGS = ["en", "fr", "de", "es"]
FINDINGS = [f"P{i}" for i in range(1, 12)] + [f"N{i}" for i in range(1, 11)]
GUIDE_RE = re.compile(r"\b(guide|guía|guia|guides|übersetzer|traductor|translat\w*|tradu\w*|übersetz\w*)\b", re.I)


def load(lang: str) -> list[tuple]:
    spec = importlib.util.spec_from_file_location(f"fb_{lang}", HERE / "src" / f"fb_{lang}.py")
    mod = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    assert mod.LANG == lang
    return mod.DATA


def length_class(text: str) -> str:
    n = len(text.split())
    if n <= 3:
        return "very_short"
    if n <= 8:
        return "short"
    if n >= 40:
        return "long"
    return "medium"


def build() -> tuple[list[dict], list[str]]:
    errors: list[str] = []
    records: list[dict] = []
    for lang in LANGS:
        for i, (text, labels, flags) in enumerate(load(lang), start=1):
            rid = f"{lang}-{i:03d}"
            chunks = []
            for label, span in labels:
                if span not in text:
                    errors.append(f"{rid}: span not in text: {span!r}")
                kind, finding, topic, negates = None, None, None, None
                if label in FINDINGS:
                    kind, finding = "finding", label
                elif label == "NS":
                    kind = "not_sure"
                elif label.startswith("OFF:"):
                    kind, topic = "off_list", label[4:]
                elif label.startswith("NEG:") and label[4:] in FINDINGS:
                    kind, negates = "negated", label[4:]
                else:
                    errors.append(f"{rid}: unknown label {label}")
                c = {"span": span, "kind": kind}
                if finding:
                    c["finding"] = finding
                if topic:
                    c["topic"] = topic
                if negates:
                    c["negates"] = negates
                chunks.append(c)
            found = sorted({c["finding"] for c in chunks if c["kind"] == "finding"}, key=FINDINGS.index)
            topics = sorted({c["topic"] for c in chunks if c["kind"] == "off_list"})
            neg_cancel = sorted({c["negates"] for c in chunks if c["kind"] == "negated"})
            negation = "cancels" if neg_cancel else ("inherent" if "i" in flags else None)
            rec = {
                "id": rid,
                "lang": lang,
                "text": text,
                "synthetic": True,
                "expectedFindings": found,
                "mustNotFindings": [f for f in neg_cancel if f not in found],
                "chunks": chunks,
                "flags": {
                    "negation": negation,
                    "multiFinding": len(found) >= 2,
                    "typo": "t" in flags,
                    "length": length_class(text),
                    "offList": bool(topics),
                    "offListTopics": topics,
                    "ambiguous": any(c["kind"] == "not_sure" for c in chunks),
                    "picking": "picking" in topics,
                    "mentionsGuide": bool(GUIDE_RE.search(text)),
                },
            }
            if not chunks:
                errors.append(f"{rid}: no annotation")
            records.append(rec)
    # composition (SPEC 9 level 2)
    n = len(records)
    if not 150 <= n <= 300:
        errors.append(f"size {n} not in 150..300")
    per_lang = Counter(r["lang"] for r in records)
    if max(per_lang.values()) - min(per_lang.values()) > 5:
        errors.append(f"unbalanced languages {dict(per_lang)}")
    picking = [r for r in records if r["flags"]["picking"]]
    if sorted(r["lang"] for r in picking) != ["de", "en", "fr"]:
        errors.append(f"picking must be exactly en, de, fr: {[r['id'] for r in picking]}")
    # aucun autre sujet hors liste ne doit revenir chez 3 visiteurs (sinon faux signal attendu)
    topic_count = Counter(t for r in records for t in r["flags"]["offListTopics"] if t != "picking")
    for t, k in topic_count.items():
        if k >= 3:
            errors.append(f"off-list topic {t} appears {k} times (would be a true recurring signal)")
    for f in FINDINGS:
        k = sum(f in r["expectedFindings"] for r in records)
        if k < 6:
            errors.append(f"finding {f} only in {k} feedbacks")
    return records, errors


def stats(records: list[dict]) -> dict:
    n = len(records)
    fl = [r["flags"] for r in records]
    return {
        "total": n,
        "perLanguage": dict(Counter(r["lang"] for r in records)),
        "offListMessages": sum(f["offList"] for f in fl),
        "offListOnlyMessages": sum(1 for r in records if r["flags"]["offList"] and not r["expectedFindings"]),
        "ambiguous": sum(f["ambiguous"] for f in fl),
        "picking": sum(f["picking"] for f in fl),
        "negationCancels": sum(f["negation"] == "cancels" for f in fl),
        "negationInherent": sum(f["negation"] == "inherent" for f in fl),
        "multiFinding": sum(f["multiFinding"] for f in fl),
        "typo": sum(f["typo"] for f in fl),
        "length": dict(Counter(f["length"] for f in fl)),
        "mentionsGuide": sum(f["mentionsGuide"] for f in fl),
        "perFinding": {f: sum(f in r["expectedFindings"] for r in records) for f in FINDINGS},
        "chunks": dict(Counter(c["kind"] for r in records for c in r["chunks"])),
    }


def main() -> int:
    records, errors = build()
    print(json.dumps(stats(records), ensure_ascii=False, indent=1))
    if errors:
        print("\n".join("ERROR " + e for e in errors), file=sys.stderr)
        return 1
    if "--check" not in sys.argv:
        with OUT.open("w", encoding="utf-8") as f:
            for r in records:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        print(f"wrote {OUT} ({len(records)} feedbacks)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
