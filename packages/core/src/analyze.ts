// Parcours complet d'un message (SPEC 4.3) : inaudible ? → nettoyage des données personnelles →
// doublon ? → langue/confiance → découpage → négation → similarité → statuts.
// Le transcript est produit en amont par le port Transcriber (voir audio.ts pour le parcours vocal complet).
import type { Catalog } from "./catalog.ts";
import type { AnalysisConfig } from "./config.ts";
import type { Matcher } from "./matcher.ts";
import type { ChunkResult, DetectedLang, FindingId, FindingScore, MessageAnalysis, MessageInput } from "./types.ts";
import { audioInaudibleReason } from "./audio-stats.ts";
import { checkDuplicate, fingerprint, type KnownMessage } from "./duplicates.ts";
import { detectTextLanguage } from "./language.ts";
import { detectNegation } from "./negation.ts";
import { scrubPii } from "./pii.ts";
import { segment } from "./segment.ts";
import { fold, wordListRegExp } from "./text.ts";

export interface AnalyzeDeps {
  catalog: Catalog;
  matcher: Matcher;
  config: AnalysisConfig;
  /** Empreintes déjà vues (doublons exacts). */
  knownFingerprints?: ReadonlySet<string>;
  /** Messages déjà stockés (empreinte, date, embedding) : doublons exacts et quasi-doublons. */
  knownMessages?: readonly KnownMessage[];
}

/** Mots qui désignent le guide, par langue (morceaux visibles par l'hôte uniquement). */
export const GUIDE_WORDS: Record<string, string[]> = {
  en: ["guide", "guides", "tour guide", "translator", "interpreter", "guiding"],
  fr: ["guide", "guides", "guider", "traducteur", "traductrice", "interprète", "accompagnateur", "accompagnatrice"],
  de: ["führer", "fuhrer", "fremdenführer", "reiseführer", "reiseleiter", "reiseleiterin", "guide", "guides", "übersetzer", "übersetzerin", "dolmetscher", "dolmetscherin"],
  es: ["guía", "guia", "guías", "guias", "traductor", "traductora", "intérprete", "acompañante"],
};

/** Le morceau parle-t-il du guide ? (toutes langues si la langue est inconnue) */
export function mentionsGuide(text: string, lang: DetectedLang): boolean {
  const list = GUIDE_WORDS[lang] ? [...GUIDE_WORDS[lang]!, ...GUIDE_WORDS.en!] : Object.values(GUIDE_WORDS).flat();
  const re = wordListRegExp([...new Set(list.map(fold))]);
  return re ? re.test(fold(text)) : false;
}

/**
 * Transcriptions fantômes de Whisper sur du silence ou du bruit (génériques de sous-titres, balises de
 * musique) : le message est « inaudible », jamais analysé.
 */
const WHISPER_PHANTOMS = [
  /amara\.org/i,
  /untertitel (der|im auftrag|von)/i,
  /sous-titr(es|age) (réalisés|par|fait)/i,
  /subt[ií]tulos (realizados|por)/i,
  /thanks? for watching/i,
  /^\W*(\[[^\]]*\]|\([^)]*\)|♪|\s|\.)*\W*$/u, // seulement des balises [Music], (applause), ♪ ou de la ponctuation
];

export function isPhantomTranscript(text: string): boolean {
  const t = text.trim();
  if (!/[\p{L}\p{N}]/u.test(t)) return true;
  return WHISPER_PHANTOMS.some((re) => re.test(t));
}

function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

/** Union des constats des morceaux : chaque constat une fois par message, avec sa meilleure confiance. */
function unionFindings(chunks: readonly ChunkResult[], filter: (c: ChunkResult) => boolean = () => true): FindingScore[] {
  const best = new Map<FindingId, number>();
  for (const c of chunks) {
    if (c.status !== "matched" || !filter(c)) continue;
    for (const f of c.findings) best.set(f.id, Math.max(best.get(f.id) ?? -Infinity, f.score));
  }
  return [...best.entries()].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score);
}

