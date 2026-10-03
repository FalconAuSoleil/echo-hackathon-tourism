// Parcours d'un message vocal : mesures → éventuel
// « inaudible » sans transcription → Transcriber → effacement du tampon audio → analyzeMessage.
import type { Transcriber } from "./ports.ts";
import type { MessageAnalysis, Transcript } from "./types.ts";
import { analyzeMessage, type AnalyzeDeps } from "./analyze.ts";
import { audioInaudibleReason, computeAudioStats } from "./audio-stats.ts";

export interface AudioMessageInput {
  id: string;
  receivedAt: string;
  /** Audio mono 16 kHz. Remis à zéro après transcription, sauf si wipeAudio = false. */
  audio16k: Float32Array;
}

export interface AudioMessageDeps extends AnalyzeDeps {
  transcriber: Transcriber;
  /** Produire la traduction anglaise pour la liste « À faire lire » (avant l'effacement de l'audio). */
  withEnglishTranslation?: boolean;
  /** Remettre le tampon audio à zéro après transcription (défaut : true). */
  wipeAudio?: boolean;
}

/**
 * Message vocal complet. L'audio n'est jamais conservé : le tampon est mis à zéro dès la fin de la
 * transcription (l'app supprime aussi le fichier de sa file d'attente). Un audio inaudible n'est pas transcrit.
 */
export async function analyzeAudioMessage(input: AudioMessageInput, deps: AudioMessageDeps): Promise<MessageAnalysis> {
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
  return analyzeMessage(
    {
      id: input.id,
      receivedAt: input.receivedAt,
      source: "audio",
      transcript,
      audioStats: { durationSec: stats.durationSec, rms: stats.rms, dynamicRangeDb: stats.dynamicRangeDb },
    },
    deps,
  );
}
