// Rattachement des morceaux aux constats par similarité d'embeddings (SPEC 4.3 étapes 5 à 7).
import type { Catalog } from "./catalog.ts";
import type { AnalysisConfig } from "./config.ts";
import type { EmbedFn } from "./ports.ts";
import type { ChunkStatus, DetectedLang, FindingScore, NegationInfo } from "./types.ts";
import { notImplemented } from "./not-implemented.ts";

export interface ChunkMatch {
  status: ChunkStatus;
  findings: FindingScore[]; // ≤ maxFindingsPerChunk, seulement si "matched"
  topScores: FindingScore[]; // top 3 bruts
  embedding: Float32Array; // réutilisé pour le regroupement hors liste
  reason?: string;
}

export interface Matcher {
  /** Classe des morceaux déjà nettoyés. La négation est fournie pour décider « pas sûr » / constat opposé. */
  match(chunks: { text: string; negation: NegationInfo }[], lang: DetectedLang): Promise<ChunkMatch[]>;
}

/** Pré-calcule les embeddings des exemples du catalogue (une fois), puis renvoie un Matcher. */
export async function createMatcher(catalog: Catalog, embed: EmbedFn, config: AnalysisConfig): Promise<Matcher> {
  void catalog; void embed; void config;
  return notImplemented("createMatcher");
}

/** Similarité cosinus de deux vecteurs normalisés. */
export function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] ?? 0) * (b[i] ?? 0);
  return s;
}
