// Parcours d'un message vocal : mesures → éventuel « inaudible » sans transcription → Transcriber (texte +
// segments horodatés) → analyzeMessage → anglais des seuls segments à relire → effacement du tampon audio.
import type { Transcriber } from "./ports.ts";
import type { MessageAnalysis, MessageInput, Transcript, TranscriptSegment } from "./types.ts";
import { analyzeMessage, segmentsNeedingEnglish, withSegmentEnglish, type AnalyzeDeps } from "./analyze.ts";
import { audioInaudibleReason, computeAudioStats } from "./audio-stats.ts";

export interface AudioMessageInput {
  id: string;
  receivedAt: string;
  /** Audio mono 16 kHz. Remis à zéro après transcription, sauf si wipeAudio = false. */
  audio16k: Float32Array;
}

export interface TranscribeDeps {
  transcriber: Transcriber;
  config: AnalyzeDeps["config"];
  /**
   * Produire l'anglais des morceaux à relire (liste « À faire lire »). Avec un Transcriber qui sait traduire des
   * segments : segments horodatés à la transcription, puis traduction des seuls segments à relire après l'analyse
   * (`analyzeAudioMessage`, ou l'app en trois étapes). Sinon : traduction de chaque fenêtre entière. Défaut : true.
   */
  withEnglishTranslation?: boolean;
  /** Remettre le tampon audio à zéro après transcription (défaut : true). */
  wipeAudio?: boolean;
}

export type AudioMessageDeps = AnalyzeDeps & TranscribeDeps;

/**
 * Première moitié d'un message vocal : mesures, éventuel « inaudible » sans transcription, transcription, puis
 * tampon audio remis à zéro. Renvoie l'entrée prête pour analyzeMessage (aucun modèle de similarité requis).
 * Séparée pour que l'app puisse transcrire toute sa file avec Whisper, libérer Whisper, puis seulement charger
 * le modèle de similarité (un seul modèle en mémoire sur un téléphone de 2 Go).
 */
export async function transcribeAudioMessage(input: AudioMessageInput, deps: TranscribeDeps): Promise<MessageInput> {
  const stats = computeAudioStats(input.audio16k);
  const early = audioInaudibleReason(stats, deps.config);
  let transcript: Transcript | undefined;
  try {
    if (!early) {
      const english = deps.withEnglishTranslation ?? true;
      const bySegment = english && !!deps.transcriber.translateSegments;
      transcript = await deps.transcriber.transcribe(input.audio16k, {
        withEnglishTranslation: english && !bySegment,
        withSegments: bySegment,
      });
    }
  } finally {
    if (deps.wipeAudio !== false) input.audio16k.fill(0);
  }
  return {
    id: input.id,
    receivedAt: input.receivedAt,
    source: "audio",
    ...(transcript ? { transcript } : {}),
    audioStats: { durationSec: stats.durationSec, rms: stats.rms, dynamicRangeDb: stats.dynamicRangeDb },
  };
}

/**
 * Troisième étape d'un message vocal : traduit en anglais les seuls segments qui contiennent un morceau à relire
 * et aucun morceau compté (`segmentsNeedingEnglish`), puis rattache ces traductions aux morceaux. L'audio doit être
 * encore en mémoire ; l'appelant le remet à zéro ensuite. Sans segment à traduire, aucun calcul.
 */
export async function translateReviewSegments(
  a: MessageAnalysis,
  segments: readonly TranscriptSegment[] | undefined,
  audio16k: Float32Array,
  transcriber: Transcriber,
): Promise<MessageAnalysis> {
  if (!segments?.length || !transcriber.translateSegments) return a;
  const need = segmentsNeedingEnglish(a, segments);
  if (need.length === 0) return a;
  const english = await transcriber.translateSegments(audio16k, need.map((k) => segments[k]!), a.lang);
  const withEnglish = segments.map((sg, k) => (need.includes(k) ? { ...sg, english: english[need.indexOf(k)] ?? "" } : sg));
  return withSegmentEnglish(a, withEnglish);
}

/**
 * Message vocal complet : transcription, analyse, puis anglais des seuls segments à relire. L'audio n'est jamais
 * conservé : le tampon est mis à zéro dès la fin (l'app supprime aussi le fichier de sa file d'attente). Un audio
 * inaudible n'est pas transcrit.
 */
export async function analyzeAudioMessage(input: AudioMessageInput, deps: AudioMessageDeps): Promise<MessageAnalysis> {
  try {
    const transcribed = await transcribeAudioMessage(input, { ...deps, wipeAudio: false });
    const a = await analyzeMessage(transcribed, deps);
    return await translateReviewSegments(a, transcribed.transcript?.segments, input.audio16k, deps.transcriber);
  } finally {
    if (deps.wipeAudio !== false) input.audio16k.fill(0);
  }
}
