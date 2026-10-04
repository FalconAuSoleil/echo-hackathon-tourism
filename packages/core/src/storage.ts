// Ce qui a le droit d'être stocké (SPEC 6), calculé à partir d'une analyse. L'app ne persiste QUE ces
// deux formes : jamais l'audio, jamais le texte complet, jamais de nom ni de numéro.
import type { AnalysisConfig } from "./config.ts";
import { clusterOffList, type OffListCluster, type OffListItem } from "./offlist.ts";
import { DEFAULT_CONFIG } from "./config.ts";
import { detectTextLanguage } from "./language.ts";
import { scrubPii } from "./pii.ts";
import type { FindingId, MessageAnalysis, MessageSource, MessageStatus, DetectedLang } from "./types.ts";

/**
 * Message écrit nettoyé AVANT d'entrer dans la file d'attente (SPEC 4.3 étape 3, SPEC 6) : collé, importé en
 * .txt ou partagé depuis WhatsApp, il peut attendre longtemps l'analyse ; aucun nom, numéro ni e-mail ne doit
 * rester en clair sur le téléphone pendant ce temps. Même langue devinée que `analyzeMessage`, qui nettoie
 * une seconde fois (sans effet sur un texte déjà nettoyé).
 */
export function scrubForQueue(text: string, minLanguageProbability = DEFAULT_CONFIG.minLanguageProbability): string {
  return scrubPii(text, detectTextLanguage(text, minLanguageProbability).lang).text;
}

/** Fiche d'un message : date, langue, constats avec confiance, statut. Aucun texte. */
export interface StoredMessage {
  id: string;
  receivedAt: string;
  month: string;
  lang: DetectedLang;
  source: MessageSource;
  status: MessageStatus;
  findings: { id: FindingId; confidence: number }[];
  /** Constats appuyés hors morceaux « guide » : seuls exportables vers la coopérative. */
  coopFindings: FindingId[];
  notSureCount: number;
  offListCount: number;
  /**
   * Empreinte du texte nettoyé (doublons exacts). Hachage rapide sans sel : pour un retour court, on peut
   * retrouver le texte en hachant des phrases candidates. Elle ne sert que dans la fenêtre des doublons :
   * retirée de la fiche avec l'embedding (`expireMessageEmbedding`).
   */
  fingerprint?: string;
  /**
   * Embedding du message nettoyé (quasi-doublons). Utile seulement pendant la fenêtre des doublons
   * (`duplicateWindowDays`) : retiré de la fiche ensuite (`expireMessageEmbedding`).
   */
  embedding?: Float32Array;
  synthetic?: boolean;
}

/** Morceau « pas sûr » ou « hors liste » pour la liste « À faire lire par une personne ». */
export interface ReviewChunk {
  id: string;
  messageId: string;
  month: string;
  status: "not_sure" | "off_list";
  /** Texte sans nom, numéro ni e-mail. */
  text: string;
  /**
   * Traduction anglaise Whisper, nettoyée : « traduction automatique, à vérifier ». Celle du ou des segments
   * audio du morceau quand aucun de ces segments ne contient un morceau compté (`ChunkResult.englishMT`) ; à
   * défaut de segments, celle du message entier quand TOUT le message est à relire. Jamais une proposition
   * comptée en texte (SPEC 6). Jamais pour un message écrit (aucune traduction automatique à l'exécution).
   */
  englishMT?: string;
  /** Parle du guide : visible par l'hôte uniquement, jamais dans la vue coopérative ni un export. */
  mentionsGuide: boolean;
  reason?: string;
  /**
   * Embedding du morceau : sert seulement à regrouper les sujets inconnus DU MOIS (le regroupement ne traverse
   * pas les mois). Retiré quand le mois est fermé (`closeMonthReviewChunks`), après que le groupe a été écrit.
   */
  embedding?: Float32Array;
  /** Groupe « sujet inconnu » calculé à la fermeture du mois (morceaux candidats seulement). */
  clusterId?: string;
  /** Le groupe réunit au moins `offListMinVisitors` visiteurs distincts (signalé dans le récap). */
  clusterRecurring?: boolean;
  synthetic?: boolean;
}

