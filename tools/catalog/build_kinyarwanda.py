#!/usr/bin/env python3
"""Construit catalog/catalog.json et catalog/audio/ une seule fois, hors ligne (SPEC 5). Jamais au runtime.

Étapes (toutes par défaut, ou --stages content,translate,audio) :
  content    exemples synthétiques, mots-clés, intitulés → catalog.json (aucun modèle)
  translate  NLLB-200 (facebook/nllb-200-distilled-600M) fr/en → kin_Latn, rétro-traduction kin → fra et eng,
             similarité avec le modèle de l'app (paraphrase-multilingual-MiniLM-L12-v2, même fichier ONNX q8),
             emplacements protégés puis vérifiés, simplification et nouvel essai si le score est bas.
             Journal complet des essais : catalog/translation-log.json
  audio      MMS-TTS kin (facebook/mms-tts-kin, CC-BY-NC 4.0) : un clip par phrase de constat, par morceau fixe
             de modèle (entre les emplacements) et par nombre 0..31 → mp3 mono 16 kHz dans catalog/audio/

Tout le kinyarwanda est marqué « machine translation, not validated by a speaker ».

Usage : .venv/bin/python tools/catalog/build_kinyarwanda.py [--stages ...] [--threshold 0.75]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CATALOG = ROOT / "catalog" / "catalog.json"
AUDIO_DIR = ROOT / "catalog" / "audio"
LOG = ROOT / "catalog" / "translation-log.json"
CACHE = ROOT / "tools" / "cache"
os.environ.setdefault("HF_HOME", str(CACHE / "hf"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from examples_negative import NEGATIVE_EXAMPLES  # noqa: E402
from examples_positive import POSITIVE_EXAMPLES  # noqa: E402
from keywords import KEYWORDS  # noqa: E402
from sources import FINDING_SOURCES, NUMBERS, SLOT_GUARDS, TEMPLATE_SOURCES  # noqa: E402

MT_MODEL = "facebook/nllb-200-distilled-600M"
TTS_MODEL = "facebook/mms-tts-kin"
SIM_REPO = "Xenova/paraphrase-multilingual-MiniLM-L12-v2"
SIM_DIR = ROOT / "models" / SIM_REPO
DISCLAIMER = ("Machine translation, not validated by a Kinyarwanda speaker / "
              "Traduction automatique, non validée par un locuteur")
STATUS = "machine_translated_unvalidated"
LANGS = ["en", "fr", "de", "es"]
NLLB_CODE = {"en": "eng_Latn", "fr": "fra_Latn", "rw": "kin_Latn"}
TTS_SEED = 1234
# Score publié (metrics.csv de facebook/nllb-200-distilled-600M, lien « metrics » de la fiche du modèle).
FLORES_REFERENCE = {
    "metric": "chrF++ eng_Latn->kin_Latn, FLORES-200",
    "value": 44.0,
    "source": "https://dl.fbaipublicfiles.com/large_objects/nllb/models/nllb_200_dense_distill_600m/metrics.csv "
              "(linked as 'metrics' from https://huggingface.co/facebook/nllb-200-distilled-600M), row eng_Latn-kin_Latn,44",
    "otherDirections": {
        "kin_Latn->eng_Latn (same file)": 51.3,
        "fra_Latn->kin_Latn": "not published for the 600M model (the file lists only some directions); "
                              "NLLB-200 MoE 54.5B reports 46.2 chrF++ (nllb_200_moe_54b/metrics.csv); "
                              "our own measure on FLORES-200 devtest: catalog/flores-check.json",
    },
}
SLOT_RE = re.compile(r"\{(n|k|x|p|finding)\}")


def load_catalog() -> dict:
    return json.loads(CATALOG.read_text(encoding="utf-8"))


def save_catalog(cat: dict) -> None:
    CATALOG.write_text(json.dumps(cat, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


# ---------------------------------------------------------------- content

def stage_content(cat: dict) -> None:
    examples = {**POSITIVE_EXAMPLES, **NEGATIVE_EXAMPLES}
    for f in cat["findings"]:
        fid = f["id"]
        f["examples"] = {lang: list(examples[fid][lang]) for lang in LANGS}
        f["examplesSynthetic"] = True
        f["keywords"] = {lang: list(KEYWORDS[fid][lang]) for lang in LANGS}
    cat["provenance"]["examples"] = "synthetic"
    print(f"content: {sum(len(v) for f in cat['findings'] for v in f['examples'].values())} synthetic examples")


# ---------------------------------------------------------------- models

class Translator:
    def __init__(self) -> None:
        import torch
        from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
        torch.set_num_threads(os.cpu_count() or 4)
        self.torch = torch
        self.tok = AutoTokenizer.from_pretrained(MT_MODEL)
        self.model = AutoModelForSeq2SeqLM.from_pretrained(MT_MODEL).eval()

    def __call__(self, texts: list[str], src: str, tgt: str) -> list[str]:
        self.tok.src_lang = NLLB_CODE[src]
        enc = self.tok(texts, return_tensors="pt", padding=True)
        with self.torch.no_grad():
            out = self.model.generate(**enc, forced_bos_token_id=self.tok.convert_tokens_to_ids(NLLB_CODE[tgt]),
                                      num_beams=4, do_sample=False, max_new_tokens=128)
        return [s.strip() for s in self.tok.batch_decode(out, skip_special_tokens=True)]


class Embedder:
    """Même modèle que l'app : fichier ONNX quantifié de models/ (pnpm models:download), mean pooling + L2."""

    def __init__(self) -> None:
        import numpy as np
        import onnxruntime as ort
        from tokenizers import Tokenizer
        onnx = SIM_DIR / "onnx" / "model_quantized.onnx"
        if not onnx.exists():
            sys.exit(f"missing {onnx}: run `pnpm models:download` first")
        self.np = np
        self.sess = ort.InferenceSession(str(onnx), providers=["CPUExecutionProvider"])
        self.tok = Tokenizer.from_file(str(SIM_DIR / "tokenizer.json"))
        self.tok.enable_padding(pad_id=self.tok.token_to_id("<pad>") or 1, pad_token="<pad>")
        self.tok.enable_truncation(128)

    def embed(self, texts: list[str]):
        np = self.np
        encs = self.tok.encode_batch(texts)
        ids = np.array([e.ids for e in encs], dtype=np.int64)
        mask = np.array([e.attention_mask for e in encs], dtype=np.int64)
        (hidden,) = self.sess.run(None, {"input_ids": ids, "attention_mask": mask, "token_type_ids": np.zeros_like(ids)})
        m = mask[..., None].astype(np.float32)
        pooled = (hidden * m).sum(1) / np.clip(m.sum(1), 1e-9, None)
        return pooled / np.linalg.norm(pooled, axis=1, keepdims=True)

    def sim(self, a: str, b: str) -> float:
        e = self.embed([a, b])
        return round(float((e[0] * e[1]).sum()), 4)


