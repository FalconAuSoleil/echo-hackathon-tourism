// Faire tourner Echo (code de @echo/core, modèles de @echo/models) et la référence par mots-clés sur le corpus.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import {
  analyzeMessage,
  createMatcher,
  decideChunk,
  keywordAnalyze,
  keywordListsFromFiles,
  makeConfig,
  validateCatalog,
  type AnalysisConfig,
  type DecideConfig,
  type Catalog,
  type EmbedFn,
  type FindingId,
  type FindingRawScore,
  type KeywordFile,
  type KeywordLists,
  type Matcher,
  type MessageAnalysis,
} from "@echo/core";
import { createEmbedder, useLocalModels } from "@echo/models";
import { readJson } from "./io.ts";
import { CATALOG_PATH, KEYWORDS_DIR, MODELS_DIR } from "./paths.ts";
import type { PredChunk, SystemOutput } from "./metrics.ts";

useLocalModels(MODELS_DIR);

export const EMBEDDERS: Record<string, string> = {
  minilm: "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
  e5: "Xenova/multilingual-e5-small",
  mpnet: "Xenova/paraphrase-multilingual-mpnet-base-v2",
};

export function loadCatalog(): Catalog {
  return validateCatalog(readJson(CATALOG_PATH));
}

export function loadKeywordLists(): KeywordLists {
  const files = readdirSync(KEYWORDS_DIR).filter((f) => /^[a-z]{2}\.json$/.test(f));
  return keywordListsFromFiles(files.map((f) => readJson<KeywordFile>(join(KEYWORDS_DIR, f))));
}

/** EmbedFn avec cache mémoire (texte → vecteur) : chaque texte n'est plongé qu'une fois par modèle. */
export function cachedEmbed(embed: EmbedFn): EmbedFn & { size: () => number } {
  const m = new Map<string, Float32Array>();
  const f = async (texts: string[]) => {
    const miss = [...new Set(texts.filter((t) => !m.has(t)))];
    if (miss.length) {
      const v = await embed(miss);
      miss.forEach((t, i) => m.set(t, v[i]!));
    }
    return texts.map((t) => m.get(t)!);
  };
  return Object.assign(f, { size: () => m.size });
}

const embedderCache = new Map<string, EmbedFn>();
export async function getEmbedder(key: string): Promise<EmbedFn> {
  let e = embedderCache.get(key);
  if (!e) {
    e = cachedEmbed(await createEmbedder(EMBEDDERS[key]!));
    embedderCache.set(key, e);
  }
  return e;
}

/** Message analysé une fois (découpage, négation, langue) + scores bruts par morceau, pour balayer les seuils. */
export interface Prepared {
  id: string;
  analysis: MessageAnalysis;
  raw: FindingRawScore[][]; // par morceau
}

export async function prepareTexts(
  items: readonly { id: string; text: string; receivedAt?: string }[],
  matcher: Matcher,
  catalog: Catalog,
  config: AnalysisConfig,
): Promise<Prepared[]> {
  const out: Prepared[] = [];
  for (const it of items) {
    const analysis = await analyzeMessage({ id: it.id, receivedAt: it.receivedAt ?? "2026-09-15T10:00:00Z", source: "text", text: it.text }, { catalog, matcher, config });
    out.push({ id: it.id, analysis, raw: await rawScores(analysis, matcher) });
  }
  return out;
}

export async function rawScores(analysis: MessageAnalysis, matcher: Matcher): Promise<FindingRawScore[][]> {
  if (analysis.chunks.length === 0) return [];
  const s = await matcher.score(analysis.chunks.map((c) => ({ text: c.text, negation: c.negation })), analysis.lang);
  return s.map((x) => x.scores);
}

/** Décision de tous les morceaux pour une configuration de seuils (decideChunk de @echo/core, fonction pure). */
export function decide(p: Prepared, cfg: DecideConfig): SystemOutput {
  const a = p.analysis;
  if (a.status === "inaudible" || a.status === "duplicate") return fromAnalysis(a);
  const forced = a.status === "not_sure";
  const chunks: PredChunk[] = a.chunks.map((c, i) => {
    if (forced) return { text: c.text, status: "not_sure", findings: [], reason: a.reason };
    const d = decideChunk(p.raw[i]!, c.negation, cfg);
    return { text: c.text, status: d.status, findings: d.findings.map((f) => f.id), reason: d.reason };
  });
  return { id: a.id, messageStatus: a.status, chunks, findings: [...new Set(chunks.flatMap((c) => c.findings))] };
}

/** Sortie d'évaluation à partir d'une vraie MessageAnalysis (chemin livré). */
export function fromAnalysis(a: MessageAnalysis): SystemOutput {
  return {
    id: a.id,
    messageStatus: a.status,
    chunks: a.chunks.map((c) => ({ text: c.text, status: c.status, findings: c.findings.map((f) => f.id), reason: c.reason })),
    findings: a.findings.map((f) => f.id),
  };
}

/** Référence sans IA : même découpage, mots-clés par morceau, aucun seuil, aucune négation. */
export function keywordOutput(id: string, text: string, lang: string, lists: KeywordLists): SystemOutput {
  const k = keywordAnalyze(text, lang, lists);
  return {
    id,
    messageStatus: "keywords",
    chunks: k.chunks.map((c) => ({ text: c.text, status: c.findings.length ? "matched" : "off_list", findings: c.findings as FindingId[] })),
    findings: k.findings as FindingId[],
  };
}

export interface Variant {
  name: string;
  embedder: string;
  scoring: "similarity" | "linear";
  aggregation: "max" | "topk_mean";
  crossLingual: boolean;
  /** Mode linear : pénalité L2. */
  l2?: number;
  /** Mode linear : marge de l'accord de négation. */
  negationMargin?: number;
  /** false : mesurée et rapportée, mais jamais retenue (voir level2.ts). */
  selectable?: boolean;
}

export function variantConfig(v: Variant, overrides: Partial<AnalysisConfig> = {}): AnalysisConfig {
  return makeConfig({
    scoring: v.scoring,
    aggregation: v.aggregation,
    topK: 3,
    crossLingual: v.crossLingual,
    linearL2: v.l2 ?? 3e-4,
    linearEpochs: 150,
    negationMargin: v.negationMargin ?? 0,
    ...overrides,
    // le seuil d'acceptation est fixé ensuite par withAccept ; ici il doit seulement rester ≥ au plancher
    // Indépendant de calibration.ts (sinon un balayage dépendrait du résultat du précédent) : plancher 0 par
    // défaut ; le seuil d'acceptation est fixé ensuite par withAccept et doit rester ≥ au plancher.
    offListThreshold: overrides.offListThreshold ?? 0,
    ...(overrides.acceptThreshold === undefined ? { acceptThreshold: Math.max(0.6, overrides.offListThreshold ?? 0) } : {}),
  });
}

/** Le seuil balayé : probabilité (linear) ou cosinus (similarity). */
export function withAccept(cfg: AnalysisConfig, t: number): AnalysisConfig {
  return cfg.scoring === "linear"
    ? { ...cfg, acceptProbability: t }
    : { ...cfg, acceptThreshold: t, offListThreshold: Math.min(cfg.offListThreshold, t) };
}

export const acceptOf = (cfg: AnalysisConfig): number => (cfg.scoring === "linear" ? cfg.acceptProbability : cfg.acceptThreshold);

export async function variantMatcher(v: Variant, catalog: Catalog, cfg: AnalysisConfig): Promise<Matcher> {
  return createMatcher(catalog, await getEmbedder(v.embedder), cfg);
}