export function toStoredMessage(a: MessageAnalysis, options: { synthetic?: boolean } = {}): StoredMessage {
  return {
    id: a.id,
    receivedAt: a.receivedAt,
    month: a.month,
    lang: a.lang,
    source: a.source,
    status: a.status,
    findings: a.findings.map((f) => ({ id: f.id, confidence: f.score })),
    coopFindings: [...a.coopFindings],
    notSureCount: a.notSureCount,
    offListCount: a.offListCount,
    fingerprint: a.fingerprint,
    ...(a.messageEmbedding ? { embedding: a.messageEmbedding } : {}),
    ...(options.synthetic ? { synthetic: true } : {}),
  };
}

/** Tous les morceaux du message sont-ils « pas sûr » ou « hors liste » ? (le message entier est à relire) */
export function wholeMessageUnderReview(a: MessageAnalysis): boolean {
  return a.chunks.length > 0 && a.chunks.every((c) => c.status === "not_sure" || c.status === "off_list");
}

export function toReviewChunks(a: MessageAnalysis, options: { synthetic?: boolean } = {}): ReviewChunk[] {
  if (a.status === "duplicate" || a.status === "inaudible") return [];
  // Repli sans segments (transcription sans horodatages) : traduction du message entier, s'il est tout à relire.
  const wholeMT = !!a.englishTranslation && wholeMessageUnderReview(a) && a.chunks.every((c) => c.englishMT === undefined);
  return a.chunks
    .filter((c): c is typeof c & { status: "not_sure" | "off_list" } => c.status === "not_sure" || c.status === "off_list")
    .map((c) => ({
      id: c.id,
      messageId: a.id,
      month: a.month,
      status: c.status,
      text: c.text,
      ...(c.englishMT ? { englishMT: c.englishMT } : wholeMT ? { englishMT: a.englishTranslation } : {}),
      mentionsGuide: c.mentionsGuide,
      ...(c.reason ? { reason: c.reason } : {}),
      ...(c.embedding ? { embedding: c.embedding } : {}),
      ...(options.synthetic ? { synthetic: true } : {}),
    }));
}

/** L'embedding du message a-t-il dépassé la fenêtre des doublons ? (dates ISO ; date illisible → expiré) */
export function messageEmbeddingExpired(receivedAt: string, now: Date, duplicateWindowDays: number): boolean {
  const t = Date.parse(receivedAt);
  if (Number.isNaN(t)) return true;
  return now.getTime() - t > duplicateWindowDays * 86_400_000;
}

/**
 * Fiche sans son embedding ni son empreinte si la fenêtre des doublons est passée : ils ne servent plus à rien
 * (`checkDuplicate` ignore les messages hors fenêtre) et pourraient être en partie inversés vers le texte.
 * Renvoie `null` si la fiche n'a rien à changer.
 */
export function expireMessageEmbedding(m: StoredMessage, now: Date, duplicateWindowDays: number): StoredMessage | null {
  if ((!m.embedding && m.fingerprint === undefined) || !messageEmbeddingExpired(m.receivedAt, now, duplicateWindowDays)) return null;
  const { embedding: _e, fingerprint: _f, ...rest } = m;
  return rest;
}

/**
 * Morceaux stockés candidats au signal « sujet inconnu » : même règle que `unknownTopicItems` (hors liste, plus
 * « pas sûr » sous le seuil si la config le dit ; jamais ceux mis en « pas sûr » par une négation ou un message
 * entier peu fiable). Seuls les morceaux qui ont encore leur embedding (mois non fermé) sont rendus.
 */
export function reviewChunkCandidates(chunks: readonly ReviewChunk[], config: Pick<AnalysisConfig, "unknownTopicSources">): OffListItem[] {
  return chunks
    .filter((c) => c.embedding && isUnknownTopicCandidate(c, config))
    .map((c) => ({ chunkId: c.id, visitorKey: c.messageId, month: c.month, text: c.text, embedding: c.embedding! }));
}

