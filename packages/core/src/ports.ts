// Ports : le cœur ne connaît aucun runtime de modèle. L'app (Web Worker, transformers.js navigateur)
// et l'évaluation (transformers.js Node) fournissent les implémentations ; les tests fournissent des faux.

import type { Transcript } from "./types.ts";

/**
 * Plonge des phrases dans l'espace du modèle de similarité.
 * Contrat : un vecteur par texte, même ordre, normalisé L2 (le produit scalaire = cosinus).
 * Pour multilingual-e5, l'adaptateur ajoute lui-même le préfixe "query: ".
 */
export type EmbedFn = (texts: string[]) => Promise<Float32Array[]>;

export interface TranscribeOptions {
  /** Forcer une langue (sinon détection automatique). */
  language?: string;
  /** Produire aussi la traduction anglaise de chaque fenêtre entière (task=translate). */
  withEnglishTranslation?: boolean;
  /**
   * Produire aussi les segments horodatés (passe Whisper de plus, sans changer le texte), pour traduire ensuite
   * seulement les segments à relire (`translateSegments`). Ignoré si la langue détectée est l'anglais.
   */
  withSegments?: boolean;
}

/** Transcrit un audio mono 16 kHz (Float32 dans [-1, 1]). */
export interface Transcriber {
  transcribe(audio16k: Float32Array, options?: TranscribeOptions): Promise<Transcript>;
  /**
   * Traduit en anglais chaque segment [start, end] (secondes) SEUL, découpé dans l'audio : la traduction d'un
   * segment ne contient que lui. Une chaîne par segment, même ordre.
   */
  translateSegments?(audio16k: Float32Array, segments: readonly { start: number; end: number }[], language: string): Promise<string[]>;
}

/** Contexte injecté pour garder le cœur déterministe (identifiants, horloge). */
export interface Ctx {
  newId(): string;
  now(): string; // ISO 8601
}
