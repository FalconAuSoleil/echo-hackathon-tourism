// Méthode de comparaison sans IA (SPEC 9) : mots-clés par constat et par langue.
import type { Catalog } from "./catalog.ts";
import type { DetectedLang, FindingId } from "./types.ts";
import { notImplemented } from "./not-implemented.ts";

/** Constats dont un mot-clé apparaît dans le morceau (sans gestion de la négation : c'est la référence naïve). */
export function keywordClassify(chunk: string, lang: DetectedLang, catalog: Catalog): FindingId[] {
  void chunk; void lang; void catalog;
  return notImplemented("keywordClassify");
}
