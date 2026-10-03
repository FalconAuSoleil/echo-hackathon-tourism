// Découpage en phrases puis en propositions (SPEC 4.3 étape 4).
// Phrases : . ! ? … ; et retours à la ligne (abréviations et nombres décimaux protégés).
// Propositions : connecteurs adversatifs (toujours) et coordinations « and / et / und / y » (seulement
// entre deux propositions assez longues, pour ne pas couper « le café et la ferme »).
import type { DetectedLang } from "./types.ts";
import { escapeRegExp } from "./text.ts";

export interface Segment {
  text: string;
  sentenceIndex: number;
  clauseIndex: number;
}

/** Conjonctions adversatives / concessives par langue : coupure systématique. */
export const CLAUSE_SPLITTERS: Record<string, string[]> = {
  en: ["but", "however", "although", "though", "even though", "whereas", "except that", "on the other hand", "unfortunately"],
  fr: ["mais", "cependant", "pourtant", "par contre", "en revanche", "toutefois", "sauf que", "bien que", "même si", "malheureusement", "néanmoins"],
  de: ["aber", "jedoch", "allerdings", "trotzdem", "sondern", "obwohl", "dagegen", "leider", "nur dass"],
  es: ["pero", "sin embargo", "aunque", "no obstante", "sino", "mientras que", "en cambio", "lamentablemente", "por desgracia"],
};

/** Coordinations : coupure seulement si chaque côté a au moins `COORD_MIN_WORDS` mots (ou après une virgule). */
export const COORDINATORS: Record<string, string[]> = {
  en: ["and", "and also", "as well as"],
  fr: ["et", "et aussi", "ainsi que"],
  de: ["und", "und auch", "sowie"],
  es: ["y", "e", "y también", "así como"],
};

/** Subordonnants en tête de phrase : « Although X, Y » → [X] [Y] (coupure à la première virgule). */
const LEADING_SUBORDINATORS: Record<string, string[]> = {
  en: ["although", "though", "even though", "even if", "while"],
  fr: ["bien que", "même si", "quoique"],
  de: ["obwohl", "auch wenn", "obgleich"],
  es: ["aunque", "si bien", "a pesar de que"],
};

const COORD_MIN_WORDS = 3;

const ABBREVIATIONS = [
  "mr", "mrs", "ms", "dr", "st", "etc", "e.g", "i.e", "vs", "approx", "mme", "mlle", "m", "env", "cf",
  "z.b", "bzw", "usw", "ca", "evtl", "u.a", "sr", "sra", "srta", "ud", "uds", "p.ej", "aprox", "no",
];

function connectorsFor(table: Record<string, string[]>, lang: DetectedLang): string[] {
  const list = table[lang];
  if (list) return list;
  return [...new Set(Object.values(table).flat())];
}

const L = "\\p{L}\\p{N}";
function alternation(terms: string[]): string {
  return [...terms].sort((a, b) => b.length - a.length).map((t) => escapeRegExp(t).replace(/\s+/g, "\\s+")).join("|");
}

/** Découpe un texte en phrases (sans les vides). */
export function splitSentences(text: string): string[] {
  const PROTECT = "\u0001"; // point protégé (décimales, abréviations)
  let t = text.replace(/\r\n?/g, "\n");
  t = t.replace(/(\d)\.(\d)/g, `$1${PROTECT}$2`); // 3.5 km : jamais une fin de phrase
  const abbr = new RegExp(`(?<![${L}])(${alternation(ABBREVIATIONS)})\\.(?=\\s+\\p{Ll}|\\s+\\d|\\s*\\p{L}\\.)`, "giu");
  t = t.replace(abbr, (m) => m.replace(/\./g, PROTECT));
  // Ponctuation forte, ou point-virgule, puis espace / fin ; retours à la ligne.
  const parts = t.split(/(?<=[.!?…;]+["»”)]*)\s+|\n+/u);
  return parts
    .map((p) => p.replaceAll(PROTECT, ".").trim())
    .filter((p) => /[\p{L}\p{N}]/u.test(p));
}

function wordCount(s: string): number {
  return (s.match(/[\p{L}\p{N}]+/gu) ?? []).length;
}

function cleanClause(s: string): string {
  return s.replace(/^[\s,;:–—\-]+|[\s,;:–—\-]+$/gu, "").trim();
}

/** Découpe une phrase en propositions. */
export function splitClauses(sentence: string, lang: DetectedLang): string[] {
  let pieces: string[] = [sentence];

  // Tirets et deux-points isolés : séparateurs de propositions.
  pieces = pieces.flatMap((p) => p.split(/\s[–—-]\s|\s:\s/u));

  // Subordonnant en tête : « Although the path was long, we loved it. »
  const lead = new RegExp(`^\\s*(?:${alternation(connectorsFor(LEADING_SUBORDINATORS, lang))})(?![${L}])([^,]+),(.+)$`, "iu");
  pieces = pieces.flatMap((p) => {
    const m = lead.exec(p);
    return m ? [m[1] ?? "", m[2] ?? ""] : [p];
  });

  // Adversatifs : coupure systématique, le connecteur est retiré.
  const adv = new RegExp(`(?<![${L}])(?:${alternation(connectorsFor(CLAUSE_SPLITTERS, lang))})(?![${L}])`, "iu");
  pieces = pieces.flatMap((p) => p.split(new RegExp(adv.source, "giu")));

  // Coordinations : seulement si les deux côtés sont des propositions assez longues.
  const coord = new RegExp(`(,?)\\s+(?:${alternation(connectorsFor(COORDINATORS, lang))})(?![${L}])`, "giu");
  pieces = pieces.flatMap((p) => splitOnCoordinators(p, coord));

  return pieces.map(cleanClause).filter((p) => /[\p{L}\p{N}]/u.test(p));
}

function splitOnCoordinators(text: string, coord: RegExp): string[] {
  const out: string[] = [];
  let start = 0;
  coord.lastIndex = 0;
  for (let m = coord.exec(text); m; m = coord.exec(text)) {
    const left = text.slice(start, m.index);
    const right = text.slice(m.index + m[0].length);
    const min = m[1] ? 2 : COORD_MIN_WORDS;
    // La partie droite est mesurée jusqu'au prochain coordinateur éventuel.
    const nextRight = right.split(new RegExp(coord.source, "iu"))[0] ?? right;
    if (wordCount(left) >= min && wordCount(nextRight) >= min) {
      out.push(left);
      start = m.index + m[0].length;
    }
  }
  out.push(text.slice(start));
  return out;
}

/** Phrases puis propositions, avec leurs index. */
export function segment(text: string, lang: DetectedLang): Segment[] {
  const out: Segment[] = [];
  splitSentences(text).forEach((sentence, sentenceIndex) => {
    splitClauses(sentence, lang).forEach((clause, clauseIndex) => {
      out.push({ text: clause, sentenceIndex, clauseIndex });
    });
  });
  return out;
}
