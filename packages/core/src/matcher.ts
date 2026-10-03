// Rattachement des morceaux aux constats par similarité d'embeddings (SPEC 4.3 étapes 5 à 7).
//
// Score d'un constat = max (ou moyenne des k meilleures) des cosinus entre le morceau et les exemples du
// constat, toutes langues confondues (ou langue détectée seulement, selon la config).
//
// Accord de négation : chaque exemple du catalogue est marqué « nié » ou non (detectNegation). Un morceau
// nié n'est comparé, pour être accepté, qu'aux exemples niés (« there was no shade » → N8), et un morceau
// non nié qu'aux exemples non niés. Si le meilleur rapprochement vient d'un exemple de négation opposée
// (« the path was not too long » ressemble à « the path was too long »), le sens est inversé : le morceau
// n'est jamais compté pour ce constat et passe en « pas sûr » (raison "negation"). Valable pour les constats
// négatifs (pas de faux N1) comme positifs (« the food was not good » ne donne jamais P4).
import type { Catalog } from "./catalog.ts";
import type { AnalysisConfig } from "./config.ts";
import type { EmbedFn } from "./ports.ts";
import type { ChunkStatus, DetectedLang, FindingId, FindingScore, NegationInfo, VisitorLang } from "./types.ts";
import { detectNegation } from "./negation.ts";
import { predictProba, trainLinearClassifier, type LinearClassifier } from "./linear.ts";

export interface ChunkMatch {
  status: ChunkStatus;
  findings: FindingScore[]; // ≤ maxFindingsPerChunk, seulement si "matched"
  topScores: FindingScore[]; // top 3 bruts (toutes négations confondues)
  embedding: Float32Array; // réutilisé pour le regroupement hors liste
  reason?: string;
}

/** Un exemple du catalogue, plongé une fois pour toutes. */
export interface PreparedExample {
  findingId: FindingId;
  lang: VisitorLang;
  text: string;
  negated: boolean;
  embedding: Float32Array;
}

/** Scores bruts d'un constat pour un morceau. */
export interface FindingRawScore {
  id: FindingId;
  /** Score avec les exemples de même négation que le morceau (seul score qui peut faire accepter). */
  agree: number;
  /** Score avec les exemples de négation opposée (sens inversé). */
  inverted: number;
  /** Score avec tous les exemples (affichage). */
  any: number;
  /** Mode "linear" : probabilité du constat selon le classifieur linéaire. */
  probability?: number;
}

export type MatchConfig = Pick<
  AnalysisConfig,
  | "acceptThreshold"
  | "offListThreshold"
  | "maxFindingsPerChunk"
  | "secondFindingMargin"
  | "aggregation"
  | "topK"
  | "crossLingual"
  | "scoring"
  | "acceptProbability"
  | "linearL2"
  | "linearEpochs"
  | "negationMargin"
>;

/** Paramètres utilisés par decideChunk. */
export type DecideConfig = Pick<
  AnalysisConfig,
  "acceptThreshold" | "offListThreshold" | "maxFindingsPerChunk" | "secondFindingMargin"
> &
  Partial<Pick<AnalysisConfig, "scoring" | "acceptProbability" | "negationMargin">>;

export interface Matcher {
  /** Classe des morceaux déjà nettoyés. La négation est fournie pour décider « pas sûr » / constat. */
  match(chunks: { text: string; negation: NegationInfo }[], lang: DetectedLang): Promise<ChunkMatch[]>;
  /** Scores bruts (pour l'évaluation : balayage des seuils sans replonger les textes). */
  score(chunks: { text: string; negation: NegationInfo }[], lang: DetectedLang): Promise<{ embedding: Float32Array; scores: FindingRawScore[] }[]>;
  /** Accès direct au port d'embedding (messages entiers, regroupement hors liste). */
  embed: EmbedFn;
  /** Exemples préparés (lecture seule). */
  readonly examples: readonly PreparedExample[];
  /** Classifieur linéaire (mode "linear"), à mettre en cache par l'app avec les embeddings des exemples. */
  readonly classifier?: LinearClassifier;
}

const NONE = -1;

/** Similarité cosinus de deux vecteurs normalisés. */
export function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] ?? 0) * (b[i] ?? 0);
  return s;
}

