// Niveau 2 (SPEC 9) : classement sur les retours écrits SYNTHÉTIQUES (eval/data/feedback.jsonl).
// 1. Partage stratifié calibration / test (50/50, graine fixe).
// 2. Sur la calibration seulement : choix de la variante (modèle d'embedding, agrégation, comparaison
//    multilingue), du seuil d'acceptation (règle fixée à l'avance : couverture max sous contrainte
//    d'erreur parmi les réponses acceptées) et du plancher « hors liste ».
// 3. Rapport sur la partie test, avec le chemin livré (analyzeMessage de @echo/core), comparé aux mots-clés.
// 4. Sujets inconnus (cueillette), doublons, négations ; seuils écrits dans packages/core/src/calibration.ts.
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  analyzeMessage,
  clusterOffList,
  fingerprint,
  unknownTopicItems,
  words,
  type AnalysisConfig,
  type Catalog,
  type KnownMessage,
  type MessageAnalysis,
} from "@echo/core";
import { loadFeedback, rng, shuffle, splitCorpus, type Feedback } from "./lib/corpus.ts";
import { round, writeJson } from "./lib/io.ts";
import { aligned, evaluate, evaluateByLang, summary, type SystemOutput } from "./lib/metrics.ts";
import { MODELS_DIR, RESULTS_DIR, ROOT } from "./lib/paths.ts";
import { KEYWORD_SET_NAMES, loadKeywordSet, primaryKeywordSet } from "./lib/keyword-sets.ts";
import {
  EMBEDDERS,
  decide,
  fromAnalysis,
  getEmbedder,
  keywordOutput,
  loadCatalog,
  prepareTexts,
  acceptOf,
  variantConfig,
  variantMatcher,
  withAccept,
  type Prepared,
  type Variant,
} from "./lib/system.ts";

/**
 * Règle de choix du seuil, fixée avant de regarder la partie test. 5 % jusqu'au 2026-10-04 ; relevée à 8 % par la
 * tâche echo-recall (décision produit : erreur parmi les réponses acceptées ≤ 10 %, cible ≤ 8 %, pour capter plus de
 * remarques). Expériences et choix, sur la calibration seulement : eval/results/experiments/log.md.
 */
export const MAX_ACCEPTED_ERROR = 0.08;
/** Ancienne borne, encore rapportée pour comparaison. */
export const PREVIOUS_MAX_ACCEPTED_ERROR = 0.05;
/** Part minimale des négations qui annulent un constat correctement non comptées (SPEC 7), sur la calibration. */
export const MIN_NEGATION_ACCURACY = 1;
/**
 * 0,85 jusqu'au 2026-10-04. Relevée à 1 par la tâche echo-recall, en même temps que la borne d'erreur : un seuil plus
 * bas ne doit laisser passer AUCUNE des négations qui annulent un constat de la calibration (16/16 avec l'ancienne
 * configuration), pour que le garde-fou de négation ne s'affaiblisse pas.
 */
export const PREVIOUS_MIN_NEGATION_ACCURACY = 0.85;
/** Seuil de regroupement : part max de paires d'exemples de constats différents au-dessus du seuil. */
export const MAX_CROSS_TOPIC_MERGE = 0.01;
/**
 * Morceaux regroupés pour le signal « sujet inconnu ». Choix fait APRÈS avoir vu que, avec "off_list" seul,
 * les remarques sur la cueillette tombent en « pas sûr » (proches de la visite des caféiers) et ne déclenchent
 * jamais le signal ; il n'existe pas d'autre sujet récurrent annoté pour valider ce choix à l'aveugle (limite).
 */
export const UNKNOWN_TOPIC_SOURCES = "off_list_and_unsure" as const;
function hasModel(id: string): boolean {
  return existsSync(join(MODELS_DIR, id, "onnx", "model_quantized.onnx"));
}

export const THRESHOLDS = Array.from({ length: 71 }, (_, i) => round(0.3 + i * 0.01, 2)); // 0.30 … 1.00

