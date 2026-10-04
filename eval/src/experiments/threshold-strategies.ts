// Stratégies de seuil (calibration seulement) avec MiniLM : seuil unique (référence), marge top1−top2,
// accord classifieur linéaire / plus proche exemple, seuils par langue (validation croisée 2 plis dans la calibration).
import { decideChunk, type AnalysisConfig, type FindingRawScore, type NegationInfo } from "@echo/core";
import type { PredChunk, SystemOutput } from "../lib/metrics.ts";
import { fromAnalysis, withAccept, type Prepared } from "../lib/system.ts";
import { rng, shuffle } from "../lib/corpus.ts";
import { DEFAULT_CONFIG, calibrationSplit, fmtPoint, getEmbedder, loadCatalog, makeConfig, measure, prepare, sweepBest, PROBS } from "./common.ts";

type Rule = (raw: FindingRawScore[], neg: NegationInfo, cfg: AnalysisConfig) => ReturnType<typeof decideChunk>;
const decideWith = (rule: Rule) => (p: Prepared, cfg: AnalysisConfig): SystemOutput => {
  const a = p.analysis;
  if (a.status === "inaudible" || a.status === "duplicate") return fromAnalysis(a);
  const forced = a.status === "not_sure";
  const chunks: PredChunk[] = a.chunks.map((c, i) => {
    if (forced) return { text: c.text, status: "not_sure", findings: [], reason: a.reason };
    const d = rule(p.raw[i]!, c.negation, cfg);
    return { text: c.text, status: d.status, findings: d.findings.map((f) => f.id), reason: d.reason };
  });
  return { id: a.id, messageStatus: a.status, chunks, findings: [...new Set(chunks.flatMap((c) => c.findings))] };
};

/** Seuil abaissé à `low` quand le plus proche exemple (cosinus, même négation) désigne le même constat. */
const agreementRule = (low: number): Rule => (raw, neg, cfg) => {
  const strict = decideChunk(raw, neg, cfg);
  if (strict.status !== "not_sure" || strict.reason !== "below_threshold") return strict;
  const byP = [...raw].sort((a, b) => b.probability! - a.probability!);
  const byCos = [...raw].sort((a, b) => b.agree - a.agree);
  if (byP[0]!.id === byCos[0]!.id && byP[0]!.probability! >= low) return decideChunk(raw, neg, { ...cfg, acceptProbability: low, maxFindingsPerChunk: 1 });
  return strict;
};
/** Accepte aussi si top1 ≥ low et top1 − top2 ≥ margin. */
const marginRule = (low: number, margin: number): Rule => (raw, neg, cfg) => {
  const strict = decideChunk(raw, neg, cfg);
  if (strict.status !== "not_sure" || strict.reason !== "below_threshold") return strict;
  const byP = [...raw].sort((a, b) => b.probability! - a.probability!);
  if (byP[0]!.probability! >= low && byP[0]!.probability! - byP[1]!.probability! >= margin) return decideChunk(raw, neg, { ...cfg, acceptProbability: low, maxFindingsPerChunk: 1 });
  return strict;
};

const cal = calibrationSplit();
const catalog = loadCatalog();
const embed = await getEmbedder(process.argv[2] ?? "minilm");
const l2s = (process.argv[3] ?? "0.0001,0.00003").split(",").map(Number);
for (const l2 of l2s) {
  const base = makeConfig({ ...DEFAULT_CONFIG, linearL2: l2 });
  const { prepared } = await prepare(cal, catalog, embed, base);
  const ref = sweepBest(cal, prepared, base);
  console.log(`\n### l2=${l2} floor=${base.offListThreshold}\nsingle threshold | 5% ${fmtPoint(ref.at5)} | 8% ${fmtPoint(ref.at8)}`);
  for (const low of [0.3, 0.4, 0.5, 0.6]) {
    const r = sweepBest(cal, prepared, base, decideWith(agreementRule(low)));
    console.log(`agreement low=${low} | 5% ${fmtPoint(r.at5)} | 8% ${fmtPoint(r.at8)}`);
  }
  for (const low of [0.4, 0.5, 0.6]) for (const m of [0.3, 0.4, 0.5]) {
    const r = sweepBest(cal, prepared, base, decideWith(marginRule(low, m)));
    console.log(`margin low=${low} m=${m} | 5% ${fmtPoint(r.at5)} | 8% ${fmtPoint(r.at8)}`);
  }
  // Seuils par langue, choisis sur un pli et mesurés sur l'autre (2 plis, 5 répétitions).
  const langs = ["en", "fr", "de", "es"] as const;
  let capG = 0, errW = 0, errA = 0, capPL = 0, errPLW = 0, errPLA = 0, n = 0;
  for (let rep = 0; rep < 5; rep++) {
    const sh = shuffle(cal, rng(100 + rep));
    const folds = [sh.filter((_, i) => i % 2 === 0), sh.filter((_, i) => i % 2 === 1)];
    for (const [k, train] of folds.entries()) {
      const testF = folds[1 - k]!;
      const g = sweepBest(train, prepared, base).at8;
      if (!g) continue;
      const mg = measure(testF, prepared, withAccept(base, g.t));
      const per: Record<string, number> = {};
      for (const l of langs) per[l] = sweepBest(train.filter((f) => f.lang === l), prepared, base, undefined, PROBS).curve.filter((p) => p.err <= 0.08 && p.accepted >= 5).sort((a, b) => b.capture - a.capture || b.t - a.t)[0]?.t ?? g.t;
      const decPL = (p: Prepared, cfg: AnalysisConfig) => decideWith((raw, neg, c) => decideChunk(raw, neg, c))(p, withAccept(cfg, per[cal.find((f) => f.id === p.id)!.lang]!));
      const mp = measure(testF, prepared, base, decPL);
      capG += mg.metrics.remarks.captured; capPL += mp.metrics.remarks.captured; n += mg.metrics.remarks.total;
      errW += mg.metrics.answers.wrong; errA += mg.metrics.answers.accepted; errPLW += mp.metrics.answers.wrong; errPLA += mp.metrics.answers.accepted;
    }
  }
  console.log(`2-fold CV (5 reps): global threshold capture ${(capG / n * 100).toFixed(1)} % err ${(errW / errA * 100).toFixed(1)} % | per-language capture ${(capPL / n * 100).toFixed(1)} % err ${(errPLW / errPLA * 100).toFixed(1)} %`);
}
