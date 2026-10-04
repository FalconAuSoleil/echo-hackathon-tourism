// Outils communs des expériences de rappel (eval/results/experiments/) : moitié CALIBRATION seulement.
// La moitié test réservée n'est jamais chargée ici (splitCorpus(...).calibration uniquement).
import { DEFAULT_CONFIG, createMatcher, makeConfig, type AnalysisConfig, type Catalog, type EmbedFn, type Matcher } from "@echo/core";
import { loadFeedback, splitCorpus, type Feedback } from "../lib/corpus.ts";
import { evaluate, summary, type SystemOutput } from "../lib/metrics.ts";
import { decide, getEmbedder, loadCatalog, prepareTexts, withAccept, type Prepared } from "../lib/system.ts";
import { round } from "../lib/io.ts";

export const MAX_ERR_TARGET = 0.08;
export const MAX_ERR_HARD = 0.1;
export const MIN_NEG = 0.85;

export function calibrationSplit(): Feedback[] {
  return splitCorpus(loadFeedback()).calibration;
}

export const toMap = (outs: SystemOutput[]) => new Map(outs.map((o) => [o.id, o]));

export async function prepare(feedbacks: readonly Feedback[], catalog: Catalog, embed: EmbedFn, cfg: AnalysisConfig): Promise<{ matcher: Matcher; prepared: Map<string, Prepared> }> {
  const matcher = await createMatcher(catalog, embed, cfg);
  const prepared = new Map((await prepareTexts(feedbacks, matcher, catalog, cfg)).map((p) => [p.id, p]));
  return { matcher, prepared };
}

export type DecideFn = (p: Prepared, cfg: AnalysisConfig) => SystemOutput;

export function measure(feedbacks: readonly Feedback[], prepared: ReadonlyMap<string, Prepared>, cfg: AnalysisConfig, decideFn: DecideFn = decide) {
  const m = evaluate(feedbacks, toMap(feedbacks.map((f) => decideFn(prepared.get(f.id)!, cfg))));
  return { ...summary(m), metrics: m };
}

export const PROBS = Array.from({ length: 71 }, (_, i) => round(0.3 + i * 0.01, 2));

/** Balayage du seuil (probabilité) : meilleur point sous chaque borne d'erreur (≥ 20 acceptées, négations ≥ 85 %). */
export function sweepBest(feedbacks: readonly Feedback[], prepared: ReadonlyMap<string, Prepared>, base: AnalysisConfig, decideFn: DecideFn = decide, grid = PROBS) {
  const curve = grid.map((t) => {
    const s = measure(feedbacks, prepared, withAccept(base, t), decideFn);
    return { t, capture: s.captureRate, err: s.acceptedErrorRate, accepted: s.accepted, notSure: s.notSureRate, coverage: s.coverage, neg: s.negationCancelsAccuracy, negInh: s.negationInherentRecall };
  });
  const best = (maxErr: number) =>
    curve.filter((p) => p.err <= maxErr && p.accepted >= 20 && p.neg >= MIN_NEG).sort((a, b) => b.capture - a.capture || b.t - a.t)[0];
  return { curve, at5: best(0.05), at8: best(MAX_ERR_TARGET), at10: best(MAX_ERR_HARD) };
}

export const pct = (x: number | undefined) => (x === undefined ? "–" : `${(x * 100).toFixed(1)} %`);
export function fmtPoint(p: { t: number; capture: number; err: number; notSure: number; accepted: number; neg: number } | undefined) {
  return p ? `t=${p.t} capture ${pct(p.capture)} err ${pct(p.err)} not-sure ${pct(p.notSure)} acc ${p.accepted} neg ${pct(p.neg)}` : "none";
}

export { DEFAULT_CONFIG, makeConfig, getEmbedder, loadCatalog };
