// Colle entre le stockage / la démo et @echo/core : récap mensuel, sujets inconnus qui reviennent, SMS.
// Aucune règle métier ici : tout vient du cœur partagé avec l'évaluation.
import {
  buildMonthlyRecap,
  clusterOffList,
  recapRwLines,
  recurringUnknownVisitors,
  splitSms,
  unknownTopicItems,
  type AnalysisConfig,
  type Catalog,
  type MessageAnalysis,
  type MonthMessage,
  type OffListCluster,
  type OffListItem,
  type Recap,
  type ReviewChunk,
  type StoredMessage,
} from "@echo/core";

export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

export function currentMonth(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function toMonthMessage(m: Pick<StoredMessage, "id" | "month" | "status" | "findings" | "notSureCount">): MonthMessage {
  return { id: m.id, month: m.month, status: m.status, findings: m.findings.map((f) => f.id), notSureCount: m.notSureCount };
}

export function analysisToMonthMessage(a: MessageAnalysis): MonthMessage {
  return { id: a.id, month: a.month, status: a.status, findings: a.findings.map((f) => f.id), notSureCount: a.notSureCount };
}

/**
 * Morceaux candidats au signal « sujet inconnu » à partir des morceaux stockés (liste « À faire lire ») :
 * même règle que `unknownTopicItems` du cœur (hors liste, plus « pas sûr » sous le seuil si la config le dit ;
 * jamais ceux mis en « pas sûr » par une négation ou un message entier peu fiable).
 */
export function reviewChunksToItems(chunks: readonly ReviewChunk[], config: Pick<AnalysisConfig, "unknownTopicSources">): OffListItem[] {
  return chunks
    .filter((c) => c.embedding && (c.status === "off_list" || (config.unknownTopicSources === "off_list_and_unsure" && c.status === "not_sure" && c.reason === "below_threshold")))
    .map((c) => ({ chunkId: c.id, visitorKey: c.messageId, month: c.month, text: c.text, embedding: c.embedding! }));
}

export interface MonthReport {
  recap: Recap;
  clusters: OffListCluster[];
  recurring: OffListCluster[];
  sms: string[];
}

/** Récap d'un mois : messages de tous les mois (pour les séries), morceaux candidats du mois seulement. */
export function monthReport(
  month: string,
  messages: readonly MonthMessage[],
  items: readonly OffListItem[],
  catalog: Catalog,
  config: AnalysisConfig,
): MonthReport {
  const clusters = clusterOffList(items.filter((i) => i.month === month), config);
  const recurring = clusters.filter((c) => c.recurring);
  const recap = buildMonthlyRecap({ month, messages: [...messages], recurringUnknownVisitors: recurringUnknownVisitors(clusters) }, catalog);
  return { recap, clusters, recurring, sms: smsParts(recap) };
}

/** Le récap en SMS GSM-7 (un ou plusieurs SMS de 160 caractères, numérotés s'il y en a plusieurs). */
export function smsParts(recap: Recap): string[] {
  return splitSms(recapRwLines(recap), 160, { numbered: true });
}

/** Rapport de la démo : analyses de la session + historique synthétique. */
export function demoReport(
  month: string,
  session: readonly MessageAnalysis[],
  history: readonly MonthMessage[],
  catalog: Catalog,
  config: AnalysisConfig,
): MonthReport {
  const items = unknownTopicItems(session, config.unknownTopicSources);
  return monthReport(month, [...history, ...session.map(analysisToMonthMessage)], items, catalog, config);
}
