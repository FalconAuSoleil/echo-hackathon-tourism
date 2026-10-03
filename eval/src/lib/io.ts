// Entrées/sorties de l'évaluation : JSONL, JSON, audio (ffmpeg → PCM float 16 kHz mono).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function readJsonl<T>(path: string): T[] {
  return readFileSync(path, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as T);
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function readJsonIfExists<T>(path: string): T | undefined {
  return existsSync(path) ? readJson<T>(path) : undefined;
}

export function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, (_k, v) => (v instanceof Float32Array ? undefined : v), 2) + "\n");
}

/** Audio quelconque → Float32Array mono 16 kHz (ffmpeg). */
export function loadAudio16k(path: string): Float32Array {
  const buf = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", path, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"], {
    maxBuffer: 1 << 28,
  });
  // copie alignée (le Buffer de Node peut ne pas être aligné sur 4 octets)
  const out = new Float32Array(buf.byteLength / 4);
  new Uint8Array(out.buffer).set(buf);
  return out;
}

export const round = (x: number, d = 3): number => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : x);
