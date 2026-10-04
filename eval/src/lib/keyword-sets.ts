// Jeux de mots-clés de la référence sans IA (SPEC 9). Deux jeux, toujours rapportés tous les deux au niveau 2 :
//   original : eval/keywords/       écrits par l'auteur du corpus synthétique (favorise la référence)
//   blind    : eval/keywords-blind/ écrits sans voir le corpus ni les résultats (protocole : son README)
// Le jeu « principal » (champ `keywords` des résultats, colonne du titre de RESULTS.md et du README) se choisit avec
// `pnpm eval -- --keywords original|blind` ou la variable ECHO_KEYWORDS ; défaut : blind depuis le 2026-10-04
// (les listes originales peuvent reprendre la formulation du corpus ; elles restent rapportées à côté).
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { keywordListsFromFiles, type KeywordFile, type KeywordLists } from "@echo/core";
import { readJson } from "./io.ts";
import { ROOT } from "./paths.ts";

export const KEYWORD_SETS = {
  original: join(ROOT, "eval", "keywords"),
  blind: join(ROOT, "eval", "keywords-blind"),
} as const;
export type KeywordSetName = keyof typeof KEYWORD_SETS;
export const KEYWORD_SET_NAMES = Object.keys(KEYWORD_SETS) as KeywordSetName[];

export function isKeywordSetName(x: string): x is KeywordSetName {
  return Object.hasOwn(KEYWORD_SETS, x);
}

/** Jeu principal : ECHO_KEYWORDS (original | blind), défaut blind. */
export function primaryKeywordSet(env: Record<string, string | undefined> = process.env): KeywordSetName {
  const v = env.ECHO_KEYWORDS?.trim();
  if (!v) return "blind";
  if (!isKeywordSetName(v)) throw new Error(`ECHO_KEYWORDS=${v}: expected one of ${KEYWORD_SET_NAMES.join(", ")}`);
  return v;
}

/** Lit eval/keywords*\/<lang>.json (une langue par fichier). */
export function loadKeywordSet(name: KeywordSetName = primaryKeywordSet()): KeywordLists {
  const dir = KEYWORD_SETS[name];
  const files = readdirSync(dir).filter((f) => /^[a-z]{2}\.json$/.test(f));
  return keywordListsFromFiles(files.map((f) => readJson<KeywordFile>(join(dir, f))));
}
