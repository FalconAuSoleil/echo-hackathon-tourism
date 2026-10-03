// Retrait des noms propres, numéros de téléphone et e-mails AVANT tout stockage (SPEC 4.3 étape 3).
import type { DetectedLang } from "./types.ts";
import { notImplemented } from "./not-implemented.ts";

export interface ScrubResult {
  text: string;
  removed: { names: number; phones: number; emails: number };
}

/** Remplace par des jetons neutres : [nom], [numéro], [e-mail]. */
export function scrubPii(text: string, lang: DetectedLang): ScrubResult {
  void text; void lang;
  return notImplemented("scrubPii");
}
