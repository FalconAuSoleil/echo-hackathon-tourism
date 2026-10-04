// Parcours d'un message vocal : mesures → éventuel
// « inaudible » sans transcription → Transcriber → effacement du tampon audio → analyzeMessage.
import type { Transcriber } from "./ports.ts";
import type { MessageAnalysis, MessageInput, Transcript } from "./types.ts";
import { analyzeMessage, type AnalyzeDeps } from "./analyze.ts";
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
  /** Produire la traduction anglaise pour la liste « À faire lire » (avant l'effacement de l'audio). */
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
      transcript = await deps.transcriber.transcribe(input.audio16k, {
        withEnglishTranslation: deps.withEnglishTranslation ?? true,
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
 * Message vocal complet. L'audio n'est jamais conservé : le tampon est mis à zéro dès la fin de la
 * transcription (l'app supprime aussi le fichier de sa file d'attente). Un audio inaudible n'est pas transcrit.
 */
export async function analyzeAudioMessage(input: AudioMessageInput, deps: AudioMessageDeps): Promise<MessageAnalysis> {
  return analyzeMessage(await transcribeAudioMessage(input, deps), deps);
}