export async function analyzeMessage(input: MessageInput, deps: AnalyzeDeps): Promise<MessageAnalysis> {
  const { config, matcher } = deps;
  const month = monthOf(input.receivedAt);
  const t = input.transcript;
  const rawText = (input.source === "audio" ? t?.text : input.text) ?? "";

  const base = {
    id: input.id,
    receivedAt: input.receivedAt,
    month,
    source: input.source,
    englishTranslation: t?.englishTranslation,
    transcriptConfidence: t?.confidence,
  };
  const empty = (lang: DetectedLang, status: MessageAnalysis["status"], reason: string, scrubbedText = "", fp = ""): MessageAnalysis => ({
    ...base,
    lang,
    status,
    reason,
    scrubbedText,
    chunks: [],
    findings: [],
    coopFindings: [],
    fingerprint: fp,
    notSureCount: 0,
    offListCount: 0,
  });

  // 1. Inaudible : jamais compté, aucune devinette (SPEC 7).
  if (input.source === "audio") {
    const stats = input.audioStats ?? (t ? { durationSec: t.durationSec, rms: Infinity } : undefined);
    const audioReason = stats ? audioInaudibleReason(stats, config) : null;
    if (audioReason) return empty(t?.language ?? "unknown", "inaudible", audioReason);
    if (!t) return empty("unknown", "inaudible", "no_transcript");
    if (t.durationSec < config.minAudioSeconds) return empty(t.language, "inaudible", "too_short");
    if (isPhantomTranscript(t.text)) return empty(t.language, "inaudible", "empty_transcript");
    if (t.confidence < config.inaudibleConfidence) return empty(t.language, "inaudible", "too_noisy");
  } else if (!/[\p{L}\p{N}]/u.test(rawText)) {
    return empty(input.declaredLang ?? "unknown", "inaudible", "empty_text");
  }

  // 2. Langue (Whisper pour l'audio, déclarée ou devinée pour l'écrit).
  let lang: DetectedLang;
  let languageProbability: number | undefined;
  if (input.source === "audio") {
    lang = t!.language;
    languageProbability = t!.languageProbability;
  } else if (input.declaredLang) {
    lang = input.declaredLang;
  } else {
    const guess = detectTextLanguage(rawText, config.minLanguageProbability);
    lang = guess.lang;
    languageProbability = guess.probability;
  }

  // 3. Données personnelles retirées avant tout le reste (rien de brut ne sort de cette fonction).
  const scrubbedText = scrubPii(rawText, lang).text;
  const englishTranslation = t?.englishTranslation ? scrubPii(t.englishTranslation, "en").text : undefined;
  base.englishTranslation = englishTranslation;
  const fp = fingerprint(scrubbedText);

  // 4. Doublon exact (empreinte), puis quasi-doublon (embedding du message entier).
  const known: KnownMessage[] = [...(deps.knownMessages ?? []), ...[...(deps.knownFingerprints ?? [])].map((f) => ({ fingerprint: f }))];
  if (checkDuplicate({ fingerprint: fp, receivedAt: input.receivedAt }, known, config).duplicate) {
    return empty(lang, "duplicate", "duplicate_fingerprint", scrubbedText, fp);
  }
  const [messageEmbedding] = await matcher.embed([scrubbedText]);
  if (messageEmbedding && checkDuplicate({ fingerprint: fp, receivedAt: input.receivedAt, embedding: messageEmbedding }, known, config).duplicate) {
    return { ...empty(lang, "duplicate", "duplicate_embedding", scrubbedText, fp), messageEmbedding };
  }

  // 5. Message entier peu fiable : langue non prise en charge ou mal reconnue, transcription peu sûre.
  let wholeReason: string | undefined;
  if (!config.supportedLangs.includes(lang)) wholeReason = "unsupported_language";
  else if (languageProbability !== undefined && languageProbability < config.minLanguageProbability) wholeReason = "low_language_probability";
  else if (t && t.confidence < config.minTranscriptConfidence) wholeReason = "message_low_confidence";

  // 6. Découpage, négation, guide, similarité.
  const segs = segment(scrubbedText, lang);
  const negations = segs.map((s) => detectNegation(s.text, lang));
  const matches = await matcher.match(
    segs.map((s, i) => ({ text: s.text, negation: negations[i]! })),
    lang,
  );
  const chunks: ChunkResult[] = segs.map((s, i) => {
    const m = matches[i]!;
    const forced = wholeReason !== undefined;
    return {
      id: `${input.id}:${i}`,
      text: s.text,
      sentenceIndex: s.sentenceIndex,
      clauseIndex: s.clauseIndex,
      status: forced ? "not_sure" : m.status,
      findings: forced ? [] : m.findings,
      topScores: m.topScores,
      negation: negations[i]!,
      mentionsGuide: mentionsGuide(s.text, lang),
      reason: forced ? wholeReason : m.reason,
      embedding: m.embedding,
    };
  });

  const findings = unionFindings(chunks);
  const coopFindings = unionFindings(chunks, (c) => !c.mentionsGuide).map((f) => f.id);
  return {
    ...base,
    lang,
    status: wholeReason ? "not_sure" : "analyzed",
    reason: wholeReason,
    scrubbedText,
    chunks,
    findings,
    coopFindings,
    fingerprint: fp,
    notSureCount: chunks.filter((c) => c.status === "not_sure").length,
    offListCount: chunks.filter((c) => c.status === "off_list").length,
    messageEmbedding,
  };
}