export const VARIANTS: Variant[] = [
  // Règle initiale du cœur : cosinus maximal (ou moyenne des 3 meilleurs) avec les exemples.
  { name: "similarity-minilm-max", embedder: "minilm", scoring: "similarity", aggregation: "max", crossLingual: true },
  { name: "similarity-minilm-max-samelang", embedder: "minilm", scoring: "similarity", aggregation: "max", crossLingual: false },
  { name: "similarity-minilm-top3", embedder: "minilm", scoring: "similarity", aggregation: "topk_mean", crossLingual: true },
  { name: "similarity-e5-max", embedder: "e5", scoring: "similarity", aggregation: "max", crossLingual: true },
  { name: "similarity-e5-top3", embedder: "e5", scoring: "similarity", aggregation: "topk_mean", crossLingual: true },
  // Régression logistique sur les embeddings des exemples du catalogue (ajoutée après la 1re mesure),
  // avec marge de négation 0 (règle stricte du cœur) ou relâchée.
  ...(["minilm", "e5"] as const).flatMap((embedder) =>
    (embedder === "minilm" ? [1e-3, 3e-4, 1e-4, 3e-5, 1e-5] : [3e-4, 1e-4, 3e-5]).flatMap((l2) =>
      // Marge négative (echo-recall) : règle de négation PLUS stricte (les exemples de même négation doivent battre
      // ceux de négation opposée d'au moins |marge|) ; jamais plus permissive que la règle stricte, donc sélectionnable.
      (embedder === "minilm" ? [0, -0.02, -0.05, 0.05, 0.1] : [0, 0.05, 0.1]).map((negationMargin): Variant => ({
        name: `linear-${embedder}-l2=${l2}-neg${negationMargin}`, embedder, scoring: "linear", aggregation: "max", crossLingual: true, l2, negationMargin,
        // Marge relâchée : meilleure sur la calibration, mais sur la partie test les négations qui annulent un
        // constat passaient beaucoup plus souvent (62 % de bonnes décisions contre 85 % avec la règle stricte,
        // 1re exécution du 2026-10-04). La calibration n'a que 16 passages de ce type : trop peu pour la contrainte.
        // Décision de sécurité prise APRÈS avoir vu la partie test : ces variantes restent mesurées, jamais retenues.
        selectable: negationMargin <= 0,
      })),
    ),
  ),
  // paraphrase-multilingual-mpnet-base-v2 (echo-recall) : nettement meilleur sur la calibration, mais 296 Mo et
  // ~1,4 Go de mémoire de pointe en WebAssembly (contre ~0,64 Go pour MiniLM) : ne tient pas sur un téléphone de 2 Go
  // (eval/results/experiments/log.md). Mesuré et rapporté, jamais retenu. Ignoré si le modèle n'est pas téléchargé.
  ...(hasModel(EMBEDDERS.mpnet!)
    ? [3e-4, 1e-4, 3e-5].flatMap((l2) =>
        [0, -0.02].map((negationMargin): Variant => ({
          name: `linear-mpnet-l2=${l2}-neg${negationMargin}`, embedder: "mpnet", scoring: "linear", aggregation: "max", crossLingual: true, l2, negationMargin, selectable: false,
        })),
      )
    : []),
];

const toMap = (outs: SystemOutput[]) => new Map(outs.map((o) => [o.id, o]));

export function sweep(feedbacks: readonly Feedback[], prepared: ReadonlyMap<string, Prepared>, base: AnalysisConfig) {
  return THRESHOLDS.map((t) => {
    const cfg = withAccept(base, t);
    const m = evaluate(feedbacks, toMap(feedbacks.map((f) => decide(prepared.get(f.id)!, cfg))));
    return {
      threshold: t,
      coverage: m.chunks.coverage,
      acceptedErrorRate: m.answers.acceptedErrorRate,
      accepted: m.answers.accepted,
      captureRate: m.remarks.captureRate,
      precision: m.micro.precision,
      recall: m.micro.recall,
      f1: m.micro.f1,
      notSureRate: m.chunks.notSureRate,
      negationCancelsAccuracy: m.negationCancels.accuracy,
    };
  });
}

export type SweepPoint = ReturnType<typeof sweep>[number];

/** Seuil retenu : capture max parmi les seuils dont l'erreur parmi les acceptées ≤ max (et au moins 20 acceptées). */
export function chooseThreshold(curve: readonly SweepPoint[], maxErr = MAX_ACCEPTED_ERROR, minNeg = MIN_NEGATION_ACCURACY): SweepPoint | undefined {
  const ok = curve.filter((p) => p.acceptedErrorRate <= maxErr && p.accepted >= 20 && p.negationCancelsAccuracy >= minNeg);
  return ok.sort((a, b) => b.captureRate - a.captureRate || a.threshold - b.threshold)[0];
}

/**
 * Tolérance de capture entre variantes (echo-recall, choisie après avoir vu les chiffres de la calibration, jamais
 * ceux du test) : parmi les variantes dont la capture est à moins de 2 points de la meilleure (≈ 2-3 remarques sur 130,
 * sous la résolution de la mesure), on prend celle dont l'erreur parmi les réponses acceptées est la plus basse.
 */
export const CAPTURE_TOLERANCE = 0.02;

