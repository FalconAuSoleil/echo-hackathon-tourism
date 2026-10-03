#!/usr/bin/env python3
"""Tests de l'outillage du catalogue (sans modèle) : protection des emplacements, découpage audio, validateur.

Usage : .venv/bin/python tools/catalog/test_catalog.py
"""
from __future__ import annotations

import copy
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_kinyarwanda as b  # noqa: E402
import validate_catalog as v  # noqa: E402
from examples_negative import NEGATIVE_EXAMPLES  # noqa: E402
from examples_positive import POSITIVE_EXAMPLES  # noqa: E402
from sources import FINDING_SOURCES, NUMBERS, TEMPLATE_SOURCES, number_word  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
CATALOG = json.loads((ROOT / "catalog" / "catalog.json").read_text(encoding="utf-8"))
SCHEMA = json.loads((ROOT / "catalog" / "catalog.schema.json").read_text(encoding="utf-8"))


class SlotProtection(unittest.TestCase):
    def test_protect_replaces_numeric_slots_with_guards(self):
        self.assertEqual(b.protect("({k} out of {n}), month {x}; {p}"), "(13 out of 17), month 14; 15")

    def test_restore_puts_slots_back(self):
        rw, check = b.restore("Ibyo abashyitsi bakunda (13 ku 17)", ["finding", "k", "n"])
        self.assertEqual((rw, check), ("Ibyo abashyitsi bakunda ({k} ku {n})", "ok"))

    def test_restore_rejects_missing_or_duplicated_guard(self):
        self.assertIsNone(b.restore("cumi na gatatu ku 17", ["k", "n"])[0])  # 13 écrit en lettres
        self.assertIsNone(b.restore("13 ku 13 17", ["k", "n"])[0])

    def test_restore_rejects_stray_digits(self):
        self.assertIsNone(b.restore("Ubutumwa 17 mu 2026", ["n"])[0])

    def test_guard_is_not_matched_inside_a_longer_number(self):
        self.assertIsNone(b.restore("Ubutumwa 170", ["n"])[0])


class AudioSegments(unittest.TestCase):
    def test_split_keeps_slot_order(self):
        parts = b.split_segments("A ({k} ku {n}): {finding}")
        self.assertEqual(parts, ["A (", {"slot": "k"}, " ku ", {"slot": "n"}, "): ", {"slot": "finding"}, ""])

    def test_tts_text_keeps_only_letters_the_voice_knows(self):
        self.assertEqual(b.tts_text("Muri uku kwezi: Ubutumwa"), "muri uku kwezi ubutumwa")
        self.assertEqual(b.tts_text("): "), "")


class Numbers(unittest.TestCase):
    def test_counting_forms(self):
        self.assertEqual(number_word(0), "zeru")
        self.assertEqual(number_word(3), "gatatu")
        self.assertEqual(number_word(10), "icumi")
        self.assertEqual(number_word(13), "cumi na gatatu")
        self.assertEqual(number_word(18), "cumi n'umunani")
        self.assertEqual(number_word(20), "makumyabiri")
        self.assertEqual(number_word(29), "makumyabiri n'icyenda")
        self.assertEqual(number_word(31), "mirongo itatu na rimwe")
        self.assertEqual(len(NUMBERS), 32)


class AuthoredContent(unittest.TestCase):
    def test_every_finding_has_8_to_10_examples_per_language(self):
        ex = {**POSITIVE_EXAMPLES, **NEGATIVE_EXAMPLES}
        self.assertEqual(len(ex), 21)
        for fid, langs in ex.items():
            for lang in ("en", "fr", "de", "es"):
                self.assertTrue(8 <= len(langs[lang]) <= 10, f"{fid}/{lang}")

    def test_template_sources_carry_their_slots(self):
        import re
        for tid, spec in TEMPLATE_SOURCES.items():
            numeric = sorted(s for s in spec["slots"] if s != "finding")
            for fr, en in spec["candidates"]:
                self.assertEqual(sorted(re.findall(r"\{(\w+)\}", fr)), numeric, f"{tid}: {fr}")
                self.assertEqual(sorted(re.findall(r"\{(\w+)\}", en)), numeric, f"{tid}: {en}")
            self.assertEqual(spec["prefix"], "finding" in spec["slots"])
        self.assertEqual(set(FINDING_SOURCES), set(POSITIVE_EXAMPLES) | set(NEGATIVE_EXAMPLES))


class Validator(unittest.TestCase):
    base = ROOT / "catalog"

    def test_repository_catalog_is_valid(self):
        self.assertEqual(v.validate(CATALOG, SCHEMA, self.base), [])

    def test_detects_a_broken_slot(self):
        bad = copy.deepcopy(CATALOG)
        t = next(t for t in bad["templates"] if t["id"] == "volume")
        t["kinyarwanda"]["rw"] = t["kinyarwanda"]["rw"].replace("{n}", "17")
        errs = v.validate(bad, SCHEMA, self.base)
        self.assertTrue(any("volume" in e and ("digits" in e or "slot" in e) for e in errs), errs)

    def test_detects_too_few_examples_and_duplicates(self):
        bad = copy.deepcopy(CATALOG)
        bad["findings"][0]["examples"]["de"] = bad["findings"][0]["examples"]["de"][:3]
        bad["findings"][1]["examples"]["en"].append(bad["findings"][2]["examples"]["en"][0])
        errs = v.validate(bad, SCHEMA, self.base)
        self.assertTrue(any("3 examples in de" in e for e in errs), errs)
        self.assertTrue(any("duplicate example" in e for e in errs), errs)

    def test_detects_a_validated_status_claim_and_missing_audio(self):
        bad = copy.deepcopy(CATALOG)
        bad["findings"][0]["kinyarwanda"]["status"] = "speaker_validated"
        bad["numbers"]["7"]["audio"] = "audio/nope.mp3"
        errs = v.validate(bad, SCHEMA, self.base)
        self.assertTrue(any("status" in e for e in errs), errs)
        self.assertTrue(any("nope.mp3" in e for e in errs), errs)

    def test_detects_wrong_audio_parts_length(self):
        bad = copy.deepcopy(CATALOG)
        next(t for t in bad["templates"] if t["id"] == "keep")["audioParts"].pop()
        self.assertTrue(any("audioParts" in e for e in v.validate(bad, SCHEMA, self.base)))


if __name__ == "__main__":
    unittest.main(verbosity=1)