function isUnknownTopicCandidate(c: ReviewChunk, config: Pick<AnalysisConfig, "unknownTopicSources">): boolean {
  return c.status === "off_list" || (config.unknownTopicSources === "off_list_and_unsure" && c.status === "not_sure" && c.reason === "below_threshold");
}

/** Mois fermé : strictement avant le mois courant (« YYYY-MM », même horloge que `month` : date ISO UTC). */
export function isClosedMonth(month: string, currentMonth: string): boolean {
  return month < currentMonth;
}

/**
 * Fermeture d'un mois (SPEC 6 : seul le texte nettoyé des morceaux à relire est gardé). Les sujets inconnus du
 * mois sont regroupés une fois, le groupe est écrit sur chaque morceau candidat (`clusterId`,
 * `clusterRecurring`), puis l'embedding de TOUS les morceaux du mois est retiré : il ne sert plus à rien (le
 * regroupement ne traverse pas les mois) et pourrait être en partie inversé vers le texte.
 * Un morceau arrivé après la fermeture (rare : un message du mois traité plus tard) est regroupé avec les
 * seuls autres retardataires, sans pouvoir rejoindre un groupe déjà fermé.
 * Entrée : les morceaux d'UN mois. Sortie : seulement les morceaux modifiés.
 */
export function closeMonthReviewChunks(
  monthChunks: readonly ReviewChunk[],
  config: Pick<AnalysisConfig, "offListClusterThreshold" | "offListMinVisitors" | "unknownTopicSources">,
): ReviewChunk[] {
  const pending = monthChunks.filter((c) => c.embedding);
  if (pending.length === 0) return [];
  const clusters = clusterOffList(reviewChunkCandidates(pending, config), config);
  const byChunk = new Map<string, OffListCluster>();
  for (const cl of clusters) for (const id of cl.chunkIds) byChunk.set(id, cl);
  return pending.map((c) => {
    const { embedding: _dropped, ...rest } = c;
    const cl = byChunk.get(c.id);
    return cl ? { ...rest, clusterId: cl.id, clusterRecurring: cl.recurring } : rest;
  });
}

/** Groupes « sujet inconnu » d'un mois fermé, relus depuis les `clusterId` stockés (aucun embedding requis). */
export function clustersFromStoredChunks(chunks: readonly ReviewChunk[]): OffListCluster[] {
  const groups = new Map<string, ReviewChunk[]>();
  for (const c of chunks) if (c.clusterId) groups.set(c.clusterId, [...(groups.get(c.clusterId) ?? []), c]);
  return [...groups.entries()]
    .map(([id, members]) => ({
      id,
      chunkIds: members.map((m) => m.id).sort(),
      distinctVisitors: new Set(members.map((m) => m.messageId)).size,
      months: [...new Set(members.map((m) => m.month))].sort(),
      recurring: members.some((m) => m.clusterRecurring === true),
    }))
    .sort((a, b) => b.distinctVisitors - a.distinctVisitors || a.id.localeCompare(b.id));
}

/**
 * Groupes « sujet inconnu » d'un mois à partir des morceaux stockés : groupes écrits à la fermeture, plus le
 * regroupement des morceaux qui ont encore leur embedding (mois en cours, ou retardataires d'un mois fermé).
 */
export function monthClustersFromReview(
  month: string,
  chunks: readonly ReviewChunk[],
  config: Pick<AnalysisConfig, "offListClusterThreshold" | "offListMinVisitors" | "unknownTopicSources">,
): OffListCluster[] {
  const monthChunks = chunks.filter((c) => c.month === month);
  const stored = clustersFromStoredChunks(monthChunks);
  const live = clusterOffList(reviewChunkCandidates(monthChunks, config), config);
  return [...stored, ...live].sort((a, b) => b.distinctVisitors - a.distinctVisitors || a.id.localeCompare(b.id));
}