/** Classement des variantes : capture max à CAPTURE_TOLERANCE près, puis erreur minimale, puis capture. */
export function rankVariants<T extends { chosen: SweepPoint | null }>(rows: readonly T[]): T[] {
  const ok = rows.filter((r) => r.chosen);
  const top = Math.max(...ok.map((r) => r.chosen!.captureRate));
  const near = (r: T) => r.chosen!.captureRate >= top - CAPTURE_TOLERANCE - 1e-9;
  return [...ok].sort((a, b) => Number(near(b)) - Number(near(a)) || (near(a) ? a.chosen!.acceptedErrorRate - b.chosen!.acceptedErrorRate : 0) || b.chosen!.captureRate - a.chosen!.captureRate);
}

/**
 * Plancher « hors liste » : maximise (part des passages hors liste sous le plancher) − (part des passages
 * constat / ambigus sous le plancher), sur la calibration (indice de Youden). Toujours ≤ seuil d'acceptation.
 */
export function chooseFloor(feedbacks: readonly Feedback[], prepared: ReadonlyMap<string, Prepared>, cap: number) {
  const offScores: number[] = [];
  const inScores: number[] = [];
  for (const f of feedbacks) {
    const p = prepared.get(f.id)!;
    const spanWords = f.chunks.map((sp) => words(sp.span));
    p.analysis.chunks.forEach((c, i) => {
      // score global du morceau = max(agree, inverted) sur les constats, comme decideChunk
      const s = Math.max(...p.raw[i]!.map((r) => Math.max(r.agree, r.inverted)));
      const cw = words(c.text);
      const spans = f.chunks.filter((_, j) => aligned(cw, spanWords[j]!));
      if (spans.length === 0) return;
      if (spans.every((sp) => sp.kind === "off_list")) offScores.push(s);
      else if (spans.some((sp) => sp.kind === "finding" || sp.kind === "not_sure")) inScores.push(s);
    });
  }
  let best = { floor: 0.3, j: -Infinity, offBelow: 0, inBelow: 0 };
  for (let t = 0.1; t <= cap + 1e-9; t += 0.01) {
    const offBelow = offScores.filter((s) => s < t).length / Math.max(1, offScores.length);
    const inBelow = inScores.filter((s) => s < t).length / Math.max(1, inScores.length);
    const j = offBelow - inBelow;
    if (j > best.j + 1e-9) best = { floor: round(t, 2), j: round(j, 4), offBelow: round(offBelow, 4), inBelow: round(inBelow, 4) };
  }
  return { ...best, offListChunks: offScores.length, inListChunks: inScores.length };
}

/** Sujets inconnus : regroupement des morceaux hors liste (code livré), signal si ≥ 3 visiteurs. */
/**
 * Seuil de regroupement des sujets inconnus, calibré SANS les données d'évaluation : sur les exemples du
 * catalogue, paires de langues différentes, « même constat » contre « constats différents » (indice de Youden
 * sur les cosinus). Idée : trois visiteurs qui disent la même chose dans trois langues doivent se regrouper,
 * deux sujets différents non. Dépend du modèle d'embedding (e5 resserre tous les cosinus vers 0,8–0,95).
 */
export function calibrateClusterThreshold(examples: readonly { findingId: string; lang: string; negated: boolean; embedding: Float32Array }[]) {
  const same: number[] = [];
  const diff: number[] = [];
  for (let i = 0; i < examples.length; i++) {
    for (let j = i + 1; j < examples.length; j++) {
      const a = examples[i]!;
      const b = examples[j]!;
      if (a.lang === b.lang) continue;
      let s = 0;
      for (let k = 0; k < a.embedding.length; k++) s += a.embedding[k]! * b.embedding[k]!;
      (a.findingId === b.findingId ? same : diff).push(s);
    }
  }
  let youden = { threshold: 0.5, j: -Infinity, sameAbove: 0, diffAbove: 0 };
  let precise: { threshold: number; sameAbove: number; diffAbove: number } | undefined;
  for (let t = 0.2; t <= 0.995; t += 0.01) {
    const sa = same.filter((x) => x >= t).length / same.length;
    const da = diff.filter((x) => x >= t).length / diff.length;
    if (sa - da > youden.j) youden = { threshold: round(t, 2), j: round(sa - da, 4), sameAbove: round(sa, 4), diffAbove: round(da, 4) };
    if (!precise && da <= MAX_CROSS_TOPIC_MERGE) precise = { threshold: round(t, 2), sameAbove: round(sa, 4), diffAbove: round(da, 4) };
  }
  // Règle retenue : seuil le plus bas où au plus 1 % des paires de sujets différents se ressemblent autant
  // (une fausse alerte fait lire des remarques pour rien et use la confiance). Youden donné pour comparaison.
  return { threshold: precise?.threshold ?? youden.threshold, rule: `lowest t with <= ${MAX_CROSS_TOPIC_MERGE * 100}% of cross-language different-finding example pairs >= t`, precise, youden, samePairs: same.length, diffPairs: diff.length };
}

