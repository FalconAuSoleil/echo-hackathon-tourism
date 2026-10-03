#!/usr/bin/env node
// Télécharge les modèles ONNX quantifiés dans models/<org>/<nom>/ (disposition Hugging Face),
// pour que transformers.js les charge en local (Node et navigateur) sans passer par le hub.
//
// Usage :
//   node tools/scripts/download-models.mjs            # modèles par défaut (app + éval)
//   node tools/scripts/download-models.mjs --all      # ajoute les candidats plus gros (whisper-small)
//   node tools/scripts/download-models.mjs --only onnx-community/whisper-tiny
//
// Le script est idempotent : un fichier déjà présent avec la bonne taille n'est pas retéléchargé.

import { createWriteStream, existsSync, mkdirSync, statSync, renameSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MODELS_DIR = join(ROOT, "models");
const HF = process.env.HF_ENDPOINT ?? "https://huggingface.co";

const WHISPER_FILES = [
  "config.json",
  "generation_config.json",
  "preprocessor_config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "onnx/encoder_model_quantized.onnx",
  "onnx/decoder_model_merged_quantized.onnx",
];
const EMBEDDER_FILES = [
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "special_tokens_map.json",
  "onnx/model_quantized.onnx",
];

/** Modèles candidats. `default: true` = téléchargé sans option. */
export const MODELS = [
  { id: "onnx-community/whisper-tiny", files: WHISPER_FILES, default: true },
  { id: "onnx-community/whisper-base", files: WHISPER_FILES, default: true },
  { id: "onnx-community/whisper-small", files: WHISPER_FILES, default: false },
  { id: "Xenova/paraphrase-multilingual-MiniLM-L12-v2", files: EMBEDDER_FILES, default: true },
  { id: "Xenova/multilingual-e5-small", files: EMBEDDER_FILES, default: true },
];

const args = process.argv.slice(2);
const all = args.includes("--all");
const onlyIdx = args.indexOf("--only");
const only = onlyIdx >= 0 ? args[onlyIdx + 1]?.split(",") : undefined;

const selected = MODELS.filter((m) => (only ? only.includes(m.id) : all || m.default));
if (selected.length === 0) {
  console.error("Aucun modèle sélectionné. Modèles connus :", MODELS.map((m) => m.id).join(", "));
  process.exit(1);
}

async function remoteSize(url) {
  const res = await fetch(url, { method: "HEAD", redirect: "follow" });
  if (!res.ok) throw new Error(`HEAD ${url} -> ${res.status}`);
  const len = res.headers.get("x-linked-size") ?? res.headers.get("content-length");
  return len ? Number(len) : undefined;
}

async function download(modelId, file) {
  const url = `${HF}/${modelId}/resolve/main/${file}`;
  const dest = join(MODELS_DIR, modelId, file);
  mkdirSync(dirname(dest), { recursive: true });
  const size = await remoteSize(url).catch(() => undefined);
  if (existsSync(dest) && (size === undefined || statSync(dest).size === size)) {
    console.log(`  ok    ${file}`);
    return statSync(dest).size;
  }
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`GET ${url} -> ${res.status}`);
  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  renameSync(tmp, dest);
  const got = statSync(dest).size;
  console.log(`  get   ${file} (${(got / 1e6).toFixed(1)} MB)`);
  return got;
}

let total = 0;
for (const m of selected) {
  console.log(`${m.id}`);
  let sub = 0;
  for (const f of m.files) sub += await download(m.id, f);
  console.log(`  total ${(sub / 1e6).toFixed(1)} MB`);
  total += sub;
}
console.log(`Terminé : ${(total / 1e6).toFixed(1)} MB dans ${MODELS_DIR}`);
