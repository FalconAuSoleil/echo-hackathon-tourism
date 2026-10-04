// Performances (SPEC 9) : taille des modèles, mémoire de pointe, temps pour un message de 30 s.
// Chaque mesure tourne dans un processus séparé (perf-child.ts) ; le nombre de threads d'onnxruntime est
// limité (tous, 2, 1) pour approcher un téléphone d'entrée de gamme (ESTIMATION, voir docs/MANUAL_TESTS.md pour
// la mesure sur un vrai Android).
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { join } from "node:path";
import { MODELS } from "@echo/models";
import { loadAudio16k, readJson, readJsonl, round, writeJson } from "./lib/io.ts";
import { DATA_DIR, MODELS_DIR, RAW_DIR, RESULTS_DIR, ROOT, abs } from "./lib/paths.ts";
import { WHISPER_IDS, whisperAvailable } from "./lib/asr.ts";

function dirSize(dir: string): number {
  if (!existsSync(dir)) return 0;
  let s = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    s += e.isDirectory() ? dirSize(p) : statSync(p).size;
  }
  return s;
}

/** Fichiers réellement chargés par transformers.js (ONNX q8 + tokenizer + configs). */
function modelFiles(id: string) {
  const dir = join(MODELS_DIR, id);
  const files: { file: string; bytes: number }[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else files.push({ file: p.slice(dir.length + 1), bytes: statSync(p).size });
    }
  };
  if (existsSync(dir)) walk(dir);
  return files;
}

/** Message de 30 s : clips propres d'une langue mis bout à bout (voix SYNTHÉTIQUES), coupé à 30,0 s. */
function make30s(lang: string): string {
  const rows = readJsonl<{ id: string; lang: string; clean: string }>(join(DATA_DIR, "audio_manifest.jsonl")).filter((r) => r.lang === lang);
  const parts: Float32Array[] = [];
  let n = 0;
  const gap = new Float32Array(16000 * 0.3);
  for (const r of rows) {
    if (n >= 30 * 16000) break;
    const a = loadAudio16k(abs(r.clean));
    parts.push(a, gap);
    n += a.length + gap.length;
  }
  const out = new Float32Array(30 * 16000);
  let o = 0;
  for (const p of parts) {
    out.set(p.subarray(0, Math.min(p.length, out.length - o)), o);
    o += p.length;
    if (o >= out.length) break;
  }
  const path = join(RAW_DIR, `perf-30s-${lang}.f32`);
  writeFileSync(path, Buffer.from(out.buffer));
  // même message en WAV, pour la mesure manuelle sur un vrai téléphone (docs/MANUAL_TESTS.md)
  execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "f32le", "-ar", "16000", "-ac", "1", "-i", path, join(RAW_DIR, `perf-30s-${lang}.wav`)]);
  return path;
}