/** Sujets inconnus : regroupement (code livré), signal si ≥ 3 visiteurs distincts. */
export function unknownTopics(analyses: readonly MessageAnalysis[], feedbacks: ReadonlyMap<string, Feedback>, config: AnalysisConfig, seed = 7) {
  const isPicking = (id: string) => feedbacks.get(id)?.flags.picking ?? false;
  const describe = (as: readonly MessageAnalysis[], cfg: AnalysisConfig) => {
    const items = unknownTopicItems(as, cfg.unknownTopicSources);
    const clusters = clusterOffList(items, cfg);
    const rec = clusters.filter((c) => c.recurring);
    const pickingVisitors = (chunkIds: string[]) => new Set(chunkIds.map((c) => c.split(":")[0]!).filter(isPicking)).size;
    const detected = rec.some((c) => pickingVisitors(c.chunkIds) >= cfg.offListMinVisitors);
    const falseAlerts = rec.filter((c) => pickingVisitors(c.chunkIds) < cfg.offListMinVisitors).length;
    return { items, clusters, rec, detected, falseAlerts, pickingVisitors };
  };
  const pickingStatus = analyses
    .filter((a) => isPicking(a.id))
    .map((a) => ({ id: a.id, chunks: a.chunks.map((c) => ({ text: c.text, status: c.status, reason: c.reason, top: c.topScores[0] })) }));
  const rand = rng(seed);
  const others = analyses.filter((a) => !isPicking(a.id));
  const picking = analyses.filter((a) => isPicking(a.id));
  // Mois réalistes (SPEC 2 : 6 à 7 visiteurs par mois) : 4 messages au hasard + les 3 sur la cueillette,
  // et 7 messages au hasard sans cueillette.
  const sims = (cfg: AnalysisConfig, n = 500) => {
    let det = 0;
    let fa = 0;
    let faMonths = 0;
    for (let i = 0; i < n; i++) {
      if (describe([...shuffle(others, rand).slice(0, 4), ...picking], cfg).detected) det++;
      const without = describe(shuffle(others, rand).slice(0, 7), cfg);
      fa += without.rec.length;
      if (without.rec.length > 0) faMonths++;
    }
    return { months: n, detectionRate: round(det / n, 4), falseAlertMonthRate: round(faMonths / n, 4), falseAlertsPerMonth: round(fa / n, 4) };
  };
  const byMode = (sources: AnalysisConfig["unknownTopicSources"]) => {
    const cfg = { ...config, unknownTopicSources: sources };
    const full = describe(analyses, cfg);
    return {
      sources,
      candidateChunks: full.items.length,
      fullCorpus: {
        detected: full.detected,
        falseAlerts: full.falseAlerts,
        recurringClusters: full.rec.map((c) => ({
          distinctVisitors: c.distinctVisitors,
          pickingVisitors: full.pickingVisitors(c.chunkIds),
          texts: c.chunkIds.map((id) => full.items.find((it) => it.chunkId === id)?.text ?? id),
        })),
      },
      realisticMonths: sims(cfg),
    };
  };
  const t0 = config.offListClusterThreshold;
  const sensitivity = [-0.15, -0.1, -0.05, 0, 0.05, 0.1].map((d) => {
    const cfg = { ...config, offListClusterThreshold: round(t0 + d, 2) };
    const f = describe(analyses, cfg);
    return { clusterThreshold: cfg.offListClusterThreshold, fullCorpusDetected: f.detected, fullCorpusFalseAlerts: f.falseAlerts, ...sims(cfg, 200) };
  });
  return {
    clusterThreshold: config.offListClusterThreshold,
    minVisitors: config.offListMinVisitors,
    shipped: byMode(config.unknownTopicSources),
    offListOnly: byMode("off_list"),
    offListAndUnsure: byMode("off_list_and_unsure"),
    pickingMessages: pickingStatus,
    sensitivity,
  };
}

