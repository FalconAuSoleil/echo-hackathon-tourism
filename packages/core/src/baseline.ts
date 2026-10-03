// Méthode de comparaison sans IA (SPEC 9) : mots-clés par constat et par langue.
// Les listes sont des DONNÉES : écrites par l'évaluation dans eval/keywords/ (ou présentes dans le
// catalogue). Volontairement naïve : pas de gestion de la négation, pas de seuil, pas de « pas sûr ».
import type { Catalog } from "./catalog.ts";
import type { DetectedLang, FindingId } from "./types.ts";
import { segment } from "./segment.ts";
import { fold, wordListRegExp } from "./text.ts";

/** Mots-clés par constat puis par langue. */
export type KeywordLists = Partial<Record<FindingId, Partial<Record<string, string[]>>>>;

/** Format des fichiers eval/keywords/<lang>.json : une langue par fichier. */
export interface KeywordFile {
  lang: string;
  findings: Partial<Record<FindingId, string[]>>;
}

/**
 * Correspondance : "prefix" (défaut) = le mot-clé doit commencer un mot et peut se prolonger
 * (« welcom » trouve « welcome », « röst » trouve « Röstung ») ; "word" = mot entier seulement
 * (un mot-clé finissant par « * » reste un préfixe). Accents et casse ignorés dans les deux cas.
 */
export type KeywordMatchMode = "prefix" | "word";

/** Fusionne les fichiers par langue en KeywordLists. */
export function keywordListsFromFiles(files: readonly KeywordFile[]): KeywordLists {
  const out: KeywordLists = {};
  for (const file of files) {
    for (const [id, terms] of Object.entries(file.findings) as [FindingId, string[]][]) {
      const perLang = (out[id] ??= {});
      perLang[file.lang] = [...(perLang[file.lang] ?? []), ...terms];
    }
  }
  return out;
}

/** Mots-clés du catalogue (champ `keywords`) au format KeywordLists. */
export function keywordListsFromCatalog(catalog: Catalog): KeywordLists {
  const out: KeywordLists = {};
  for (const f of catalog.findings) out[f.id] = { ...f.keywords };
  return out;
}

function isCatalog(x: Catalog | KeywordLists): x is Catalog {
  return Array.isArray((x as Catalog).findings);
}

const fromCatalog = new WeakMap<Catalog, KeywordLists>();
function listsOf(source: Catalog | KeywordLists): KeywordLists {
  if (!isCatalog(source)) return source;
  let l = fromCatalog.get(source);
  if (!l) {
    l = keywordListsFromCatalog(source);
    fromCatalog.set(source, l);
  }
  return l;
}

const cache = new WeakMap<object, Map<string, [FindingId, RegExp][]>>();

function compiled(lists: KeywordLists, lang: DetectedLang, mode: KeywordMatchMode): [FindingId, RegExp][] {
  let byLang = cache.get(lists);
  if (!byLang) {
    byLang = new Map();
    cache.set(lists, byLang);
  }
  const key = `${mode}:${lang}`;
  const hit = byLang.get(key);
  if (hit) return hit;
  const out: [FindingId, RegExp][] = [];
  for (const [id, perLang] of Object.entries(lists) as [FindingId, Partial<Record<string, string[]>>][]) {
    // Langue connue : sa liste ; langue inconnue ou sans liste : toutes les listes.
    const terms = perLang[lang]?.length ? perLang[lang]! : Object.values(perLang).flat().filter((x): x is string => !!x);
    const folded = [...new Set(terms.map((t) => fold(t).trim()))].map((t) => (mode === "prefix" && !t.endsWith("*") ? `${t}*` : t));
    const re = wordListRegExp(folded, "u");
    if (re) out.push([id, re]);
  }
  byLang.set(key, out);
  return out;
}

/** Constats dont un mot-clé apparaît dans le morceau (sans gestion de la négation : c'est la référence naïve). */
export function keywordClassify(
  chunk: string,
  lang: DetectedLang,
  source: Catalog | KeywordLists,
  mode: KeywordMatchMode = "prefix",
): FindingId[] {
  const lists = listsOf(source);
  const text = fold(chunk);
  return compiled(lists, lang, mode)
    .filter(([, re]) => re.test(text))
    .map(([id]) => id);
}

export interface KeywordAnalysis {
  chunks: { text: string; findings: FindingId[] }[];
  /** Union des constats du message, chaque constat une fois. */
  findings: FindingId[];
}

/** Même découpage qu'Echo, puis mots-clés par morceau (mode comparaison de la démo, évaluation). */
export function keywordAnalyze(
  text: string,
  lang: DetectedLang,
  source: Catalog | KeywordLists,
  mode: KeywordMatchMode = "prefix",
): KeywordAnalysis {
  const lists = listsOf(source);
  const chunks = segment(text, lang).map((s) => ({ text: s.text, findings: keywordClassify(s.text, lang, lists, mode) }));
  const findings = [...new Set(chunks.flatMap((c) => c.findings))];
  return { chunks, findings };
}
