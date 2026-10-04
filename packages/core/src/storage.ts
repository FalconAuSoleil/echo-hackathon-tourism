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
   * Traduction anglaise Whisper du message, nettoyée : « traduction automatique, à vérifier ».
   * Gardée seulement quand TOUT le message est à relire (aucun morceau compté) : sinon elle contiendrait
   * aussi les morceaux comptés, qui ne doivent pas être stockés en texte (SPEC 6).
   */
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

/** Tous les morceaux du message sont-ils « pas sûr » ou « hors liste » ? (le message entier est à relire) */
export function wholeMessageUnderReview(a: MessageAnalysis): boolean {
  return a.chunks.length > 0 && a.chunks.every((c) => c.status === "not_sure" || c.status === "off_list");
}

export function toReviewChunks(a: MessageAnalysis, options: { synthetic?: boolean } = {}): ReviewChunk[] {
  if (a.status === "duplicate" || a.status === "inaudible") return [];
  const keepMT = !!a.englishTranslation && wholeMessageUnderReview(a);
  return a.chunks
    .filter((c): c is typeof c & { status: "not_sure" | "off_list" } => c.status === "not_sure" || c.status === "off_list")
    .map((c) => ({
      id: c.id,
      messageId: a.id,
      month: a.month,
      status: c.status,
      text: c.text,
      ...(keepMT ? { englishMT: a.englishTranslation } : {}),
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
 * Fiche sans son embedding si la fenêtre des doublons est passée : il ne sert plus à rien et pourrait être
 * en partie inversé vers le texte. Renvoie `null` si la fiche n'a rien à changer.
 */
export function expireMessageEmbedding(m: StoredMessage, now: Date, duplicateWindowDays: number): StoredMessage | null {
  if (!m.embedding || !messageEmbeddingExpired(m.receivedAt, now, duplicateWindowDays)) return null;
  const { embedding: _dropped, ...rest } = m;
  return rest;
}
