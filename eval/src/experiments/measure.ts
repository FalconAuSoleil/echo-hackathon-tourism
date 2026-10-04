// Mesure de l'état courant du code (core + catalogue) sur la CALIBRATION : meilleur seuil sous 5 / 8 / 10 %
// d'erreur parmi les réponses acceptées, pour quelques L2 et planchers. Ajoute une ligne à eval/results/experiments/runs.jsonl.
// Usage : npx tsx src/experiments/measure.ts <label> [embedder=minilm] [l2s=0.0001,0.00003] [floors=0.5,0.55,0.59]
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { RESULTS_DIR } from "../lib/paths.ts";
import { DEFAULT_CONFIG, calibrationSplit, fmtPoint, getEmbedder, loadCatalog, makeConfig, prepare, sweepBest } from "./common.ts";

const [label = "unnamed", emb = "minilm", l2Arg = "0.0001,0.00003", floorArg = "0.5,0.55,0.59"] = process.argv.slice(2);
// Surcharges de configuration (JSON) : CFG='{"clauseCommaMinWords":3}'
const overrides = JSON.parse(process.env.CFG ?? "{}") as Record<string, unknown>;
const cal = calibrationSplit();
const catalog = loadCatalog();
const embed = await getEmbedder(emb);
const examples = catalog.findings.reduce((a, f) => a + Object.values(f.examples).reduce((b, x) => b + (x?.length ?? 0), 0), 0);
for (const l2 of l2Arg.split(",").map(Number)) {
  const base = makeConfig({ ...DEFAULT_CONFIG, ...overrides, linearL2: l2 });
  const { prepared } = await prepare(cal, catalog, embed, base);
  const chunks = [...prepared.values()].reduce((a, p) => a + p.analysis.chunks.length, 0);
  const unknownLang = [...prepared.values()].filter((p) => p.analysis.status === "not_sure").length;
  for (const floor of floorArg.split(",").map(Number)) {
    const r = sweepBest(cal, prepared, { ...base, offListThreshold: floor });
    console.log(`[${label}] ${emb} l2=${l2} floor=${floor} chunks=${chunks} msgNotSure=${unknownLang} | 5%: ${fmtPoint(r.at5)} | 8%: ${fmtPoint(r.at8)} | 10%: ${fmtPoint(r.at10)}`);
    appendFileSync(join(RESULTS_DIR, "experiments", "runs.jsonl"), JSON.stringify({ label, overrides, embedder: emb, l2, floor, examples, chunks, messagesNotSure: unknownLang, at5: r.at5 ?? null, at8: r.at8 ?? null, at10: r.at10 ?? null, date: new Date().toISOString() }) + "\n");
  }
}
