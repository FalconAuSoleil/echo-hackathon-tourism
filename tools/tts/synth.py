"""Synthèse Piper partagée (audio de test et messages d'exemple). Build uniquement, jamais au runtime."""
from __future__ import annotations

import subprocess
from functools import lru_cache
from pathlib import Path

import numpy as np

from voices import VOICES, download

TARGET_SR = 16000


@lru_cache(maxsize=4)
def load_voice(key: str):
    from piper import PiperVoice

    onnx, cfg = download(key)
    return PiperVoice.load(onnx, cfg)


def num_speakers(key: str) -> int:
    return int(load_voice(key).config.num_speakers or 1)


def synthesize(key: str, text: str, speaker: int | None, length_scale: float,
               noise_scale: float | None = None, noise_w_scale: float | None = None) -> np.ndarray:
    """Retourne l'audio int16 mono à 16 kHz.

    Piper (VITS) tire un bruit aléatoire dans le graphe ONNX : avec les échelles par défaut, deux exécutions
    donnent des ondes légèrement différentes. noise_scale = noise_w_scale = 0 rend la sortie déterministe.
    """
    from piper import SynthesisConfig

    voice = load_voice(key)
    cfg = SynthesisConfig(speaker_id=speaker, length_scale=length_scale,
                          noise_scale=noise_scale, noise_w_scale=noise_w_scale)
    pcm = np.concatenate([c.audio_int16_array for c in voice.synthesize(text, cfg)])
    return resample(pcm, voice.config.sample_rate, TARGET_SR)


def resample(pcm: np.ndarray, sr_in: int, sr_out: int) -> np.ndarray:
    if sr_in == sr_out:
        return pcm.astype(np.int16)
    out = subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-f", "s16le", "-ar", str(sr_in), "-ac", "1", "-i", "pipe:0",
         "-ar", str(sr_out), "-ac", "1", "-f", "s16le", "pipe:1"],
        input=pcm.astype(np.int16).tobytes(), capture_output=True, check=True,
    ).stdout
    return np.frombuffer(out, dtype=np.int16)


def write_wav(path: Path, pcm: np.ndarray, sr: int = TARGET_SR) -> None:
    import soundfile as sf

    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), pcm.astype(np.int16), sr, subtype="PCM_16")


def voices_for(lang: str) -> list[str]:
    return [k for k, v in VOICES.items() if v["lang"] == lang]
