// Découpage en phrases puis en propositions (SPEC 4.3 étape 4).
import type { DetectedLang } from "./types.ts";
import { notImplemented } from "./not-implemented.ts";

export interface Segment {
  text: string;
  sentenceIndex: number;
  clauseIndex: number;
}

/** Conjonctions adversatives par langue (mais, but, aber, pero, sin embargo, however, ...). */
export const CLAUSE_SPLITTERS: Record<string, string[]> = {
  en: ["but", "however", "although", "though", "yet"],
  fr: ["mais", "cependant", "pourtant", "par contre", "en revanche", "toutefois"],
  de: ["aber", "jedoch", "allerdings", "trotzdem", "sondern"],
  es: ["pero", "sin embargo", "aunque", "no obstante"],
};

export function segment(text: string, lang: DetectedLang): Segment[] {
  void text; void lang;
  return notImplemented("segment");
}