# ---------------------------------------------------------------- translate

def protect(text: str) -> str:
    """Remplace {n} {k} {x} {p} par des nombres distincts que NLLB recopie tels quels."""
    return SLOT_RE.sub(lambda m: SLOT_GUARDS[m.group(1)], text)


def restore(rw: str, slots: list[str]) -> tuple[str | None, str]:
    """Remet les emplacements ; None si un nombre de protection a disparu, est dupliqué, ou si un chiffre parasite apparaît."""
    numeric = [s for s in slots if s != "finding"]
    for s in numeric:
        n = len(re.findall(rf"(?<!\d){SLOT_GUARDS[s]}(?!\d)", rw))
        if n != 1:
            return None, f"slot {{{s}}} (guard {SLOT_GUARDS[s]}) found {n} times"
    out = rw
    for s in numeric:
        out = re.sub(rf"(?<!\d){SLOT_GUARDS[s]}(?!\d)", "{" + s + "}", out)
    if re.search(r"\d", out):
        return None, "unexpected digit after restoring slots"
    return out, "ok"


def translate_item(tr: Translator, emb: Embedder, item_id: str, candidates: list[tuple[str, str]],
                   slots: list[str], prefix: bool, threshold: float, log: list) -> dict:
    """Essaie les candidats du plus naturel au plus simple ; garde le premier au-dessus du seuil, sinon le meilleur."""
    best = None
    attempts = []
    for attempt, (src_fr, src_en) in enumerate(candidates, start=1):
        p_fr, p_en = protect(src_fr), protect(src_en)
        options = []
        for src_lang, text in (("en", p_en), ("fr", p_fr)):
            rw_raw = tr([text], src_lang, "rw")[0]
            back_fr = tr([rw_raw], "rw", "fr")[0]
            back_en = tr([rw_raw], "rw", "en")[0]
            sim_fr, sim_en = emb.sim(p_fr, back_fr), emb.sim(p_en, back_en)
            rw, slot_check = restore(rw_raw, slots)
            score = min(sim_fr, sim_en)
            options.append({"translatedFrom": src_lang, "rwRaw": rw_raw, "rw": rw, "slotCheck": slot_check,
                            "backTranslation": {"fr": back_fr, "en": back_en},
                            "similarityFr": sim_fr, "similarityEn": sim_en, "score": score})
        valid = [o for o in options if o["rw"] is not None]
        chosen = max(valid, key=lambda o: o["score"]) if valid else None
        attempts.append({"attempt": attempt, "source": {"fr": src_fr, "en": src_en}, "options": options,
                         "chosen": chosen["translatedFrom"] if chosen else None,
                         "passed": bool(chosen and chosen["score"] >= threshold)})
        if chosen and (best is None or chosen["score"] > best[1]["score"]):
            best = (attempt, chosen, (src_fr, src_en))
        if chosen and chosen["score"] >= threshold:
            break
        print(f"  retry {item_id}: attempt {attempt} "
              f"{'score ' + str(chosen['score']) if chosen else 'slot check failed'} < {threshold}, simplifying", flush=True)
    log.append({"id": item_id, "attempts": attempts})
    if best is None:
        raise SystemExit(f"{item_id}: no candidate kept its slots intact; add a simpler candidate in sources.py")
    attempt, o, (src_fr, src_en) = best
    rw = o["rw"].strip()
    if prefix:  # le constat est inséré après le préfixe figé
        rw = rw.rstrip(" .:;,") + ": {finding}"
        src_fr, src_en = f"{src_fr} : {{finding}}", f"{src_en}: {{finding}}"
    elif not rw.endswith((".", "!", "?")):
        rw += "."
    return {
        "rw": rw,
        "source": {"fr": src_fr, "en": src_en},
        "backTranslation": o["backTranslation"],
        "similarity": o["score"],
        "similarityDetail": {"fr": o["similarityFr"], "en": o["similarityEn"]},
        "translatedFrom": o["translatedFrom"],
        "attempts": len(attempts),
        "chosenAttempt": attempt,
        "backTranslationCheck": "passed" if o["score"] >= threshold else "below_threshold",
        "audio": None,
        "status": STATUS,
    }


