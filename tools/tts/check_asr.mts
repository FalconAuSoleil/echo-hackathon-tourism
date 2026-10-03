// Sanity check of the SYNTHETIC audio: transcribes wav files with the shipped Whisper adapter and prints
// language, confidence and a crude word error rate against the expected text. Not the evaluation itself
// (that is `pnpm eval`); it only verifies that the generated voices are intelligible.
// Usage: cd eval && npx tsx ../tools/tts/check_asr.mts <manifest.jsonl> [audioField=clean] [model=onnx-community/whisper-base] [limit]
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createWhisperTranscriber, useLocalModels } from "../../packages/models/src/index.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
useLocalModels(join(ROOT, "models"));
const [manifest, field = "clean", model = "onnx-community/whisper-base", limitArg] = process.argv.slice(2);
const rows = readFileSync(resolve(manifest!), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const limit = limitArg ? Number(limitArg) : rows.length;

function load(path: string): Float32Array {
  const buf = execFileSync("ffmpeg", ["-loglevel", "error", "-i", path, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"], { maxBuffer: 1 << 28 });
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}
const words = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
function wer(ref: string, hyp: string): number {
  const r = words(ref), h = words(hyp);
  if (!r.length) return h.length ? 1 : 0;
  const d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)]);
  for (let j = 1; j <= h.length; j++) d[0]![j] = j;
  for (let i = 1; i <= r.length; i++)
    for (let j = 1; j <= h.length; j++)
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (r[i - 1] === h[j - 1] ? 0 : 1));
  return d[r.length]![h.length]! / r.length;
}

const asr = await createWhisperTranscriber(model);
let errs = 0, refWords = 0;
for (const row of rows.slice(0, limit)) {
  const path = field === "clean" ? row.clean ?? row.file : row.noisy?.[field] ?? row[field];
  const t = await asr.transcribe(load(path.startsWith("/") ? path : join(ROOT, path)), { withEnglishTranslation: false });
  const ref = row.text ?? row.transcript ?? "";
  const w = ref ? wer(ref, t.text) : NaN;
  if (ref) { errs += w * words(ref).length; refWords += words(ref).length; }
  console.log(`${row.id}\t${row.lang}\t${t.language}\tconf=${t.confidence.toFixed(2)}\twer=${w.toFixed(2)}\t${row.tts?.voice ?? row.voice ?? ""}\t${t.text}`);
}
if (refWords) console.log(`overall WER ${(errs / refWords).toFixed(3)} on ${refWords} words`);
