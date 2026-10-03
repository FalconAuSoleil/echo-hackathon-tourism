"""Registre des voix Piper utilisées pour l'audio de test synthétique (niveau 3) et les messages d'exemple.

Toutes les voix viennent de https://huggingface.co/rhasspy/piper-voices (dépôt sous licence MIT ;
chaque modèle hérite de la licence de son jeu de données, relevée dans le MODEL_CARD de la voix le 2026-10-03).
Moteur : piper-tts 1.8.0 (https://github.com/OHF-Voice/piper1-gpl, GPL-3.0), utilisé uniquement au build.
Aucune voix n'est sous licence non commerciale, sauf mention contraire ci-dessous.
"""
from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
CACHE = REPO / "tools" / "cache" / "piper"
BASE_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/main"

# key -> (chemin HF, langue, nombre de locuteurs, licence du jeu de données, URL du jeu de données)
VOICES: dict[str, dict] = {
    "en_US-libritts_r-medium": {"path": "en/en_US/libritts_r/medium", "lang": "en", "speakers": 904,
                                "license": "CC-BY-4.0", "dataset": "LibriTTS-R, http://www.openslr.org/141/"},
    "en_GB-vctk-medium": {"path": "en/en_GB/vctk/medium", "lang": "en", "speakers": 109,
                          "license": "CC-BY-4.0", "dataset": "VCTK, https://datashare.ed.ac.uk/handle/10283/3443"},
    "fr_FR-mls-medium": {"path": "fr/fr_FR/mls/medium", "lang": "fr", "speakers": 125,
                         "license": "CC-BY-4.0", "dataset": "Multilingual LibriSpeech, http://openslr.org/94/"},
    "fr_FR-siwis-medium": {"path": "fr/fr_FR/siwis/medium", "lang": "fr", "speakers": 1,
                           "license": "CC-BY-4.0", "dataset": "SIWIS, https://datashare.is.ed.ac.uk/handle/10283/2353"},
    "fr_FR-upmc-medium": {"path": "fr/fr_FR/upmc/medium", "lang": "fr", "speakers": 2,
                          "license": "CC-BY-SA-4.0", "dataset": "UPMC Pierre, https://github.com/marytts/upmc-pierre-data"},
    "de_DE-mls-medium": {"path": "de/de_DE/mls/medium", "lang": "de", "speakers": 236,
                         "license": "CC-BY-4.0", "dataset": "Multilingual LibriSpeech, http://openslr.org/94/"},
    "de_DE-thorsten-medium": {"path": "de/de_DE/thorsten/medium", "lang": "de", "speakers": 1,
                              "license": "CC0-1.0", "dataset": "Thorsten-Voice, https://github.com/thorstenMueller/Thorsten-Voice"},
    "de_DE-thorsten_emotional-medium": {"path": "de/de_DE/thorsten_emotional/medium", "lang": "de", "speakers": 8,
                                        "license": "CC0-1.0", "dataset": "Thorsten-Voice emotional, https://github.com/thorstenMueller/Thorsten-Voice"},
    "de_DE-kerstin-low": {"path": "de/de_DE/kerstin/low", "lang": "de", "speakers": 1,
                          "license": "CC0-1.0", "dataset": "Kerstin, https://github.com/rhasspy/dataset-voice-kerstin"},
    "es_ES-sharvard-medium": {"path": "es/es_ES/sharvard/medium", "lang": "es", "speakers": 2,
                              "license": "CC-BY-3.0", "dataset": "Sharvard, https://datashare.ed.ac.uk/handle/10283/574"},
    "es_ES-davefx-medium": {"path": "es/es_ES/davefx/medium", "lang": "es", "speakers": 1,
                            "license": "CC0-1.0", "dataset": "davefx, https://github.com/OHF-Voice/voice-datasets"},
    "es_MX-ald-medium": {"path": "es/es_MX/ald/medium", "lang": "es", "speakers": 1,
                         "license": "Unlicense", "dataset": "Ald Mexican Spanish, https://huggingface.co/datasets/rmcpantoja/Ald_Mexican_Spanish_speech_dataset"},
    "es_AR-daniela-high": {"path": "es/es_AR/daniela/high", "lang": "es", "speakers": 1,
                           "license": "CC-BY-SA-4.0", "dataset": "OpenSLR 61 (Argentinian Spanish), https://www.openslr.org/61/"},
}


def voice_files(key: str) -> tuple[Path, Path]:
    d = CACHE / key
    return d / f"{key}.onnx", d / f"{key}.onnx.json"


def download(key: str) -> tuple[Path, Path]:
    """Télécharge une voix dans tools/cache/piper/ (idempotent)."""
    onnx, cfg = voice_files(key)
    onnx.parent.mkdir(parents=True, exist_ok=True)
    rel = VOICES[key]["path"]
    for target, name in ((onnx, f"{key}.onnx"), (cfg, f"{key}.onnx.json"), (onnx.parent / "MODEL_CARD", "MODEL_CARD")):
        if target.exists() and target.stat().st_size > 0:
            continue
        url = f"{BASE_URL}/{rel}/{name}"
        print(f"download {url}", file=sys.stderr)
        tmp = target.with_suffix(target.suffix + ".part")
        urllib.request.urlretrieve(url, tmp)
        tmp.rename(target)
    return onnx, cfg


def speaker_ids(key: str) -> list[int]:
    _, cfg = voice_files(key)
    conf = json.loads(cfg.read_text())
    n = int(conf.get("num_speakers", 1))
    return list(range(n)) if n > 1 else [None]  # type: ignore[list-item]


if __name__ == "__main__":
    for k in (sys.argv[1:] or VOICES):
        download(k)
    print("ok")
