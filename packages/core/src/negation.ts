// Détection de négation par langue (SPEC 7) : « le chemin n'était pas trop long » ne déclenche pas N1.
import type { DetectedLang, NegationInfo } from "./types.ts";
import { notImplemented } from "./not-implemented.ts";

export function detectNegation(chunk: string, lang: DetectedLang): NegationInfo {
  void chunk; void lang;
  return notImplemented("detectNegation");
}
