// Checks the SYNTHETIC demo samples (SPEC 8) against their expected outcome with the shipped pipeline:
// whisper-base adapter of @echo/models + analyzeAudioMessage of @echo/core with the calibrated DEFAULT_CONFIG
// (the same code as the app's worker, but on Node's onnxruntime instead of the browser's WASM, so a take that
// passes here is very likely, not certain, to pass in the browser: the e2e test is the final check).
// Usage: cd eval && npx tsx ../tools/tts/check_demo.mts [manifest.json|takes.json] [--json]
//   default manifest: eval/data/demo-samples/manifest.json. A takes file is {"samples":[{id, file (absolute or
//   relative to the manifest), lang, transcript, expected}]}. Exit code 1 if a sample misses its expectation.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG, analyzeAudioMessage, createMatcher, type MessageAnalysis } from "../../packages/core/src/index.ts";
import { createWhisperTranscriber, useLocalModels } from "../../packages/models/src/index.ts";
import { getEmbedder, loadCatalog } from "../../eval/src/lib/system.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
useLocalModels(join(ROOT, "models"));
const args = process.argv.slice(2);
const asJson = args.includes("--json");
const manifestPath = resolve(args.find((a) => !a.startsWith("--")) ?? join(ROOT, "eval/data/demo-samples/manifest.json"));

interface Expected {
  status: string;
  findings: string[];
  notSure?: boolean | "allowed";
  offList?: boolean;
  mustNot?: string[];
}
interface Sample {
  id: string;
  file: string;
  lang: string | null;
  transcript: string;
  expected: Expected;
}

function load(path: string): Float32Array {
  const buf = execFileSync("ffmpeg", ["-loglevel", "error", "-i", path, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"], { maxBuffer: 1 << 28 });
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

const words = (t: string) => t.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
/** Taux d'erreur de mots brut (distance d'édition), pour départager des prises conformes. */
function wer(ref: string, hyp: string): number {
  const r = words(ref), h = words(hyp);
  if (!r.length) return h.length ? 1 : 0;
  let prev = Array.from({ length: h.length + 1 }, (_, j) => j);
  for (let i = 1; i <= r.length; i++) {
    const cur = [i];
    for (let j = 1; j <= h.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (r[i - 1] === h[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[h.length]! / r.length;
}

/** Écarts entre le résultat et l'attendu du manifeste (liste vide = conforme). */
export function mismatches(a: MessageAnalysis, e: Expected): string[] {
  const out: string[] = [];
  const counted = [...new Set(a.chunks.flatMap((c) => (c.status === "matched" ? c.findings.map((f) => f.id) : [])))];
  if (a.status !== e.status) out.push(`status ${a.status} (expected ${e.status})`);
  if (e.status !== "analyzed") return out;
  for (const f of e.findings) if (!counted.includes(f)) out.push(`missing ${f}`);
  for (const f of counted) if (!e.findings.includes(f)) out.push(`unexpected ${f}`);
  for (const f of e.mustNot ?? []) if (counted.includes(f)) out.push(`must not count ${f}`);
  // « pas sûr » attendu : tous les morceaux finissent « pas sûr » (rien de compté, rien « hors liste »).
  if (e.notSure === true && !(a.chunks.length > 0 && a.chunks.every((c) => c.status === "not_sure"))) out.push(`expected every chunk not_sure, got ${a.chunks.map((c) => c.status).join(",")}`);
  // Cueillette : jamais compté ; « hors liste » ou « pas sûr » sous le seuil (les deux alimentent le signal sujet inconnu).
  if (e.offList && a.chunks.some((c) => c.status === "matched")) out.push("off-list sample has a matched chunk");
  return out;
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { samples: Sample[] };
const config = DEFAULT_CONFIG;
const catalog = loadCatalog();
const matcher = await createMatcher(catalog, await getEmbedder("minilm"), config);
const transcriber = await createWhisperTranscriber("onnx-community/whisper-base");
let failed = 0;
for (const s of manifest.samples) {
  const file = isAbsolute(s.file) ? s.file : join(dirname(manifestPath), s.file);
  const a = await analyzeAudioMessage(
    { id: s.id, receivedAt: "2026-09-15T10:00:00Z", audio16k: load(file) },
    { catalog, matcher, config, transcriber, withEnglishTranslation: false },
  );
  const bad = mismatches(a, s.expected);
  if (bad.length) failed++;
  const chunks = a.chunks.map((c) => ({ status: c.status, findings: c.findings.map((f) => f.id), text: c.text }));
  const hyp = a.chunks.map((c) => c.text).join(" ");
  const w = s.transcript ? Math.round(wer(s.transcript, hyp) * 1000) / 1000 : 0;
  if (asJson) console.log(JSON.stringify({ id: s.id, ok: bad.length === 0, mismatches: bad, status: a.status, wer: w, chunks }));
  else {
    console.log(`${bad.length ? "FAIL" : "ok  "} ${s.id.padEnd(20)} ${a.status.padEnd(10)} wer=${w.toFixed(2)} ${bad.join("; ")}`);
    for (const c of chunks) console.log(`       ${c.status.padEnd(9)} ${c.findings.join("+").padEnd(6)} ${c.text}`);
  }
}
if (!asJson) console.log(failed ? `${failed} sample(s) miss their expectation` : "all samples match their expectation");
process.exit(failed ? 1 : 0);