def stage_translate(cat: dict, threshold: float, only: set[str] | None) -> None:
    """only : identifiants à refaire (ex. {"template:fix"}) ; les autres phrases et leur journal sont gardés."""
    print("translate: loading NLLB-200 and the similarity model", flush=True)
    tr, emb = Translator(), Embedder()
    old_log = {e["id"]: e for e in json.loads(LOG.read_text(encoding="utf-8"))["items"]} if (only and LOG.exists()) else {}
    log: list = []

    def todo(item_id: str, current) -> bool:
        if only is None or not current or item_id not in old_log:
            return True
        if item_id in only:
            return True
        log.append(old_log[item_id])
        return False

    for f in cat["findings"]:
        fid = f["id"]
        if todo(f"finding:{fid}", f.get("kinyarwanda")):
            print(f"- finding {fid}", flush=True)
            f["kinyarwanda"] = translate_item(tr, emb, f"finding:{fid}", FINDING_SOURCES[fid], [], False, threshold, log)
    by_id = {t["id"]: t for t in cat["templates"]}
    for tid, spec in TEMPLATE_SOURCES.items():
        t = by_id.setdefault(tid, {"id": tid})
        t["slots"] = spec["slots"]
        if todo(f"template:{tid}", (t.get("kinyarwanda") or {}).get("rw")):
            print(f"- template {tid}", flush=True)
            t["kinyarwanda"] = translate_item(tr, emb, f"template:{tid}", spec["candidates"], spec["slots"],
                                              spec["prefix"], threshold, log)
    cat["templates"] = [by_id[tid] for tid in TEMPLATE_SOURCES]
    cat["numbers"] = {k: {"rw": v, "audio": None, "source": "counting form, hand-written from public references",
                          "status": STATUS} for k, v in NUMBERS.items()}
    p = cat["provenance"]["kinyarwanda"]
    p.update({"disclaimer": DISCLAIMER, "mtModel": MT_MODEL, "similarityModel": SIM_REPO + " (onnx/model_quantized.onnx)",
              "acceptThreshold": threshold, "floresReference": FLORES_REFERENCE,
              "scoring": "min(cos(source_fr, back_fr), cos(source_en, back_en)); back = kin→fra and kin→eng with the same NLLB model",
              "slotProtection": "numeric slots replaced by guard numbers " + json.dumps(SLOT_GUARDS)
                                + " before translation, required exactly once after, then restored; {finding} is never translated"})
    LOG.write_text(json.dumps({"model": MT_MODEL, "threshold": threshold, "items": log}, ensure_ascii=False, indent=2)
                   + "\n", encoding="utf-8")
    scores = [s["kinyarwanda"]["similarity"] for s in cat["findings"] + cat["templates"]]
    low = [s["id"] for s in cat["findings"] + cat["templates"] if s["kinyarwanda"]["backTranslationCheck"] != "passed"]
    retried = [e["id"] for e in log if len(e["attempts"]) > 1]
    print(f"translate: {len(scores)} sentences, min {min(scores):.3f}, mean {sum(scores)/len(scores):.3f}; "
          f"retried {len(retried)} {retried}; below threshold {low}")


