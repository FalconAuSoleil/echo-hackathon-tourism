// Sélection de la configuration livrée sur la moitié CALIBRATION seulement, avec exactement les fonctions de
// level2.ts (variantes, plancher de Youden, balayage, règle de choix) : c'est la partie « calibration » de
// `pnpm eval -- --level 2`, sans jamais évaluer la partie test réservée. Écrit eval/results/experiments/selection.json
// et, avec --write, packages/core/src/calibration.ts (sans chiffres de test : « pas encore mesurée »).
// Usage : npx tsx src/experiments/select.ts [--write] [--only minilm]
import { join } from "node:path";
import { writeJson, round } from "../lib/io.ts";
import { RESULTS_DIR } from "../lib/paths.ts";
import { EMBEDDERS, acceptOf, loadCatalog, prepareTexts, variantConfig, variantMatcher, withAccept, type Prepared, type Variant } from "../lib/system.ts";
import { CAPTURE_TOLERANCE, rankVariants, MAX_ACCEPTED_ERROR, MIN_NEGATION_ACCURACY, PREVIOUS_MAX_ACCEPTED_ERROR, PREVIOUS_MIN_NEGATION_ACCURACY, UNKNOWN_TOPIC_SOURCES, VARIANTS, calibrateClusterThreshold, chooseFloor, chooseThreshold, sweep, writeCoreCalibration, type SweepPoint } from "../level2.ts";
import { calibrationSplit } from "./common.ts";

const write = process.argv.includes("--write");
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : undefined;
const cal = calibrationSplit();
const catalog = loadCatalog();
const catalogExamples = catalog.findings.reduce((a, f) => a + Object.values(f.examples).reduce((b, x) => b + (x?.length ?? 0), 0), 0);
const cache = new Map<string, Map<string, Prepared>>();
const rows: { variant: Variant; floor: number; at8: SweepPoint | null; at5: SweepPoint | null }[] = [];
for (const v of VARIANTS.filter((x) => !only || x.embedder === only)) {
  const key = JSON.stringify([v.embedder, v.scoring, v.aggregation, v.crossLingual, v.l2]);
  let prepared = cache.get(key);
  if (!prepared) {
    const cfg0 = variantConfig(v);
    prepared = new Map((await prepareTexts(cal, await variantMatcher(v, catalog, cfg0), catalog, cfg0)).map((p) => [p.id, p]));
    cache.set(key, prepared);
  }
  const floor = chooseFloor(cal, prepared, 0.95);
  const curve = sweep(cal, prepared, variantConfig(v, { offListThreshold: floor.floor }));
  const at8 = chooseThreshold(curve, MAX_ACCEPTED_ERROR) ?? null;
  // Ancienne règle (≤ 5 %, négations ≥ 85 %), pour comparaison.
  const at5 = chooseThreshold(curve, PREVIOUS_MAX_ACCEPTED_ERROR, PREVIOUS_MIN_NEGATION_ACCURACY) ?? null;
  rows.push({ variant: v, floor: floor.floor, at8, at5 });
  const f = (p: SweepPoint | null) => (p ? `t=${p.threshold} capture ${(p.captureRate * 100).toFixed(1)} % err ${(p.acceptedErrorRate * 100).toFixed(1)} % not-sure ${(p.notSureRate * 100).toFixed(1)} % neg ${p.negationCancelsAccuracy}` : "none");
  console.log(`${v.name}${v.selectable === false ? " (not selectable)" : ""} floor ${floor.floor} | ≤${MAX_ACCEPTED_ERROR * 100}%: ${f(at8)} | ≤${PREVIOUS_MAX_ACCEPTED_ERROR * 100}%: ${f(at5)}`);
}
const ranked = rankVariants(rows.filter((r) => r.variant.selectable !== false).map((r) => ({ ...r, chosen: r.at8 })));
const best = ranked[0];
if (!best) throw new Error("no selectable variant meets the rule");
const v = best.variant;
const clusterCal = calibrateClusterThreshold((await variantMatcher(v, catalog, variantConfig(v))).examples);
const finalCfg = withAccept(variantConfig(v, { offListThreshold: best.floor, offListClusterThreshold: clusterCal.threshold, unknownTopicSources: UNKNOWN_TOPIC_SOURCES }), best.at8!.threshold);
console.log(`\nCHOSEN ${v.name} accept=${acceptOf(finalCfg)} floor=${finalCfg.offListThreshold} cluster=${clusterCal.threshold} | calibration capture ${best.at8!.captureRate} err ${best.at8!.acceptedErrorRate} not-sure ${best.at8!.notSureRate}`);
const date = new Date().toISOString().slice(0, 10);
writeJson(join(RESULTS_DIR, "experiments", "selection.json"), {
  synthetic: true,
  note: "Calibration half only (eval/src/experiments/select.ts). The held-out test half was not evaluated.",
  rule: `same as level2.ts: Youden off-list floor, then max calibration capture with accepted-answer error <= ${MAX_ACCEPTED_ERROR * 100}%, >= 20 accepted, cancelling-negation accuracy >= ${MIN_NEGATION_ACCURACY * 100}%; best selectable variant = lowest error among those within ${CAPTURE_TOLERANCE * 100} points of the best capture; at5 = previous rule (<= 5%, negations >= 85%)`,
  catalogExamples,
  chosen: { variant: v.name, embeddingModel: EMBEDDERS[v.embedder], acceptProbability: finalCfg.acceptProbability, linearL2: finalCfg.linearL2, negationMargin: finalCfg.negationMargin, offListThreshold: finalCfg.offListThreshold, offListClusterThreshold: clusterCal.threshold, calibration: best.at8 },
  variants: rows.map((r) => ({ variant: r.variant.name, selectable: r.variant.selectable !== false, floor: r.floor, at8: r.at8 && { threshold: r.at8.threshold, capture: round(r.at8.captureRate, 4), err: round(r.at8.acceptedErrorRate, 4), notSure: r.at8.notSureRate, accepted: r.at8.accepted, neg: r.at8.negationCancelsAccuracy }, at5: r.at5 && { threshold: r.at5.threshold, capture: round(r.at5.captureRate, 4), err: round(r.at5.acceptedErrorRate, 4), notSure: r.at5.notSureRate, accepted: r.at5.accepted, neg: r.at5.negationCancelsAccuracy } })),
  date,
});
if (write) {
  writeCoreCalibration(finalCfg, { embeddingModel: EMBEDDERS[v.embedder]!, calibration: best.at8!, catalogExamples, date, variant: v.name, generatedBy: "eval/src/experiments/select.ts --write" });
  console.log("wrote packages/core/src/calibration.ts");
}
