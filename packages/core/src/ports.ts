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
  /** Produire aussi la traduction anglaise (task=translate), utilisée pour la liste « À faire lire ». */
  withEnglishTranslation?: boolean;
}

/** Transcrit un audio mono 16 kHz (Float32 dans [-1, 1]). */
export interface Transcriber {
  transcribe(audio16k: Float32Array, options?: TranscribeOptions): Promise<Transcript>;
}

/** Contexte injecté pour garder le cœur déterministe (identifiants, horloge). */
export interface Ctx {
  newId(): string;
  now(): string; // ISO 8601
}
