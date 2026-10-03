/// <reference lib="webworker" />
// Web Worker d'analyse : Whisper + modèle de similarité (transformers.js, WASM) + @echo/core.
// Tout tourne sur l'appareil : modèles et runtime viennent de la même origine que l'app (jamais d'un hub
// ni d'un CDN), mis en cache une fois (Cache Storage) pour marcher en mode avion ensuite.
import { env } from "@huggingface/transformers";
import {
  DEFAULT_CONFIG,
  analyzeAudioMessage,
  analyzeMessage,
  cosine,
  createMatcher,
  validateCatalog,
  type Catalog,
  type LinearClassifier,
  type Matcher,
  type Transcriber,
} from "@echo/core";
import { DEFAULT_EMBEDDING_MODEL, createEmbedder, createWhisperTranscriber } from "@echo/models";
import type { AssetsManifest, InitInfo, Stage, WorkerEvent, WorkerRequest } from "./protocol.ts";

declare const self: DedicatedWorkerGlobalScope;

const CACHE = "transformers-cache"; // cache que transformers.js consulte lui-même (tryCache sur le chemin local)

const post = (e: WorkerEvent, transfer: Transferable[] = []): void => self.postMessage(e, transfer);
const progress = (stage: Stage, loaded: number, total: number, file?: string): void => post({ kind: "progress", stage, loaded, total, file });

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = "/models/";
env.useBrowserCache = true;
env.cacheKey = CACHE;
const threads = self.crossOriginIsolated ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1)) : 1;
const onnx = env.backends.onnx as { wasm?: { wasmPaths?: unknown; numThreads?: number; proxy?: boolean } };
if (onnx.wasm) {
  onnx.wasm.wasmPaths = { mjs: "/ort/ort-wasm-simd-threaded.asyncify.mjs", wasm: "/ort/ort-wasm-simd-threaded.asyncify.wasm" };
  onnx.wasm.numThreads = threads;
}

/** Télécharge une fois les fichiers de modèles dans le cache, avec progression (flux, sans tout garder en mémoire). */
async function ensureModelFiles(manifest: AssetsManifest): Promise<void> {
  const cache = await caches.open(CACHE);
  const files = [...manifest.modelFiles];
  const total = files.reduce((s, f) => s + f.bytes, 0);
  let done = 0;
  for (const f of files) {
    const hit = await cache.match(f.url);
    if (hit) {
      done += f.bytes;
      progress("download", done, total, f.url);
      continue;
    }
    const res = await fetch(f.url, { cache: "no-store" });
    if (!res.ok || !res.body) throw new Error(`cannot download ${f.url}: HTTP ${res.status}`);
    const start = done;
    let got = 0;
    let last = 0;
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctl) {
        got += chunk.byteLength;
        const now = performance.now();
        if (now - last > 150) {
          last = now;
          progress("download", start + got, total, f.url);
        }
        ctl.enqueue(chunk);
      },
    });
    const headers = new Headers({ "content-type": res.headers.get("content-type") ?? "application/octet-stream", "content-length": String(f.bytes) });
    await cache.put(f.url, new Response(res.body.pipeThrough(counter), { headers }));
    done = start + f.bytes;
    progress("download", done, total, f.url);
  }
}

interface Precomputed {
  map: Map<string, Float32Array>;
  classifier?: LinearClassifier;
}

async function loadPrecomputed(manifest: AssetsManifest, embeddingModel: string): Promise<Precomputed | null> {
  if (!manifest.precomputed) return null;
  try {
    const [metaRes, binRes] = await Promise.all([fetch(manifest.precomputed.meta), fetch(manifest.precomputed.file)]);
    if (!metaRes.ok || !binRes.ok) return null;
    const meta = (await metaRes.json()) as {
      model: string;
      dim: number;
      texts: string[];
      classifier: { classes: string[]; dim: number; offset: number; length: number } | null;
      config: { scoring: string; linearL2: number; linearEpochs: number };
    };
    if (meta.model !== embeddingModel) return null;
    if (meta.config.linearL2 !== DEFAULT_CONFIG.linearL2 || meta.config.linearEpochs !== DEFAULT_CONFIG.linearEpochs) return null;
    const buf = new Float32Array(await binRes.arrayBuffer());
    const map = new Map<string, Float32Array>();
    meta.texts.forEach((t, i) => map.set(t, buf.slice(i * meta.dim, (i + 1) * meta.dim)));
    const classifier = meta.classifier
      ? { classes: meta.classifier.classes, dim: meta.classifier.dim, weights: buf.slice(meta.classifier.offset, meta.classifier.offset + meta.classifier.length) }
      : undefined;
    return { map, classifier };
  } catch {
    return null;
  }
}

interface Engine {
  catalog: Catalog;
  matcher: Matcher;
  transcriber: Transcriber;
  info: InitInfo;
}

let enginePromise: Promise<Engine> | null = null;

