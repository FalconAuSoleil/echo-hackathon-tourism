// Ce qui a le droit d'être stocké (SPEC 6), calculé à partir d'une analyse. L'app ne persiste QUE ces
// deux formes : jamais l'audio, jamais le texte complet, jamais de nom ni de numéro.
import type { FindingId, MessageAnalysis, MessageSource, MessageStatus, DetectedLang } from "./types.ts";

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
  /** Empreinte non réversible du texte nettoyé (doublons). */
  fingerprint: string;
  /** Embedding du message nettoyé (quasi-doublons). Donnée technique dérivée, documentée dans le README. */
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
  /** Traduction anglaise Whisper du message, nettoyée : « traduction automatique, à vérifier ». */
  englishMT?: string;
  /** Parle du guide : visible par l'hôte uniquement, jamais dans la vue coopérative ni un export. */
  mentionsGuide: boolean;
  reason?: string;
  embedding?: Float32Array;
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

export function toReviewChunks(a: MessageAnalysis, options: { synthetic?: boolean } = {}): ReviewChunk[] {
  if (a.status === "duplicate" || a.status === "inaudible") return [];
  return a.chunks
    .filter((c): c is typeof c & { status: "not_sure" | "off_list" } => c.status === "not_sure" || c.status === "off_list")
    .map((c) => ({
      id: c.id,
      messageId: a.id,
      month: a.month,
      status: c.status,
      text: c.text,
      ...(a.englishTranslation ? { englishMT: a.englishTranslation } : {}),
      mentionsGuide: c.mentionsGuide,
      ...(c.reason ? { reason: c.reason } : {}),
      ...(c.embedding ? { embedding: c.embedding } : {}),
      ...(options.synthetic ? { synthetic: true } : {}),
    }));
}
