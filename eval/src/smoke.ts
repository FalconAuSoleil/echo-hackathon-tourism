// Test de fumée des modèles : transcrit un clip TTS anglais (ffmpeg + flite, synthétique) avec chaque
// Whisper présent dans models/, et compare quelques phrases multilingues avec chaque modèle d'embedding.
// Usage : pnpm smoke:models   (après pnpm models:download)
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cosine } from "@echo/core";
import { MODELS, createEmbedder, createWhisperTranscriber, useLocalModels } from "@echo/models";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MODELS_DIR = join(ROOT, "models");
useLocalModels(MODELS_DIR);

function synthEnglish(text: string): Float32Array {
  // flite : voix anglaise de synthèse, intégrée à ffmpeg. Sortie PCM float 16 kHz mono.
  const buf = execFileSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", `flite=text='${text.replace(/'/g, "")}':voice=slt`,
    "-ar", "16000", "-ac", "1", "-f", "f32le", "-",
  ]);
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

const present = (id: string) => existsSync(join(MODELS_DIR, id, MODELS[id]!.onnxFiles[0]!));
const mb = () => Math.round(process.memoryUsage().rss / 1e6);

const sentence = "The coffee tasting was wonderful, but the path to the farm was far too long.";
const audio = synthEnglish(sentence);
console.log(`clip: ${(audio.length / 16000).toFixed(1)} s (synthetic flite voice) — "${sentence}"`);

for (const id of Object.keys(MODELS).filter((m) => MODELS[m]!.kind === "asr" && present(m))) {
  const t0 = performance.now();
  const asr = await createWhisperTranscriber(id);
  const t1 = performance.now();
  const r = await asr.transcribe(audio, { withEnglishTranslation: false });
  const t2 = performance.now();
  console.log(`\n[${id}] load ${(t1 - t0).toFixed(0)} ms, transcribe ${(t2 - t1).toFixed(0)} ms, rss ${mb()} MB`);
  console.log(`  lang=${r.language} p=${r.languageProbability?.toFixed(3)} conf=${r.confidence.toFixed(3)}`);
  console.log(`  text: ${r.text}`);
}

const pairs: [string, string][] = [
  ["The path to the farm was far too long.", "Der Weg zum Hof war viel zu lang."],
  ["The path to the farm was far too long.", "Le chemin pour arriver à la ferme était beaucoup trop long."],
  ["The path to the farm was far too long.", "El almuerzo estaba delicioso."],
  ["The path was not too long.", "The path was far too long."],
];
for (const id of Object.keys(MODELS).filter((m) => MODELS[m]!.kind === "embedding" && present(m))) {
  const t0 = performance.now();
  const embed = await createEmbedder(id);
  const t1 = performance.now();
  const vecs = await embed(pairs.flat());
  const t2 = performance.now();
  console.log(`\n[${id}] load ${(t1 - t0).toFixed(0)} ms, embed ${pairs.length * 2} sentences ${(t2 - t1).toFixed(0)} ms, dim ${vecs[0]!.length}, rss ${mb()} MB`);
  pairs.forEach(([a, b], i) => console.log(`  ${cosine(vecs[2 * i]!, vecs[2 * i + 1]!).toFixed(3)}  "${a}" ~ "${b}"`));
}