export async function runPerf(opts: { sizes: string[]; log: (s: string) => void; threads?: string[]; appWhisper?: string }) {
  const log = opts.log;
  const l2 = readJson<{ config: object; calibration: { embeddingModel: string } }>(join(RESULTS_DIR, "level2.json"));
  const configPath = join(RAW_DIR, "perf-config.json");
  writeJson(configPath, l2.config);
  const embId = l2.calibration.embeddingModel;

  const sizes = Object.fromEntries(
    Object.keys(MODELS).map((id) => {
      const files = modelFiles(id);
      return [id, { present: files.length > 0, totalMB: round(files.reduce((a, f) => a + f.bytes, 0) / 1e6, 1), files: files.map((f) => ({ ...f, mb: round(f.bytes / 1e6, 1) })) }];
    }),
  );

  const audioFr = make30s("fr");
  const runs: Record<string, unknown>[] = [];
  const ncpu = cpus().length;
  const threadSets = opts.threads ?? ["all", "2", "1"];
  for (const size of opts.sizes.filter(whisperAvailable)) {
    for (const th of threadSets) {
      const before = loadavg()[0]!;
      try {
        const outStr = execFileSync(process.execPath, ["--import", "tsx", join(ROOT, "eval", "src", "perf-child.ts"), WHISPER_IDS[size]!, embId, audioFr, configPath, th], {
          cwd: join(ROOT, "eval"),
          encoding: "utf8",
          maxBuffer: 1 << 24,
          timeout: 30 * 60 * 1000,
          stdio: ["ignore", "pipe", "pipe"],
        });
        const line = outStr.trim().split("\n").filter((l) => l.startsWith("{")).pop()!;
        const r = { whisper: `whisper-${size}`, cores: th, loadAverage1mBefore: round(before, 1), ...JSON.parse(line) };
        runs.push(r);
        log(`[perf] whisper-${size} threads=${th}: 30 s message ${r.message30sWithTranslationSec.toFixed(1)} s (no translation ${r.message30sNoTranslationSec.toFixed(1)} s), peak RSS ${r.peakRssMB.toFixed(0)} MB`);
      } catch (e) {
        const msg = (e as { stderr?: string }).stderr?.toString().slice(-400) ?? String(e);
        runs.push({ whisper: `whisper-${size}`, cores: th, error: msg });
        log(`[perf] whisper-${size} threads=${th}: FAILED ${msg.slice(0, 200)}`);
      }
    }
  }
  // Surcoût WebAssembly (navigateur) mesuré ici, 1 thread, encodeur Whisper + modèle d'embedding.
  const wasm: Record<string, unknown> = {};
  for (const size of opts.sizes.filter(whisperAvailable)) {
    try {
      const o = execFileSync(process.execPath, ["--import", "tsx", join(ROOT, "eval", "src", "perf-wasm.ts"),
        join(MODELS_DIR, WHISPER_IDS[size]!, "onnx", "encoder_model_quantized.onnx"), join(MODELS_DIR, embId, "onnx", "model_quantized.onnx")], { cwd: join(ROOT, "eval"), encoding: "utf8", timeout: 20 * 60 * 1000, stdio: ["ignore", "pipe", "pipe"] });
      wasm[`whisper-${size}`] = JSON.parse(o.trim().split("\n").pop()!);
      log(`[perf] wasm overhead whisper-${size}: encoder x${(wasm[`whisper-${size}`] as { encoderWasmFactor: number }).encoderWasmFactor.toFixed(1)}`);
    } catch (e) {
      wasm[`whisper-${size}`] = { error: String((e as { stderr?: string }).stderr ?? e).slice(-300) };
    }
  }

  // Estimation pour un Android d'entrée de gamme (PAS une mesure) : temps natif 1 cœur mesuré ici
  // × surcoût WebAssembly mesuré ici × écart de vitesse par cœur supposé (hypothèse, voir texte).
  const PER_CORE_SLOWDOWN: [number, number] = [3, 8];
  const estimate = opts.sizes.filter(whisperAvailable).flatMap((size) => {
    const r1 = runs.find((r) => r.whisper === `whisper-${size}` && r.cores === "1" && !r.error) as Record<string, number> | undefined;
    const wf = (wasm[`whisper-${size}`] as { encoderWasmFactor?: number } | undefined)?.encoderWasmFactor;
    if (!r1 || !wf) return [];
    const lo = (x: number) => round(x * wf * PER_CORE_SLOWDOWN[0], 0);
    const hi = (x: number) => round(x * wf * PER_CORE_SLOWDOWN[1], 0);
    return [{ whisper: `whisper-${size}`, native1CoreWithTranslationSec: round(r1.message30sWithTranslationSec!, 1), native1CoreNoTranslationSec: round(r1.message30sNoTranslationSec!, 1), wasmFactor: round(wf, 2),
      estimateWithTranslationSec: [lo(r1.message30sWithTranslationSec!), hi(r1.message30sWithTranslationSec!)], estimateNoTranslationSec: [lo(r1.message30sNoTranslationSec!), hi(r1.message30sNoTranslationSec!)], peakRssMB: round(r1.peakRssMB!, 0) }];
  });
  const androidEstimate = {
    perCoreSlowdownAssumed: PER_CORE_SLOWDOWN,
    rows: estimate,
    lines: [
      "Method: (time for a 30 s message measured here with **1 onnxruntime thread**, native backend) × (WebAssembly overhead **measured here**:",
      "same ONNX file, 1 thread, onnxruntime-web vs onnxruntime-node — the browser runs WebAssembly) × (per-core speed gap between this",
      `laptop core and an entry-level phone core, **assumed** ${PER_CORE_SLOWDOWN[0]}–${PER_CORE_SLOWDOWN[1]}×: public single-core benchmark ratios between a 2024 laptop`,
      "core and Cortex-A55/A75-class entry phones are in that range; not measured here). One thread is used (the browser only gets",
      "WebAssembly threads with cross-origin isolation), so a phone using 2–4 threads would be faster. Peak memory is the native",
      "process here; a browser tab adds its own overhead.",
      "",
      ...estimate.map((e) => `- ${e.whisper}: **~${e.estimateNoTranslationSec[0]}–${e.estimateNoTranslationSec[1]} s** per 30 s message (transcription + analysis), **~${e.estimateWithTranslationSec[0]}–${e.estimateWithTranslationSec[1]} s** with the English translation for the review list (native 1 thread here: ${e.native1CoreNoTranslationSec} s / ${e.native1CoreWithTranslationSec} s; WASM ×${e.wasmFactor}).`),
      "",
      "This is an estimate. Messages are processed in a queue in the background (SPEC 4.2), so minutes per message is usable for 6–7 messages a month, but it must be confirmed on a real phone.",
    ],
  };

  let cpuModel = "";
  try {
    cpuModel = /model name\s*:\s*(.*)/.exec(execFileSync("cat", ["/proc/cpuinfo"], { encoding: "utf8" }))?.[1] ?? "";
  } catch {
    /* ignore */
  }
  const out = {
    machine: { cpuModel, logicalCpus: ncpu, platform: "Linux WSL2, Node " + process.version + ", onnxruntime-node (transformers.js 4)" },
    message: "30.0 s French message made of concatenated SYNTHETIC Piper clips (not English, so with the English translation it adds a timestamped Whisper pass and, after the analysis, the translation of each segment that holds a not-sure or off-list chunk and no counted chunk, cut out and translated alone; several of its segments are unclear, so it is close to a worst case)",
    modelSizes: sizes,
    runs,
    wasmOverhead: wasm,
    androidEstimate,
    appDownload: {
      models: [WHISPER_IDS[opts.appWhisper ?? "base"]!, embId],
      totalMB: round(((sizes[WHISPER_IDS[opts.appWhisper ?? "base"]!]?.totalMB as number) ?? 0) + ((sizes[embId]?.totalMB as number) ?? 0), 1),
    },
  };
  writeJson(join(RESULTS_DIR, "perf.json"), out);
  return out;
}