/** Doublons : renvois exacts, renvois retouchés (casse, ponctuation, espaces), et fausses alertes. */
export async function duplicates(feedbacks: readonly Feedback[], deps: { catalog: Catalog; matcher: Awaited<ReturnType<typeof variantMatcher>>; config: AnalysisConfig }) {
  const known: KnownMessage[] = [];
  let falseDup = 0;
  const day = "2026-09-15T10:00:00Z";
  for (const f of feedbacks) {
    const a = await analyzeMessage({ id: f.id, receivedAt: day, source: "text", text: f.text }, { ...deps, knownMessages: known });
    if (a.status === "duplicate") falseDup++;
    else known.push({ fingerprint: a.fingerprint, receivedAt: day, embedding: a.messageEmbedding });
  }
  const variants: Record<string, (t: string) => string> = {
    exact: (t) => t,
    case_punct_space: (t) => t.toLowerCase().replace(/[.,!?;:]/g, "").replace(/\s+/g, "  ") + " ",
    trailing_emphasis: (t) => `${t} !!`,
    one_word_added: (t) => `${t.replace(/[.!?]\s*$/, "")} really.`,
  };
  const resend: Record<string, { sent: number; flagged: number; rate: number }> = {};
  for (const [name, fn] of Object.entries(variants)) {
    let flagged = 0;
    for (const f of feedbacks) {
      const a = await analyzeMessage({ id: `${f.id}#${name}`, receivedAt: "2026-09-16T08:00:00Z", source: "text", text: fn(f.text) }, { ...deps, knownMessages: known });
      if (a.status === "duplicate") flagged++;
    }
    resend[name] = { sent: feedbacks.length, flagged, rate: round(flagged / feedbacks.length, 4) };
  }
  // Même texte un mois plus tard (hors fenêtre de 7 jours) : ne doit PAS être un doublon.
  let lateFlagged = 0;
  for (const f of feedbacks) {
    const a = await analyzeMessage({ id: `${f.id}#late`, receivedAt: "2026-10-20T08:00:00Z", source: "text", text: f.text }, { ...deps, knownMessages: known });
    if (a.status === "duplicate") lateFlagged++;
  }
  // Paires de messages distincts dont l'empreinte coïncide (ex. « Thanks! » écrit par deux visiteurs).
  const fps = new Map<string, number>();
  for (const f of feedbacks) fps.set(fingerprint(f.text), (fps.get(fingerprint(f.text)) ?? 0) + 1);
  return {
    originals: feedbacks.length,
    falseDuplicatesAmongDistinctMessages: falseDup,
    identicalTextsInCorpus: [...fps.values()].filter((n) => n > 1).reduce((a, n) => a + n - 1, 0),
    resend,
    sameTextOutsideWindow: { sent: feedbacks.length, flagged: lateFlagged },
    rule: `exact fingerprint of the normalised scrubbed text, or whole-message embedding cosine >= ${deps.config.duplicateEmbeddingThreshold}, within ${deps.config.duplicateWindowDays} days`,
  };
}

/** Écrit packages/core/src/calibration.ts (lu par DEFAULT_CONFIG). `test` absent : partie test pas encore mesurée. */
export function writeCoreCalibration(cfg: AnalysisConfig, meta: { embeddingModel: string; calibration: SweepPoint; test?: { acceptedErrorRate: number; captureRate: number }; catalogExamples: number; date: string; variant: string; generatedBy?: string }) {
  const pct = (x: number) => (x * 100).toFixed(1);
  const ts = `// GÉNÉRÉ par \`${meta.generatedBy ?? "pnpm eval -- --level 2"}\` (eval/src/level2.ts) le ${meta.date}. Ne pas modifier à la main :
// relancer l'évaluation. Seuils calibrés sur la moitié « calibration » du corpus SYNTHÉTIQUE
// (eval/data/feedback.jsonl), règle : part des remarques captées maximale sous la contrainte
// « erreur parmi les réponses acceptées ≤ ${MAX_ACCEPTED_ERROR * 100} % » et négations qui annulent ≥ ${MIN_NEGATION_ACCURACY * 100} %. Variante retenue : ${meta.variant}.
// Calibration : erreur ${pct(meta.calibration.acceptedErrorRate)} %, capture ${pct(meta.calibration.captureRate)} %, couverture ${pct(meta.calibration.coverage)} %.
// ${meta.test ? `Partie test réservée : erreur ${pct(meta.test.acceptedErrorRate)} %, capture ${pct(meta.test.captureRate)} %. Détails : eval/results/RESULTS.md.` : "Partie test réservée : pas encore mesurée avec cette configuration (à faire : pnpm eval -- --level 2)."}

export const CALIBRATION = {
  scoring: ${JSON.stringify(cfg.scoring)} as "similarity" | "linear",
  acceptProbability: ${cfg.acceptProbability},
  linearL2: ${cfg.linearL2},
  linearEpochs: ${cfg.linearEpochs},
  negationMargin: ${cfg.negationMargin},
  acceptThreshold: ${Math.max(cfg.acceptThreshold, cfg.offListThreshold)},
  offListThreshold: ${cfg.offListThreshold},
  aggregation: ${JSON.stringify(cfg.aggregation)} as "max" | "topk_mean",
  topK: ${cfg.topK},
  crossLingual: ${cfg.crossLingual},
  clauseCommaMinWords: ${cfg.clauseCommaMinWords},
  clauseCausalSplit: ${cfg.clauseCausalSplit},
  offListClusterThreshold: ${cfg.offListClusterThreshold},
  unknownTopicSources: ${JSON.stringify(cfg.unknownTopicSources)} as "off_list" | "off_list_and_unsure",
  /** Modèle d'embedding avec lequel ces seuils ont été calibrés (les seuils n'ont de sens qu'avec lui). */
  embeddingModel: ${JSON.stringify(meta.embeddingModel)},
  calibratedAt: ${JSON.stringify(meta.date)},
  catalogExamples: ${meta.catalogExamples},
} as const;
`;
  writeFileSync(join(ROOT, "packages", "core", "src", "calibration.ts"), ts);
}