async function init(): Promise<Engine> {
  const t0 = performance.now();
  const manifest = (await (await fetch("/assets-manifest.json")).json()) as AssetsManifest;
  const catalog = validateCatalog(await (await fetch("/catalog/catalog.json")).json());
  // Les seuils livrés (DEFAULT_CONFIG, calibrés par l'évaluation) n'ont de sens qu'avec le modèle d'embedding
  // de la calibration : refuser des fichiers préparés pour un autre modèle plutôt que de classer au hasard.
  if (manifest.embeddingModel.id !== DEFAULT_EMBEDDING_MODEL) {
    throw new Error(`assets prepared for ${manifest.embeddingModel.id} but thresholds calibrated for ${DEFAULT_EMBEDDING_MODEL}: rebuild the app (pnpm build)`);
  }
  await ensureModelFiles(manifest);

  progress("load-asr", 0, 1);
  const transcriber = await createWhisperTranscriber(manifest.asrModel.id, { device: "wasm" });
  progress("load-asr", 1, 1);
  progress("load-embedder", 0, 1);
  // Taille de lot par défaut de l'adaptateur, comme l'évaluation (résultats reproductibles).
  const embed = await createEmbedder(manifest.embeddingModel.id, { device: "wasm" });
  progress("load-embedder", 1, 1);

  progress("prepare-catalog", 0, 1);
  const pre = await loadPrecomputed(manifest, manifest.embeddingModel.id);
  let source: InitInfo["examples"]["source"] = "computed_on_device";
  let check: number | undefined;
  let precomputed: Map<string, Float32Array> | undefined;
  if (pre) {
    // Vérifie sur l'appareil que les vecteurs pré-calculés au build sont bien ceux de ce modèle.
    const probe = [...pre.map.keys()].filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 4)) === 0).slice(0, 4);
    const fresh = await embed(probe);
    check = Math.min(...probe.map((t, i) => cosine(fresh[i]!, pre.map.get(t)!)));
    if (check >= 0.99) {
      precomputed = pre.map;
      source = "precomputed";
    }
  }
  const matcher = await createMatcher(catalog, embed, DEFAULT_CONFIG, {
    ...(precomputed ? { precomputed } : {}),
    ...(precomputed && pre?.classifier ? { classifier: pre.classifier } : {}),
  });
  progress("prepare-catalog", 1, 1);
  progress("ready", 1, 1);
  return {
    catalog,
    matcher,
    transcriber,
    info: {
      asrModel: manifest.asrModel.id,
      embeddingModel: manifest.embeddingModel.id,
      examples: { count: matcher.examples.length, source, ...(check !== undefined ? { check: Math.round(check * 10000) / 10000 } : {}) },
      backend: { threads, crossOriginIsolated: self.crossOriginIsolated },
      loadMs: Math.round(performance.now() - t0),
    },
  };
}

function engine(): Promise<Engine> {
  if (!enginePromise) {
    enginePromise = init();
    enginePromise.catch(() => (enginePromise = null));
  }
  return enginePromise;
}

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  try {
    if (req.kind === "init") {
      const e = await engine();
      post({ kind: "result", reqId: req.reqId, info: e.info });
      return;
    }
    const e = await engine();
    if (req.kind === "embed") {
      // Diagnostic (test e2e) : vecteurs du modèle de similarité tel qu'il tourne dans ce navigateur.
      post({ kind: "result", reqId: req.reqId, vectors: await e.matcher.embed(req.texts) });
      return;
    }
    const deps = { catalog: e.catalog, matcher: e.matcher, config: DEFAULT_CONFIG, knownMessages: req.knownMessages };
    const t0 = performance.now();
    if (req.kind === "analyzeAudio") {
      let transcribeMs = 0;
      // Transcriber enveloppé : dès la fin de la transcription, l'interface est prévenue et supprime le
      // fichier audio de sa file ; le tampon est remis à zéro par analyzeAudioMessage.
      const transcriber: Transcriber = {
        async transcribe(audio, options) {
          const ts = performance.now();
          try {
            return await e.transcriber.transcribe(audio, options);
          } finally {
            transcribeMs = performance.now() - ts;
            post({ kind: "transcribed", reqId: req.reqId, id: req.id });
          }
        },
      };
      const analysis = await analyzeAudioMessage(
        { id: req.id, receivedAt: req.receivedAt, audio16k: req.audio },
        { ...deps, transcriber, withEnglishTranslation: true },
      );
      if (!transcribeMs) post({ kind: "transcribed", reqId: req.reqId, id: req.id }); // inaudible : pas transcrit, audio effacé quand même
      const total = performance.now() - t0;
      post({ kind: "result", reqId: req.reqId, analysis, timings: { transcribeMs: Math.round(transcribeMs), analyzeMs: Math.round(total - transcribeMs), totalMs: Math.round(total) } });
      return;
    }
    if (req.kind === "analyzeText") {
      const analysis = await analyzeMessage({ id: req.id, receivedAt: req.receivedAt, source: "text", text: req.text }, deps);
      const total = Math.round(performance.now() - t0);
      post({ kind: "result", reqId: req.reqId, analysis, timings: { analyzeMs: total, totalMs: total } });
    }
  } catch (err) {
    post({ kind: "error", reqId: req.reqId, message: err instanceof Error ? err.message : String(err) });
  }
};
