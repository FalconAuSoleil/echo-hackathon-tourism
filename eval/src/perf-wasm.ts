// Surcoût du backend WebAssembly (celui du navigateur) par rapport au backend natif utilisé dans Node :
// même fichier ONNX, même entrée, 1 thread chacun. Mesuré sur l'encodeur Whisper (l'essentiel du calcul
// d'un message de 30 s) et sur le modèle d'embedding. Sortie : une ligne JSON. Lancé par perf.ts.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const [encoderPath, embedderPath] = process.argv.slice(2) as [string, string];
const require = createRequire(import.meta.url);
// onnxruntime-web est une dépendance de transformers.js (build navigateur) ; on le résout depuis elle.
const main = require.resolve("@huggingface/transformers");
const tjs = main.slice(0, main.indexOf("@huggingface/transformers") + "@huggingface/transformers".length);
const reqT = createRequire(join(tjs, "package.json"));
const ortw = await import(reqT.resolve("onnxruntime-web"));
const ortn = await import(reqT.resolve("onnxruntime-node"));
ortw.env.wasm.numThreads = 1;

async function time(ort: any, opts: object, model: Buffer, feedsOf: (s: any) => Record<string, unknown>, reps = 3) {
  const s = await ort.InferenceSession.create(model, opts);
  const feeds = feedsOf(s);
  await s.run(feeds);
  const t0 = performance.now();
  for (let i = 0; i < reps; i++) await s.run(feeds);
  return (performance.now() - t0) / reps;
}
const enc = readFileSync(encoderPath);
const encFeeds = (ort: any) => (s: any) => ({ [s.inputNames[0]]: new ort.Tensor("float32", new Float32Array(80 * 3000).map((_, i) => Math.sin(i) * 0.5), [1, 80, 3000]) });
const emb = readFileSync(embedderPath);
const embFeeds = (ort: any) => (s: any) => {
  const n = 32;
  const f: Record<string, unknown> = {};
  for (const name of s.inputNames) {
    const data = name === "input_ids" ? BigInt64Array.from({ length: n }, (_, i) => BigInt(5 + (i % 100))) : name === "attention_mask" ? new BigInt64Array(n).fill(1n) : new BigInt64Array(n).fill(0n);
    f[name] = new ort.Tensor("int64", data, [1, n]);
  }
  return f;
};
const r = {
  encoderNative1tMs: await time(ortn, { intraOpNumThreads: 1, interOpNumThreads: 1 }, enc, encFeeds(ortn)),
  encoderWasm1tMs: await time(ortw, { executionProviders: ["wasm"] }, enc, encFeeds(ortw)),
  embedderNative1tMs: await time(ortn, { intraOpNumThreads: 1, interOpNumThreads: 1 }, emb, embFeeds(ortn), 10),
  embedderWasm1tMs: await time(ortw, { executionProviders: ["wasm"] }, emb, embFeeds(ortw), 10),
};
console.log(JSON.stringify({ ...r, encoderWasmFactor: r.encoderWasm1tMs / r.encoderNative1tMs, embedderWasmFactor: r.embedderWasm1tMs / r.embedderNative1tMs }));