export async function runLevel2(opts: { log: (s: string) => void; variants?: string[]; writeCalibration?: boolean }) {
  const log = opts.log;
  const catalog = loadCatalog();
  const keywordSet = primaryKeywordSet();
  const lists = loadKeywordSet(keywordSet);
  const all = loadFeedback();
  const byId = new Map(all.map((f) => [f.id, f]));
  const { calibration, test } = splitCorpus(all);
  const catalogExamples = catalog.findings.reduce((a, f) => a + Object.values(f.examples).reduce((b, xs) => b + (xs?.length ?? 0), 0), 0);
  log(`[level2] corpus ${all.length} (calibration ${calibration.length}, test ${test.length}); catalog ${catalogExamples} examples`);

  // Variantes : préparation (une analyse + scores bruts par message), plancher puis balayage, sur la calibration.
  const variantResults: Record<string, unknown>[] = [];
  const preparedByVariant = new Map<string, Map<string, Prepared>>();
  const preparedCache = new Map<string, Map<string, Prepared>>();
  const floorByVariant = new Map<string, ReturnType<typeof chooseFloor>>();
  for (const v of VARIANTS.filter((x) => !opts.variants || opts.variants.includes(x.name))) {
    const key = JSON.stringify([v.embedder, v.scoring, v.aggregation, v.crossLingual, v.l2]); // la marge de négation ne change pas la préparation
    let prepared = preparedCache.get(key);
    if (!prepared) {
      const cfg0 = variantConfig(v);
      const matcher = await variantMatcher(v, catalog, cfg0);
      prepared = new Map((await prepareTexts(all, matcher, catalog, cfg0)).map((p) => [p.id, p]));
      preparedCache.set(key, prepared);
    }
    preparedByVariant.set(v.name, prepared);
    // Plancher « hors liste » d'abord (indépendant du seuil d'acceptation), puis balayage avec ce plancher.
    const floor = chooseFloor(calibration, prepared, 0.95);
    floorByVariant.set(v.name, floor);
    const cfg = variantConfig(v, { offListThreshold: floor.floor });
    const curveCal = sweep(calibration, prepared, cfg);
    const pick = chooseThreshold(curveCal);
    variantResults.push({ variant: v, floor: floor.floor, chosen: pick ?? null, curveCalibration: curveCal });
    log(`[level2] ${v.name}: floor ${floor.floor} ${pick ? `t=${pick.threshold} capture ${(pick.captureRate * 100).toFixed(1)} % err ${(pick.acceptedErrorRate * 100).toFixed(1)} % cov ${(pick.coverage * 100).toFixed(1)} % neg ${pick.negationCancelsAccuracy}` : "no threshold meets the constraints"}`);
  }
  const ranked = rankVariants(variantResults.filter((r) => (r.variant as Variant).selectable !== false) as { variant: Variant; chosen: SweepPoint | null }[]);
  const best = (ranked[0] as Record<string, unknown> | undefined) ?? variantResults[0]!;
  const bestVariant = best.variant as Variant;
  // Aucun seuil ne respecte les contraintes : on prend le seuil d'erreur minimale (signalé dans les résultats).
  const bestPoint =
    (best.chosen as SweepPoint | null) ??
    [...(best.curveCalibration as SweepPoint[])].filter((p) => p.accepted >= 20).sort((a, b) => a.acceptedErrorRate - b.acceptedErrorRate)[0]!;
  const prepared = preparedByVariant.get(bestVariant.name)!;
  const floor = floorByVariant.get(bestVariant.name)!;
  const clusterCal = calibrateClusterThreshold((await variantMatcher(bestVariant, catalog, variantConfig(bestVariant))).examples);
  const finalCfg = withAccept(
    variantConfig(bestVariant, { offListThreshold: floor.floor, offListClusterThreshold: clusterCal.threshold, unknownTopicSources: UNKNOWN_TOPIC_SOURCES }),
    bestPoint.threshold,
  );
  log(`[level2] cluster threshold from catalog examples: ${clusterCal.threshold} (Youden would give ${clusterCal.youden.threshold})`);
  log(`[level2] chosen ${bestVariant.name} accept=${acceptOf(finalCfg)} floor=${finalCfg.offListThreshold}`);

  // Chemin livré : analyzeMessage avec la configuration finale, sur tout le corpus.
  const matcher = await variantMatcher(bestVariant, catalog, finalCfg);
  const analyses: MessageAnalysis[] = [];
  for (const f of all) analyses.push(await analyzeMessage({ id: f.id, receivedAt: "2026-09-15T10:00:00Z", source: "text", text: f.text }, { catalog, matcher, config: finalCfg }));
  const shipped = toMap(analyses.map(fromAnalysis));
  // Contrôle : le balayage (decideChunk sur scores bruts) donne exactement la même chose que le chemin livré.
  let mismatches = 0;
  for (const f of all) {
    const a = shipped.get(f.id)!;
    const b = decide(prepared.get(f.id)!, finalCfg);
    if (JSON.stringify(a.chunks.map((c) => [c.status, c.findings])) !== JSON.stringify(b.chunks.map((c) => [c.status, c.findings]))) mismatches++;
  }
  if (mismatches) log(`[level2] WARNING: ${mismatches} messages differ between sweep and shipped path`);

  const kw = toMap(all.map((f) => keywordOutput(f.id, f.text, f.lang, lists)));
  const echoTest = evaluateByLang(test, shipped);
  const kwTest = evaluateByLang(test, kw);
  const echoCal = evaluate(calibration, shipped);
  const kwCal = evaluate(calibration, kw);
  const echoAll = evaluate(all, shipped);
  const kwAll = evaluate(all, kw);
  const curveTest = sweep(test, prepared, finalCfg);
  const testAtOtherVariants = variantResults.filter((r) => r.chosen).map((r) => {
    const v = r.variant as Variant;
    const pt = r.chosen as SweepPoint;
    const p = preparedByVariant.get(v.name)!;
    const fl = floorByVariant.get(v.name)!.floor;
    const m = evaluate(test, toMap(test.map((f) => decide(p.get(f.id)!, withAccept(variantConfig(v, { offListThreshold: fl }), pt.threshold)))));
    return { variant: v.name, selectable: v.selectable !== false, threshold: pt.threshold, floor: fl, calibration: { captureRate: pt.captureRate, acceptedErrorRate: pt.acceptedErrorRate }, test: summary(m) };
  });

  log(`[level2] TEST Echo: P ${echoTest.all.micro.precision} R ${echoTest.all.micro.recall} F1 ${echoTest.all.micro.f1} accepted-error ${echoTest.all.answers.acceptedErrorRate} capture ${echoTest.all.remarks.captureRate} not-sure ${echoTest.all.chunks.notSureRate}`);
  log(`[level2] TEST keywords (${keywordSet}): P ${kwTest.all.micro.precision} R ${kwTest.all.micro.recall} F1 ${kwTest.all.micro.f1} accepted-error ${kwTest.all.answers.acceptedErrorRate} capture ${kwTest.all.remarks.captureRate}`);
  // Les deux jeux de mots-clés sont toujours rapportés (original = auteur du corpus, blind = protocole aveugle).
  const kwBySet = Object.fromEntries(
    KEYWORD_SET_NAMES.map((name) => [name, name === keywordSet ? kw : toMap(all.map((f) => keywordOutput(f.id, f.text, f.lang, loadKeywordSet(name))))]),
  );
  const keywordSets = Object.fromEntries(
    KEYWORD_SET_NAMES.map((name) => {
      const out = kwBySet[name]!;
      const t = evaluateByLang(test, out);
      log(`[level2] TEST keywords[${name}]: P ${t.all.micro.precision} R ${t.all.micro.recall} F1 ${t.all.micro.f1} accepted-error ${t.all.answers.acceptedErrorRate} capture ${t.all.remarks.captureRate}`);
      return [name, { test: t, calibration: evaluate(calibration, out), all: evaluate(all, out) }];
    }),
  );

  const unknown = unknownTopics(analyses, byId, finalCfg);
  for (const m of [unknown.offListOnly, unknown.offListAndUnsure])
    log(`[level2] unknown topic (${m.sources}): full corpus detected=${m.fullCorpus.detected} falseAlerts=${m.fullCorpus.falseAlerts}; realistic months detection ${m.realisticMonths.detectionRate} false-alert months ${m.realisticMonths.falseAlertMonthRate}`);
  const dup = await duplicates(test, { catalog, matcher, config: finalCfg });
  log(`[level2] duplicates: false ${dup.falseDuplicatesAmongDistinctMessages}, resend ${JSON.stringify(Object.fromEntries(Object.entries(dup.resend).map(([k, v]) => [k, v.rate])))}`);

  const date = new Date().toISOString().slice(0, 10);
  const calibrationOut = {
    synthetic: true,
    maxAcceptedError: MAX_ACCEPTED_ERROR,
    minNegationAccuracy: MIN_NEGATION_ACCURACY,
    captureTolerance: CAPTURE_TOLERANCE,
    rule: `off-list floor first = Youden index between chunks aligned only with off-list passages and chunks aligned with finding/ambiguous passages (calibration half); then threshold = maximise the share of remarks captured on the calibration half subject to accepted-answer error <= ${MAX_ACCEPTED_ERROR * 100}%, >= 20 accepted answers and cancelling-negation accuracy >= ${MIN_NEGATION_ACCURACY * 100}%; variant (embedding model, scoring, L2, negation margin) = lowest error among the selectable variants whose capture under that rule is within ${CAPTURE_TOLERANCE * 100} points of the best`,
    split: { seed: 20261004, calibration: calibration.length, test: test.length, stratifiedBy: "language x main category (picking, off-list, ambiguous, cancelling negation, inherent negation, multi-finding, single)" },
    variant: bestVariant,
    embeddingModel: EMBEDDERS[bestVariant.embedder],
    scoring: finalCfg.scoring,
    acceptProbability: finalCfg.scoring === "linear" ? finalCfg.acceptProbability : null,
    acceptThreshold: finalCfg.scoring === "similarity" ? finalCfg.acceptThreshold : null,
    offListThreshold: finalCfg.offListThreshold,
    linearL2: finalCfg.scoring === "linear" ? finalCfg.linearL2 : null,
    linearEpochs: finalCfg.scoring === "linear" ? finalCfg.linearEpochs : null,
    negationMargin: finalCfg.scoring === "linear" ? finalCfg.negationMargin : null,
    floorSelection: floor,
    offListClusterThreshold: finalCfg.offListClusterThreshold,
    clusterThresholdSelection: clusterCal,
    unknownTopicSources: finalCfg.unknownTopicSources,
    atThresholdCalibration: bestPoint,
    catalogExamples,
    date,
  };
  writeJson(join(RESULTS_DIR, "thresholds.json"), calibrationOut);
  if (opts.writeCalibration !== false) {
    writeCoreCalibration(finalCfg, {
      embeddingModel: EMBEDDERS[bestVariant.embedder]!,
      calibration: bestPoint,
      test: { acceptedErrorRate: echoTest.all.answers.acceptedErrorRate, captureRate: echoTest.all.remarks.captureRate },
      catalogExamples,
      date,
      variant: bestVariant.name,
    });
  }

  const result = {
    synthetic: true,
    note: "All level-2 data is SYNTHETIC (written feedbacks by the team, eval/data/README.md). Reported numbers are on the held-out test half unless stated.",
    corpus: { total: all.length, calibration: calibration.length, test: test.length, byLangTest: Object.fromEntries(["en", "fr", "de", "es"].map((l) => [l, test.filter((f) => f.lang === l).length])) },
    catalogExamples,
    calibration: calibrationOut,
    config: finalCfg,
    sweepVsShippedMismatches: mismatches,
    variants: variantResults.map((r) => ({ variant: (r.variant as Variant).name, selectable: (r.variant as Variant).selectable !== false, floor: r.floor, chosen: r.chosen })),
    variantsOnTest: testAtOtherVariants,
    curves: { calibration: best.curveCalibration, test: curveTest },
    echo: { test: echoTest, calibration: echoCal, all: echoAll },
    keywordSet,
    keywords: { test: kwTest, calibration: kwCal, all: kwAll },
    keywordSets,
    languageDetection: {
      correct: analyses.filter((a) => a.lang === byId.get(a.id)!.lang).length,
      unknown: analyses.filter((a) => a.lang === "unknown").length,
      total: analyses.length,
    },
    unknownTopics: unknown,
    duplicates: dup,
    perMessageTest: test.map((f) => ({
      id: f.id,
      lang: f.lang,
      text: f.text,
      expected: f.expectedFindings,
      echo: shipped.get(f.id)!.findings,
      echoChunks: shipped.get(f.id)!.chunks.map((c) => `${c.status}${c.findings.length ? ":" + c.findings.join("+") : ""} | ${c.text}`),
      keywords: kw.get(f.id)!.findings,
      keywordsBySet: Object.fromEntries(KEYWORD_SET_NAMES.map((name) => [name, kwBySet[name]!.get(f.id)!.findings])),
    })),
  };
  writeJson(join(RESULTS_DIR, "level2.json"), result);
  return { result, finalCfg, bestVariant, catalog, lists, analyses };
}