# ---------------------------------------------------------------- audio

def tts_text(rw: str) -> str:
    t = rw.lower().replace("’", "'")
    t = re.sub(r"[^a-z' \-]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def split_segments(rw: str) -> list[str | dict]:
    """« Komeza ({k} kuri {n}): {finding} » → ["Komeza (", {slot:k}, " kuri ", {slot:n}, "): ", {slot:finding}]."""
    parts: list[str | dict] = []
    pos = 0
    for m in SLOT_RE.finditer(rw):
        parts.append(rw[pos:m.start()])
        parts.append({"slot": m.group(1)})
        pos = m.end()
    parts.append(rw[pos:])
    return parts


class Speaker:
    def __init__(self) -> None:
        import torch
        from transformers import AutoTokenizer, VitsModel
        self.torch = torch
        self.tok = AutoTokenizer.from_pretrained(TTS_MODEL)
        self.model = VitsModel.from_pretrained(TTS_MODEL).eval()
        self.rate = self.model.config.sampling_rate

    def to_mp3(self, text: str, out: Path) -> float:
        import numpy as np
        import soundfile as sf
        self.torch.manual_seed(TTS_SEED)  # VITS est stochastique : graine fixe pour des clips reproductibles
        inputs = self.tok(text, return_tensors="pt")
        with self.torch.no_grad():
            wav = self.model(**inputs).waveform[0].numpy()
        wav = wav / max(1e-6, float(np.abs(wav).max())) * 0.9
        with tempfile.NamedTemporaryFile(suffix=".wav") as tmp:
            sf.write(tmp.name, wav, self.rate)
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", tmp.name, "-ac", "1", "-ar", "16000",
                            "-codec:a", "libmp3lame", "-b:a", "24k", "-map_metadata", "-1", str(out)], check=True)
        return len(wav) / self.rate


def stage_audio(cat: dict) -> None:
    print("audio: loading MMS-TTS kin")
    sp = Speaker()
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    for old in AUDIO_DIR.glob("*.mp3"):
        old.unlink()
    manifest = []

    def clip(name: str, text: str) -> str:
        spoken = tts_text(text)
        rel = f"audio/{name}.mp3"
        dur = sp.to_mp3(spoken, ROOT / "catalog" / rel)
        manifest.append({"file": rel, "text": text, "spoken": spoken, "seconds": round(dur, 2)})
        return rel

    for f in cat["findings"]:
        k = f["kinyarwanda"]
        k["audio"] = clip(f"finding-{f['id']}", k["rw"])
    for t in cat["templates"]:
        k = t["kinyarwanda"]
        # audioParts (contrat de packages/core/src/catalog.ts) : partie fixe 0, emplacement 0, partie fixe 1, ...
        # soit (nombre d'emplacements + 1) entrées, null quand la partie fixe ne contient rien à dire.
        parts = [p for p in split_segments(k["rw"]) if isinstance(p, str)]
        t["audioParts"] = [clip(f"template-{t['id']}-{i}", p) if tts_text(p) else None for i, p in enumerate(parts)]
        k.pop("audioSequence", None)
        k["audio"] = t["audioParts"][0] if not t["slots"] else None
    for n, entry in cat["numbers"].items():
        entry["audio"] = clip(f"num-{n}", entry["rw"])
    p = cat["provenance"]["kinyarwanda"]
    p.update({"ttsModel": TTS_MODEL, "ttsLicense": "CC-BY-NC 4.0",
              "audioFormat": "mp3, mono, 16 kHz, 24 kbit/s; VITS seed " + str(TTS_SEED)})
    total = sum(fp.stat().st_size for fp in AUDIO_DIR.glob("*.mp3"))
    (AUDIO_DIR / "manifest.json").write_text(json.dumps({"model": TTS_MODEL, "license": "CC-BY-NC 4.0",
                                                         "disclaimer": DISCLAIMER, "clips": manifest},
                                                        ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"audio: {len(manifest)} clips, {total/1024:.0f} KiB")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stages", default="content,translate,audio")
    ap.add_argument("--threshold", type=float, default=0.75)
    ap.add_argument("--only", default=None, help="redo only these ids, e.g. finding:P10,template:fix")
    args = ap.parse_args()
    stages = args.stages.split(",")
    cat = load_catalog()
    if "content" in stages:
        stage_content(cat)
        save_catalog(cat)
    if "translate" in stages:
        stage_translate(cat, args.threshold, set(args.only.split(",")) if args.only else None)
        save_catalog(cat)
    if "audio" in stages:
        stage_audio(cat)
        save_catalog(cat)
    print("done → catalog/catalog.json")


if __name__ == "__main__":
    main()
