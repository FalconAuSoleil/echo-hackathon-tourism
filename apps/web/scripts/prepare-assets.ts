// Prépare public/ avant `vite dev` / `vite build` (tout est git-ignoré et recréable) :
//   - models/<id>/...     modèles ONNX quantifiés (ASR + embedding livrés), liens durs depuis models/ du dépôt
//                         (téléchargés par `pnpm models:download` s'ils manquent) ;
//   - ort/                runtime onnxruntime-web (WASM) servi par l'app elle-même, jamais par un CDN ;
//   - catalog/            catalog.json + clips audio kinyarwanda ;
//   - samples/            messages d'exemple de la démo (voix de synthèse, eval/data/demo-samples/) ;
//   - keywords/           listes de mots-clés de la méthode de comparaison (eval/keywords-blind/, la référence
//                         principale du README : écrites sans voir le corpus d'évaluation) ;
//   - precomputed/        embeddings des exemples du catalogue + classifieur linéaire, calculés ICI avec le même
//                         modèle et le même code (@echo/models, @echo/core) pour que le téléphone n'ait pas à
//                         plonger les 1 260 exemples au premier lancement ; vérifiés sur l'appareil au démarrage ;
//   - assets-manifest.json  liste des fichiers de modèles (tailles) et des choix (seuils, modèles).
//
// Usage : tsx scripts/prepare-assets.ts [--no-precompute]
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, linkSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CALIBRATION, DEFAULT_CONFIG, createMatcher, validateCatalog, exportExampleEmbeddings } from "@echo/core";
import { DEFAULT_ASR_MODEL, DEFAULT_EMBEDDING_MODEL, MODELS, createEmbedder, useLocalModels } from "@echo/models";

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(WEB, "..", "..");
const PUB = join(WEB, "public");
const args = process.argv.slice(2);

function log(...a: unknown[]): void {
  console.log("[assets]", ...a);
}

/** Lien dur (pas de copie de 200 Mo), sinon copie. Ne refait rien si la taille est identique. */
function place(src: string, dest: string): number {
  mkdirSync(dirname(dest), { recursive: true });
  const size = statSync(src).size;
  if (existsSync(dest) && statSync(dest).size === size) return size;
  rmSync(dest, { force: true });
  try {
    linkSync(src, dest);
  } catch {
    copyFileSync(src, dest);
  }
  return size;
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}

// 1. Modèles livrés (ceux du registre : l'ASR par défaut et l'embedding avec lequel les seuils ont été calibrés).
const shipped = [DEFAULT_ASR_MODEL, DEFAULT_EMBEDDING_MODEL];
const modelFiles: { url: string; bytes: number; model: string }[] = [];
for (const id of shipped) {
  const info = MODELS[id];
  if (!info) throw new Error(`unknown model ${id}`);
  const dir = join(ROOT, "models", id);
  const missing = !existsSync(dir) || info.onnxFiles.some((f) => !existsSync(join(dir, f)));
  if (missing) {
    log(`model ${id} missing in models/: running pnpm models:download --only ${id}`);
    execFileSync("node", [join(ROOT, "tools/scripts/download-models.mjs"), "--only", id], { stdio: "inherit" });
  }
  for (const file of walk(dir)) {
    const rel = relative(dir, file).replaceAll("\\", "/");
    if (rel.endsWith(".part")) continue;
    // Seuls les ONNX quantifiés utilisés sont livrés (les autres variantes ne servent à rien sur le téléphone).
    if (rel.endsWith(".onnx") && !info.onnxFiles.includes(rel)) continue;
    const bytes = place(file, join(PUB, "models", id, rel));
    modelFiles.push({ url: `/models/${id}/${rel}`, bytes, model: id });
  }
}
// Retire les modèles qui ne sont plus livrés (changement de choix après l'évaluation).
if (existsSync(join(PUB, "models"))) {
  for (const org of readdirSync(join(PUB, "models"))) {
    for (const name of readdirSync(join(PUB, "models", org))) {
      if (!shipped.includes(`${org}/${name}`)) rmSync(join(PUB, "models", org, name), { recursive: true, force: true });
    }
  }
}

// 2. Runtime onnxruntime-web : la version importée par transformers.js.
const req = (await import("node:module")).createRequire(import.meta.url);
const transformersDir = dirname(dirname(req.resolve("@huggingface/transformers")));
const ortReq = (await import("node:module")).createRequire(join(transformersDir, "package.json"));
const ortDist = dirname(ortReq.resolve("onnxruntime-web"));
const ORT_FILES = ["ort-wasm-simd-threaded.asyncify.mjs", "ort-wasm-simd-threaded.asyncify.wasm"];
const ortFiles: { url: string; bytes: number }[] = [];
rmSync(join(PUB, "ort"), { recursive: true, force: true });
for (const f of ORT_FILES) ortFiles.push({ url: `/ort/${f}`, bytes: place(join(ortDist, f), join(PUB, "ort", f)) });