function aggregate(sims: number[], config: Pick<AnalysisConfig, "aggregation" | "topK">): number {
  if (sims.length === 0) return NONE;
  if (config.aggregation === "max") return Math.max(...sims);
  const top = [...sims].sort((a, b) => b - a).slice(0, config.topK);
  return top.reduce((a, b) => a + b, 0) / top.length;
}

/** Scores bruts d'un embedding de morceau contre tous les constats (fonction pure). */
export function scoreFindings(
  embedding: Float32Array,
  examples: readonly PreparedExample[],
  chunk: { negated: boolean; lang: DetectedLang },
  config: Pick<AnalysisConfig, "aggregation" | "topK" | "crossLingual">,
  findingIds: readonly FindingId[],
): FindingRawScore[] {
  const byFinding = new Map<FindingId, PreparedExample[]>();
  for (const ex of examples) {
    const list = byFinding.get(ex.findingId) ?? [];
    list.push(ex);
    byFinding.set(ex.findingId, list);
  }
  return findingIds.map((id) => {
    let exs = byFinding.get(id) ?? [];
    if (!config.crossLingual) {
      const same = exs.filter((e) => e.lang === chunk.lang);
      if (same.length > 0) exs = same;
    }
    const agree: number[] = [];
    const inverted: number[] = [];
    for (const e of exs) {
      const s = cosine(embedding, e.embedding);
      (e.negated === chunk.negated ? agree : inverted).push(s);
    }
    return { id, agree: aggregate(agree, config), inverted: aggregate(inverted, config), any: aggregate([...agree, ...inverted], config) };
  });
}

const round = (x: number): number => Math.round(x * 1000) / 1000;

/** Décision pour un morceau à partir de ses scores bruts (fonction pure, SPEC 4.3 et 7). */
export function decideChunk(
  scores: readonly FindingRawScore[],
  negation: NegationInfo,
  config: DecideConfig,
): { status: ChunkStatus; findings: FindingScore[]; topScores: FindingScore[]; reason: string } {
  const topScores = [...scores]
    .sort((a, b) => b.any - a.any)
    .slice(0, 3)
    .map((s) => ({ id: s.id, score: round(s.any) }));
  const byAgree = [...scores].sort((a, b) => b.agree - a.agree);
  const best = byAgree[0];
  const bestInverted = Math.max(NONE, ...scores.map((s) => s.inverted));
  const bestAgree = best?.agree ?? NONE;
  const overall = Math.max(bestAgree, bestInverted);

  if (overall < config.offListThreshold) return { status: "off_list", findings: [], topScores, reason: "below_floor" };
  if (negation.uncertain) return { status: "not_sure", findings: [], topScores, reason: "negation_uncertain" };

  if (config.scoring === "linear" && scores.every((s) => s.probability !== undefined)) {
    // Probabilité du classifieur linéaire ; l'accord de négation s'applique au constat proposé : si ses
    // exemples de négation opposée ressemblent plus au morceau que ceux de même négation, sens inversé.
    // negationMargin : tolérance (cosinus) avant de juger le sens inversé ; le constat doit de toute façon avoir
    // des exemples de même négation que le morceau (agree > NONE).
    const minP = config.acceptProbability ?? 0.5;
    const margin = config.negationMargin ?? 0;
    const agrees = (s: FindingRawScore) => s.agree > NONE && s.agree >= s.inverted - margin;
    const byP = [...scores].sort((a, b) => b.probability! - a.probability!);
    const top = byP[0]!;
    const linTop = byP.slice(0, 3).map((s) => ({ id: s.id, score: round(s.probability!) }));
    if (top.probability! >= minP && agrees(top)) {
      const findings: FindingScore[] = [{ id: top.id, score: round(top.probability!) }];
      for (const s of byP.slice(1)) {
        if (findings.length >= config.maxFindingsPerChunk || s.probability! < minP) break;
        if (agrees(s)) findings.push({ id: s.id, score: round(s.probability!) });
      }
      return { status: "matched", findings, topScores: linTop, reason: "above_threshold" };
    }
    if (!agrees(top)) return { status: "not_sure", findings: [], topScores: linTop, reason: "negation" };
    return { status: "not_sure", findings: [], topScores: linTop, reason: "below_threshold" };
  }

  if (best && bestAgree >= config.acceptThreshold && bestAgree >= bestInverted) {
    const findings: FindingScore[] = [{ id: best.id, score: round(bestAgree) }];
    for (const s of byAgree.slice(1)) {
      if (findings.length >= config.maxFindingsPerChunk) break;
      if (s.agree < config.acceptThreshold || bestAgree - s.agree > config.secondFindingMargin) break;
      if (s.agree < s.inverted) continue;
      findings.push({ id: s.id, score: round(s.agree) });
    }
    return { status: "matched", findings, topScores, reason: "above_threshold" };
  }
  // Le rapprochement le plus fort vient d'un exemple de négation opposée : sens inversé, jamais compté.
  if (bestInverted > bestAgree && bestInverted >= config.offListThreshold) {
    return { status: "not_sure", findings: [], topScores, reason: "negation" };
  }
  return { status: "not_sure", findings: [], topScores, reason: "below_threshold" };
}

