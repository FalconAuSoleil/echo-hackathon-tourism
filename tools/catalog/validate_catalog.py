#!/usr/bin/env python3
"""Valide catalog/catalog.json : schéma JSON (catalog/catalog.schema.json) + règles de SPEC 5.

Règles vérifiées en plus du schéma :
- 21 constats, 8 à 10 exemples synthétiques par langue visiteur, aucun exemple en double (même entre constats) ;
- chaque phrase kinyarwanda : non vide, statut « non validée », rétro-traductions fr et en, score présent ;
- emplacements : ceux du modèle présents exactement une fois dans le kinyarwanda, aucun chiffre en dur,
  {finding} en fin de ligne pour les modèles qui l'utilisent, aucun emplacement dans les phrases de constat ;
- audio : chaque fichier référencé existe, n'est pas vide ; audioParts = une entrée par partie fixe autour des emplacements ;
  nombres 0..31 présents avec leur clip ;
- aucun mot de la source anglaise ou française recopié tel quel dans le kinyarwanda (NLLB laisse parfois
  « message » ou « comments » non traduits).
Sortie non nulle en cas d'erreur. Usage : .venv/bin/python tools/catalog/validate_catalog.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SLOT_RE = re.compile(r"\{(n|k|x|p|finding)\}")
WORD_RE = re.compile(r"[a-zà-ÿ]+")
PROPER_NOUNS = {"whatsapp", "echo"}  # noms propres, gardés tels quels dans toutes les langues


def untranslated_words(rw: str, *sources: str) -> list[str]:
    """Mots du kinyarwanda (5 lettres ou plus) qui reprennent un mot des sources (même début sur 5 lettres)."""
    src = {w for s in sources for w in WORD_RE.findall(SLOT_RE.sub(" ", s.lower())) if len(w) >= 5}
    words = WORD_RE.findall(SLOT_RE.sub(" ", rw.lower().replace("’", "'")))
    return sorted({w for w in words if len(w) >= 5 and w not in PROPER_NOUNS and any(w[:5] == t[:5] for t in src)})


def validate(cat: dict, schema: dict, base: Path) -> list[str]:
    errors: list[str] = []
    try:
        import jsonschema
        v = jsonschema.Draft202012Validator(schema)
        errors += [f"schema: {'/'.join(map(str, e.path))}: {e.message}" for e in v.iter_errors(cat)]
    except ImportError:
        errors.append("jsonschema not installed (.venv/bin/pip install jsonschema)")

    seen_examples: dict[str, str] = {}
    for f in cat.get("findings", []):
        fid = f["id"]
        for lang in ("en", "fr", "de", "es"):
            ex = f["examples"][lang]
            if not 8 <= len(ex) <= 10:
                errors.append(f"{fid}: {len(ex)} examples in {lang} (expected 8-10)")
            for e in ex:
                key = e.strip().lower()
                if key in seen_examples:
                    errors.append(f"{fid}: duplicate example {e!r} (also in {seen_examples[key]})")
                seen_examples[key] = fid
            if not f["keywords"][lang]:
                errors.append(f"{fid}: no keywords in {lang}")
        k = f.get("kinyarwanda")
        if not k:
            errors.append(f"{fid}: kinyarwanda missing")
            continue
        errors += check_sentence(f"finding {fid}", k, [], base)
        if SLOT_RE.search(k["rw"]):
            errors.append(f"finding {fid}: a finding sentence must not contain slots")

    for t in cat.get("templates", []):
        k = t["kinyarwanda"]
        errors += check_sentence(f"template {t['id']}", k, t["slots"], base)
        found = SLOT_RE.findall(k["rw"])
        if sorted(found) != sorted(t["slots"]):
            errors.append(f"template {t['id']}: slots in rw {found} != declared {t['slots']}")
        src_slots = sorted(SLOT_RE.findall(k["source"]["fr"]))
        if src_slots != sorted(t["slots"]) or sorted(SLOT_RE.findall(k["source"]["en"])) != src_slots:
            errors.append(f"template {t['id']}: slots in sources differ from declared slots")
        if "finding" in t["slots"] and not k["rw"].endswith("{finding}"):
            errors.append(f"template {t['id']}: {{finding}} must end the line")
        parts = t.get("audioParts")
        if not isinstance(parts, list) or len(parts) != len(found) + 1:
            errors.append(f"template {t['id']}: audioParts must have {len(found) + 1} entries (fixed parts around slots)")
        else:
            fixed = SLOT_RE.split(k["rw"])[::2]  # parties fixes entre les emplacements
            for i, (clip, text) in enumerate(zip(parts, fixed)):
                if clip is None and re.search(r"[A-Za-z]", text):
                    errors.append(f"template {t['id']}: fixed part {i} {text!r} has no clip")
                elif clip:
                    errors += check_file(f"template {t['id']}", clip, base)

    nums = cat.get("numbers") or {}
    for i in range(32):
        e = nums.get(str(i))
        if not e or not e.get("rw"):
            errors.append(f"number {i}: missing")
        elif not e.get("audio"):
            errors.append(f"number {i}: audio missing")
        else:
            errors += check_file(f"number {i}", e["audio"], base)

    prov = cat["provenance"]["kinyarwanda"]
    for key in ("mtModel", "similarityModel", "ttsModel", "ttsLicense", "floresReference", "acceptThreshold"):
        if not prov.get(key):
            errors.append(f"provenance.kinyarwanda.{key} missing")
    if "not validated" not in prov.get("disclaimer", ""):
        errors.append("provenance disclaimer must say 'not validated'")
    return errors


def check_sentence(where: str, k: dict, slots: list[str], base: Path) -> list[str]:
    errs = []
    if not k.get("rw"):
        errs.append(f"{where}: empty rw")
        return errs
    if k.get("status") == "speaker_validated" and not k.get("validatedBy"):
        errs.append(f"{where}: status speaker_validated requires a validatedBy note (who, when)")
    elif k.get("status") not in ("machine_translated_unvalidated", "speaker_validated"):
        errs.append(f"{where}: unknown status {k.get('status')!r}")
    if not (k.get("backTranslation") or {}).get("fr") or not (k.get("backTranslation") or {}).get("en"):
        errs.append(f"{where}: back-translations fr and en required")
    if not isinstance(k.get("similarity"), (int, float)):
        errs.append(f"{where}: similarity score missing")
    leaked = untranslated_words(k["rw"], *((k.get("source") or {}).get(lang, "") for lang in ("fr", "en")))
    if leaked:
        errs.append(f"{where}: untranslated source words in rw {leaked}")
    if re.search(r"\d", SLOT_RE.sub("", k["rw"])):
        errs.append(f"{where}: digits outside slots in rw {k['rw']!r}")
    for s in slots:
        if k["rw"].count("{" + s + "}") != 1:
            errs.append(f"{where}: slot {{{s}}} must appear exactly once in rw")
    if k.get("audio"):
        errs += check_file(where, k["audio"], base)
    elif not slots:
        errs.append(f"{where}: audio missing")
    return errs


def check_file(where: str, rel: str, base: Path) -> list[str]:
    p = base / rel
    if not p.is_file():
        return [f"{where}: audio file {rel} not found"]
    if p.stat().st_size < 500:
        return [f"{where}: audio file {rel} looks empty"]
    return []


def main() -> int:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "catalog" / "catalog.json"
    cat = json.loads(path.read_text(encoding="utf-8"))
    schema = json.loads((ROOT / "catalog" / "catalog.schema.json").read_text(encoding="utf-8"))
    errors = validate(cat, schema, path.parent)
    if errors:
        print(f"INVALID ({len(errors)} errors):")
        for e in errors:
            print(" -", e)
        return 1
    n_ex = sum(len(v) for f in cat["findings"] for v in f["examples"].values())
    print(f"OK: 21 findings, {n_ex} synthetic examples, {len(cat['templates'])} templates, "
          f"{len(cat['numbers'])} numbers, all audio files present")
    return 0


if __name__ == "__main__":
    sys.exit(main())
