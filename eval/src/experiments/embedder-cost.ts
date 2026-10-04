// Coût d'un modèle d'embedding, seul dans son processus : taille des fichiers, mémoire de pointe (VmHWM) et temps,
// avec onnxruntime-node (transformers.js, comme l'éval) ou onnxruntime-web WASM 1 thread (moteur du navigateur).
// Usage : npx tsx src/experiments/embedder-cost.ts <modelId> node|wasm
import { readFileSync, statSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { MODELS_DIR } from "../lib/paths.ts";

const [modelId, mode, optLevel] = process.argv.slice(2) as [string, "node" | "wasm", string | undefined];
const hwm = () => Number(/VmHWM:\s+(\d+) kB/.exec(readFileSync("/proc/self/status", "utf8"))![1]) / 1024;
const dir = join(MODELS_DIR, modelId);
const size = (d: string): number => readdirSync(d, { withFileTypes: true }).reduce((a, e) => a + (e.isDirectory() ? size(join(d, e.name)) : statSync(join(d, e.name)).size), 0);
const base = hwm();
const sentences = Array.from({ length: 40 }, (_, i) => `The visit number ${i} was lovely and the coffee tasting was the best part of our afternoon at the farm.`);
let out: Record<string, unknown> = { modelId, mode, filesMB: +(size(dir) / 1e6).toFixed(1), baseHwmMB: +base.toFixed(0) };
if (mode === "node") {
  const { createEmbedder, useLocalModels } = await import("@echo/models");
  useLocalModels(MODELS_DIR);
  const t0 = performance.now();
  const embed = await createEmbedder(modelId, { threads: 1 });
  const t1 = performance.now();
  await embed(sentences);
  const t2 = performance.now();
  out = { ...out, optLevel: optLevel ?? "default", loadSec: +((t1 - t0) / 1000).toFixed(2), msPerSentence1t: +((t2 - t1) / sentences.length).toFixed(1), peakHwmMB: +hwm().toFixed(0) };
} else {
  const require = createRequire(import.meta.url);
  const main = require.resolve("@huggingface/transformers");
  const tjs = main.slice(0, main.indexOf("@huggingface/transformers") + "@huggingface/transformers".length);
  const ortw = await import(createRequire(join(tjs, "package.json")).resolve("onnxruntime-web"));
  ortw.env.wasm.numThreads = 1;
  const t0 = performance.now();
  const s = await ortw.InferenceSession.create(readFileSync(join(dir, "onnx", "model_quantized.onnx")), { executionProviders: ["wasm"], ...(optLevel ? { graphOptimizationLevel: optLevel } : {}) });
  const t1 = performance.now();
  const n = 32;
  const feeds: Record<string, unknown> = {};
  for (const name of s.inputNames) {
    const data = name === "input_ids" ? BigInt64Array.from({ length: n }, (_, i) => BigInt(5 + (i % 100))) : name === "attention_mask" ? new BigInt64Array(n).fill(1n) : new BigInt64Array(n).fill(0n);
    feeds[name] = new ortw.Tensor("int64", data, [1, n]);
  }
  await s.run(feeds);
  const t2 = performance.now();
  for (let i = 0; i < 10; i++) await s.run(feeds);
  const t3 = performance.now();
  out = { ...out, optLevel: optLevel ?? "default", loadSec: +((t1 - t0) / 1000).toFixed(2), msPer32Tokens1t: +((t3 - t2) / 10).toFixed(1), peakHwmMB: +hwm().toFixed(0) };
}
console.log(JSON.stringify(out));
