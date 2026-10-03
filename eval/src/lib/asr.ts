// Chargement des Whisper de @echo/models, mêmes adaptateurs que l'app, et cache des transcriptions.
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Transcriber, TranscribeOptions, Transcript } from "@echo/core";
import { createWhisperTranscriber, useLocalModels, MODELS } from "@echo/models";
import { MODELS_DIR } from "./paths.ts";
import { readJsonl } from "./io.ts";

useLocalModels(MODELS_DIR);

export const WHISPER_IDS: Record<string, string> = {
  tiny: "onnx-community/whisper-tiny",
  base: "onnx-community/whisper-base",
  small: "onnx-community/whisper-small",
};

export function whisperAvailable(size: string): boolean {
  const id = WHISPER_IDS[size];
  if (!id) return false;
  return MODELS[id]!.onnxFiles.every((f) => existsSync(`${MODELS_DIR}/${id}/${f}`));
}

export async function loadWhisper(size: string) {
  return createWhisperTranscriber(WHISPER_IDS[size]!);
}

export interface CachedTranscript extends Transcript {
  key: string;
  seconds: number; // temps de calcul de la transcription
}

/** Cache JSONL append-only (reprise après interruption). */
export class TranscriptCache {
  private map = new Map<string, CachedTranscript>();
  constructor(private path: string) {
    if (existsSync(path)) for (const r of readJsonl<CachedTranscript>(path)) this.map.set(r.key, r);
  }
  get(key: string): CachedTranscript | undefined {
    return this.map.get(key);
  }
  put(r: CachedTranscript): void {
    this.map.set(r.key, r);
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, JSON.stringify(r) + "\n");
  }
}

/**
 * Transcriber qui relit le cache ou appelle le vrai Whisper (chargé à la demande) : la partie
 * classement peut être relancée sans retranscrire. Le résultat est identique à un appel direct.
 */
export function cachingTranscriber(cache: TranscriptCache, size: string, keyOf: () => string): Transcriber {
  let real: Transcriber | undefined;
  return {
    async transcribe(audio: Float32Array, opts?: TranscribeOptions): Promise<Transcript> {
      const key = keyOf();
      const hit = cache.get(key);
      if (hit) return hit;
      real ??= await loadWhisper(size);
      const t0 = performance.now();
      const t = await real.transcribe(audio, opts);
      cache.put({ ...t, key, seconds: (performance.now() - t0) / 1000 });
      return t;
    },
  };
}