// 3. Catalogue + audio, échantillons de démo, mots-clés.
const catalogRaw = readFileSync(join(ROOT, "catalog/catalog.json"), "utf8");
const catalog = validateCatalog(JSON.parse(catalogRaw));
place(join(ROOT, "catalog/catalog.json"), join(PUB, "catalog/catalog.json"));
for (const f of readdirSync(join(ROOT, "catalog/audio"))) place(join(ROOT, "catalog/audio", f), join(PUB, "catalog/audio", f));
const samplesDir = join(ROOT, "eval/data/demo-samples");
for (const f of readdirSync(samplesDir)) place(join(samplesDir, f), join(PUB, "samples", f));
const kwDir = join(ROOT, "eval/keywords-blind");
const kwFiles = readdirSync(kwDir).filter((f) => /^[a-z]{2}\.json$/.test(f));
// Dossier vidé d'abord : `place` garde un fichier existant de même taille (ancien jeu eval/keywords/).
rmSync(join(PUB, "keywords"), { recursive: true, force: true });
for (const f of kwFiles) place(join(kwDir, f), join(PUB, "keywords", f));

// 4. Embeddings pré-calculés (cache dans .cache/ selon catalogue + modèle + réglages du classifieur).
const embModel = DEFAULT_EMBEDDING_MODEL;
const key = createHash("sha256")
  .update(catalogRaw)
  .update(embModel)
  // Le code qui produit les vecteurs et le classifieur fait partie de la clé (adaptateur, négation, matcher, classifieur).
  .update(["packages/models/src/embedder.ts", "packages/core/src/matcher.ts", "packages/core/src/linear.ts", "packages/core/src/negation.ts"].map((f) => readFileSync(join(ROOT, f), "utf8")).join("\n"))
  .update(JSON.stringify(DEFAULT_CONFIG))
  .digest("hex")
  .slice(0, 16);
const preName = `examples-${key}`;
let precomputed: { file: string; meta: string } | null = null;
if (!args.includes("--no-precompute")) {
  const cacheDir = join(WEB, ".cache");
  const binCache = join(cacheDir, `${preName}.bin`);
  const metaCache = join(cacheDir, `${preName}.json`);
  if (!existsSync(binCache) || !existsSync(metaCache)) {
    log(`embedding ${catalog.findings.reduce((s, f) => s + Object.values(f.examples).flat().length, 0)} catalog examples with ${embModel} (Node, same adapter as the app)...`);
    const t0 = Date.now();
    useLocalModels(join(ROOT, "models"));
    const embed = await createEmbedder(embModel);
    const matcher = await createMatcher(catalog, embed, DEFAULT_CONFIG);
    const map = exportExampleEmbeddings(matcher);
    const texts = [...map.keys()];
    const dim = map.get(texts[0]!)!.length;
    const clf = matcher.classifier;
    const floats = texts.length * dim + (clf ? clf.weights.length : 0);
    const buf = new Float32Array(floats);
    texts.forEach((t, i) => buf.set(map.get(t)!, i * dim));
    if (clf) buf.set(clf.weights, texts.length * dim);
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(binCache, Buffer.from(buf.buffer));
    writeFileSync(
      metaCache,
      JSON.stringify({
        model: embModel,
        dim,
        texts,
        classifier: clf ? { classes: clf.classes, dim: clf.dim, offset: texts.length * dim, length: clf.weights.length } : null,
        config: { scoring: DEFAULT_CONFIG.scoring, linearL2: DEFAULT_CONFIG.linearL2, linearEpochs: DEFAULT_CONFIG.linearEpochs },
        builtWith: "onnxruntime-node (q8), @echo/models createEmbedder, @echo/core createMatcher",
        catalogVersion: catalog.version,
      }),
    );
    log(`precomputed ${texts.length} example embeddings in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
  rmSync(join(PUB, "precomputed"), { recursive: true, force: true });
  place(binCache, join(PUB, "precomputed", `${preName}.bin`));
  place(metaCache, join(PUB, "precomputed", `${preName}.json`));
  precomputed = { file: `/precomputed/${preName}.bin`, meta: `/precomputed/${preName}.json` };
}

// 5. Manifeste lu par l'app (taille des modèles, téléchargement avec progression, seuils).
const thresholdsFile = join(ROOT, "eval/results/thresholds.json");
const manifest = {
  builtAt: new Date().toISOString(),
  asrModel: { id: DEFAULT_ASR_MODEL, license: MODELS[DEFAULT_ASR_MODEL]!.license, source: MODELS[DEFAULT_ASR_MODEL]!.source },
  embeddingModel: { id: embModel, license: MODELS[embModel]!.license, source: MODELS[embModel]!.source },
  modelFiles,
  ortFiles,
  precomputed,
  catalog: { version: catalog.version, findings: catalog.findings.length },
  keywords: kwFiles.map((f) => `/keywords/${f}`),
  thresholds: {
    source: existsSync(thresholdsFile) ? "eval/results/thresholds.json → packages/core/src/calibration.ts (generated by pnpm eval -- --level 2)" : "default (no evaluation results found)",
    calibratedAt: CALIBRATION.calibratedAt,
    scoring: DEFAULT_CONFIG.scoring,
    acceptProbability: DEFAULT_CONFIG.acceptProbability,
    acceptThreshold: DEFAULT_CONFIG.acceptThreshold,
    offListThreshold: DEFAULT_CONFIG.offListThreshold,
    calibratedEmbeddingModel: CALIBRATION.embeddingModel,
  },
};
writeFileSync(join(PUB, "assets-manifest.json"), JSON.stringify(manifest, null, 2));
const mb = (b: number): string => (b / 1e6).toFixed(1);
log(
  `ready: ${shipped.join(" + ")} = ${mb(modelFiles.reduce((s, f) => s + f.bytes, 0))} MB, ort ${mb(ortFiles.reduce((s, f) => s + f.bytes, 0))} MB, ` +
    `catalog v${catalog.version}, ${precomputed ? "precomputed embeddings" : "no precomputed embeddings"}`,
);
