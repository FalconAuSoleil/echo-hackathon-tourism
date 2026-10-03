// Parcours complet d'un message (SPEC 4.3) : inaudible ? → langue/confiance → nettoyage → découpage
// → négation → similarité → statuts. Le transcript est produit en amont par le port Transcriber.
import type { Catalog } from "./catalog.ts";
import type { AnalysisConfig } from "./config.ts";
import type { Matcher } from "./matcher.ts";
import type { MessageAnalysis, MessageInput } from "./types.ts";
import { notImplemented } from "./not-implemented.ts";

export interface AnalyzeDeps {
  catalog: Catalog;
  matcher: Matcher;
  config: AnalysisConfig;
  /** Empreintes déjà vues (doublons). */
  knownFingerprints?: ReadonlySet<string>;
}

export async function analyzeMessage(input: MessageInput, deps: AnalyzeDeps): Promise<MessageAnalysis> {
  void input; void deps;
  return notImplemented("analyzeMessage");
}

/** Mots qui désignent le guide, par langue (morceaux visibles par l'hôte uniquement). */
export const GUIDE_WORDS: Record<string, string[]> = {
  en: ["guide", "translator", "interpreter"],
  fr: ["guide", "traducteur", "traductrice", "interprète"],
  de: ["führer", "fuhrer", "reiseleiter", "guide", "übersetzer", "dolmetscher"],
  es: ["guía", "guia", "traductor", "traductora", "intérprete"],
};