export interface CreateMatcherOptions {
  /**
   * Embeddings d'exemples déjà calculés (cache IndexedDB de l'app, ou fichier produit au build) :
   * texte → vecteur. Seuls les exemples absents sont plongés. Doivent venir du MÊME modèle.
   */
  precomputed?: ReadonlyMap<string, Float32Array>;
  /** Classifieur linéaire déjà entraîné (mode "linear") avec le MÊME modèle et le MÊME catalogue. */
  classifier?: LinearClassifier;
}

/** Embeddings des exemples d'un matcher, à mettre en cache (texte → vecteur). */
export function exportExampleEmbeddings(matcher: Matcher): Map<string, Float32Array> {
  return new Map(matcher.examples.map((e) => [e.text, e.embedding]));
}

/** Pré-calcule les embeddings des exemples du catalogue (une fois), puis renvoie un Matcher. */
export async function createMatcher(catalog: Catalog, embed: EmbedFn, config: MatchConfig, options: CreateMatcherOptions = {}): Promise<Matcher> {
  const pending: Omit<PreparedExample, "embedding">[] = [];
  for (const f of catalog.findings) {
    for (const lang of Object.keys(f.examples) as VisitorLang[]) {
      for (const text of f.examples[lang] ?? []) {
        if (!text.trim()) continue;
        pending.push({ findingId: f.id, lang, text, negated: detectNegation(text, lang).negated });
      }
    }
  }
  const cache = options.precomputed;
  const missing = [...new Set(pending.filter((p) => !cache?.has(p.text)).map((p) => p.text))];
  const vectors = missing.length ? await embed(missing) : [];
  if (vectors.length !== missing.length) throw new Error("EmbedFn must return one vector per text");
  const fresh = new Map(missing.map((t, i) => [t, vectors[i]!]));
  const examples: PreparedExample[] = pending.map((p) => ({ ...p, embedding: cache?.get(p.text) ?? fresh.get(p.text)! }));
  const findingIds = catalog.findings.map((f) => f.id);
  let classifier: LinearClassifier | undefined;
  if (config.scoring === "linear") {
    classifier = options.classifier;
    if (!classifier || classifier.classes.join() !== findingIds.join() || classifier.dim !== (examples[0]?.embedding.length ?? 0)) {
      classifier = trainLinearClassifier(
        examples.map((e) => e.embedding),
        examples.map((e) => findingIds.indexOf(e.findingId)),
        findingIds,
        { l2: config.linearL2, epochs: config.linearEpochs },
      );
    }
  }

  const score: Matcher["score"] = async (chunks, lang) => {
    if (chunks.length === 0) return [];
    const embs = await embed(chunks.map((c) => c.text));
    if (embs.length !== chunks.length) throw new Error("EmbedFn must return one vector per text");
    return chunks.map((c, i) => {
      const scores = scoreFindings(embs[i]!, examples, { negated: c.negation.negated, lang }, config, findingIds);
      if (classifier) {
        const p = predictProba(classifier, embs[i]!);
        scores.forEach((s, k) => (s.probability = p[k]!));
      }
      return { embedding: embs[i]!, scores };
    });
  };

  return {
    examples,
    embed,
    score,
    classifier,
    async match(chunks, lang) {
      const scored = await score(chunks, lang);
      return scored.map((s, i) => ({ ...decideChunk(s.scores, chunks[i]!.negation, config), embedding: s.embedding }));
    },
  };
}
