// Types partagés par toute l'analyse. Aucun import de runtime de modèle ici.

/** Langues visiteur prises en charge (SPEC 5). Le swahili est un bonus (SPEC 12, P4). */
export type VisitorLang = "en" | "fr" | "de" | "es";
export const VISITOR_LANGS: readonly VisitorLang[] = ["en", "fr", "de", "es"] as const;

/** Langue détectée par Whisper : code ISO 639-1, ou "unknown". */
export type DetectedLang = VisitorLang | "sw" | (string & {}) | "unknown";

export type PositiveFindingId = "P1" | "P2" | "P3" | "P4" | "P5" | "P6" | "P7" | "P8" | "P9" | "P10" | "P11";
export type NegativeFindingId = "N1" | "N2" | "N3" | "N4" | "N5" | "N6" | "N7" | "N8" | "N9" | "N10";
export type FindingId = PositiveFindingId | NegativeFindingId;
export type Polarity = "positive" | "negative";

/** Statut d'un morceau (proposition) après classement. */
export type ChunkStatus =
  | "matched" // rattaché à 1 ou 2 constats au-dessus du seuil calibré
  | "not_sure" // sous le seuil d'acceptation, négation douteuse, ou message entier peu fiable
  | "off_list"; // ne ressemble à aucun constat (sous le seuil « hors liste »)

/** Statut d'un message entier. */
export type MessageStatus =
  | "analyzed" // au moins un morceau traité normalement
  | "not_sure" // langue mal reconnue ou confiance de transcription faible : tout le message est « pas sûr »
  | "inaudible" // silence, < 3 s, trop bruité, transcription vide : jamais compté
  | "duplicate"; // même message déjà reçu : compté une seule fois

export interface FindingScore {
  id: FindingId;
  /** Similarité cosinus maximale entre le morceau et les exemples du constat, dans [-1, 1]. */
  score: number;
}

export interface NegationInfo {
  negated: boolean;
  /** Négation présente mais portée incertaine : le morceau doit passer en « pas sûr ». */
  uncertain: boolean;
  /** Marqueurs repérés (pour l'affichage et le débogage). */
  cues: string[];
}

export interface ChunkResult {
  /** Texte du morceau, déjà nettoyé des noms, numéros et e-mails. */
  text: string;
  /** Index de la phrase d'origine et de la proposition dans la phrase. */
  sentenceIndex: number;
  clauseIndex: number;
  status: ChunkStatus;
  /** 0, 1 ou 2 constats (au plus 2 par morceau). Vide sauf si status = "matched". */
  findings: FindingScore[];
  /** Les meilleurs scores bruts (top 3), même sous le seuil, pour l'affichage et l'évaluation. */
  topScores: FindingScore[];
  negation: NegationInfo;
  /** Le morceau parle du guide : visible par l'hôte uniquement, jamais dans la vue coopérative. */
  mentionsGuide: boolean;
  /** Raison lisible du statut (ex. "below_threshold", "negation_uncertain", "message_low_confidence"). */
  reason?: string;
  /** Identifiant stable du morceau : `${messageId}:${index}`. */
  id: string;
  /** Embedding du morceau (regroupement hors liste). Absent si le message n'a pas été analysé. */
  embedding?: Float32Array;
  /**
   * Traduction anglaise Whisper du ou des segments audio qui contiennent ce morceau, nettoyée. Seulement pour un
   * morceau « pas sûr » / « hors liste » dont les segments ne contiennent AUCUN morceau compté (sinon elle
   * garderait en texte une proposition comptée, SPEC 6). Absente pour un message écrit (aucune traduction).
   */
  englishMT?: string;
}

/** Segment horodaté d'une transcription Whisper (secondes depuis le début de l'audio). */
export interface TranscriptSegment {
  start: number;
  end: number;
  /**
   * Texte du segment (brut, nettoyé plus tard par analyzeMessage). Vient de la passe horodatée : peut différer
   * un peu de `Transcript.text` ; sert seulement à situer les morceaux dans les segments (alignement des mots).
   */
  text: string;
  /**
   * Traduction anglaise de CE segment seul (Whisper task=translate sur la fenêtre du segment), faite avant
   * l'effacement de l'audio. Brute : nettoyée des données personnelles par analyzeMessage.
   */
  english?: string;
}

export interface Transcript {
  text: string;
  language: DetectedLang;
  /** Probabilité de la langue détectée, dans [0, 1], si disponible. */
  languageProbability?: number;
  /** Confiance de transcription dans [0, 1] (ex. exp(moyenne des log-probas des tokens)). */
  confidence: number;
  durationSec: number;
  /** Traduction anglaise par Whisper (task=translate), marquée « traduction automatique, à vérifier ». */
  englishTranslation?: string;
  /** Segments horodatés, dans l'ordre, avec leur traduction : seulement si la traduction anglaise est demandée. */
  segments?: TranscriptSegment[];
}

export type MessageSource = "audio" | "text";

export interface MessageInput {
  /** Identifiant fourni par l'appelant (Ctx), pour garder le cœur déterministe. */
  id: string;
  receivedAt: string; // ISO 8601
  source: MessageSource;
  /** Pour "text" : le texte brut. Pour "audio" : le transcript produit par le port Transcriber. */
  text?: string;
  transcript?: Transcript;
  /** Langue déclarée ou détectée pour un message écrit (détection simple, ou choix de l'utilisateur). */
  declaredLang?: DetectedLang;
  /** Mesures audio simples calculées avant transcription (durée, énergie) pour le cas « inaudible ». */
  audioStats?: { durationSec: number; rms: number; dynamicRangeDb?: number };
}

export interface MessageAnalysis {
  id: string;
  receivedAt: string;
  month: string; // "YYYY-MM"
  source: MessageSource;
  lang: DetectedLang;
  status: MessageStatus;
  /** Texte complet nettoyé (affiché dans la démo ; seuls les morceaux pas sûr / hors liste sont stockés). */
  scrubbedText: string;
  chunks: ChunkResult[];
  /** Constats retenus pour le message (union des morceaux, chaque constat compté une fois par message). */
  findings: FindingScore[];
  /** Empreinte pour la détection des doublons (hachage du texte normalisé, pas le texte). */
  fingerprint: string;
  englishTranslation?: string;
  transcriptConfidence?: number;
  /**
   * Constats appuyés par au moins un morceau qui ne parle PAS du guide : seuls ceux-là peuvent sortir
   * vers la vue coopérative ou un export (SPEC 4.7).
   */
  coopFindings: FindingId[];
  /** Nombre de morceaux « pas sûr » et « hors liste » (le récap affiche p = somme des « pas sûr »). */
  notSureCount: number;
  offListCount: number;
  /** Raison du statut du message (ex. "too_short", "silence", "unsupported_language", "duplicate_fingerprint"). */
  reason?: string;
  /** Embedding du texte nettoyé entier : détection des quasi-doublons. Absent si inaudible ou doublon exact. */
  messageEmbedding?: Float32Array;
}
