// Mesures audio simples, calculées avant transcription, et règles « inaudible » côté audio (SPEC 7).
import type { AnalysisConfig } from "./config.ts";

export interface AudioStats {
  durationSec: number;
  /** Énergie RMS globale, échantillons dans [-1, 1]. */
  rms: number;
  /** Écart en dB entre le 90e et le 10e centile de l'énergie par trame de 30 ms. */
  dynamicRangeDb: number;
}

/** Durée, énergie et dynamique d'un audio mono. */
export function computeAudioStats(samples: Float32Array, sampleRate = 16_000): AudioStats {
  const n = samples.length;
  if (n === 0) return { durationSec: 0, rms: 0, dynamicRangeDb: 0 };
  let sum = 0;
  for (let i = 0; i < n; i++) sum += (samples[i] ?? 0) ** 2;
  const frame = Math.max(1, Math.round(sampleRate * 0.03));
  const frames: number[] = [];
  for (let s = 0; s + frame <= n; s += frame) {
    let e = 0;
    for (let i = s; i < s + frame; i++) e += (samples[i] ?? 0) ** 2;
    frames.push(Math.sqrt(e / frame));
  }
  let dynamicRangeDb = 0;
  if (frames.length >= 2) {
    frames.sort((a, b) => a - b);
    const p10 = frames[Math.floor(frames.length * 0.1)] ?? 0;
    const p90 = frames[Math.min(frames.length - 1, Math.floor(frames.length * 0.9))] ?? 0;
    dynamicRangeDb = 20 * Math.log10((p90 + 1e-9) / (p10 + 1e-9));
  }
  return { durationSec: n / sampleRate, rms: Math.sqrt(sum / n), dynamicRangeDb };
}

export type InaudibleReason = "too_short" | "silence" | "too_noisy" | "empty_transcript";

/** Règles « inaudible » côté audio seul (SPEC 7), avant toute transcription. */
export function audioInaudibleReason(
  stats: { durationSec: number; rms: number; dynamicRangeDb?: number },
  config: Pick<AnalysisConfig, "minAudioSeconds" | "minAudioRms" | "minAudioDynamicRangeDb">,
): InaudibleReason | null {
  if (stats.durationSec < config.minAudioSeconds) return "too_short";
  if (stats.rms < config.minAudioRms) return "silence";
  if (config.minAudioDynamicRangeDb > 0 && stats.dynamicRangeDb !== undefined && stats.dynamicRangeDb < config.minAudioDynamicRangeDb) {
    return "too_noisy";
  }
  return null;
}
