// Détection de négation par langue (SPEC 7) : « le chemin n'était pas trop long » ne déclenche pas N1.
//
// Les modèles de similarité ignorent presque la négation (« not too long » ≈ « far too long »). Le cœur
// repère donc les marqueurs de négation dans chaque morceau, et le matcher compare la négation du morceau
// à celle des exemples du catalogue (voir matcher.ts) : « there was no shade » (exemple nié de N8) reste N8,
// « the path was not too long » (exemple non nié de N1) ne devient jamais N1.
import type { DetectedLang, NegationInfo } from "./types.ts";
import { fold, wordListRegExp } from "./text.ts";

/** Marqueurs de négation par langue (formes repliées : minuscules, sans accents). */
export const NEGATION_CUES: Record<string, string[]> = {
  en: ["not", "no", "never", "nothing", "none", "nobody", "neither", "nor", "without", "hardly", "barely", "no longer", "cannot", "lack of", "lacked", "lacking"],
  // « personne » et « point » sont surtout des noms dans des retours : non retenus.
  fr: ["pas", "jamais", "rien", "aucun", "aucune", "ni", "sans", "guere", "nullement"],
  de: ["nicht", "kein", "keine", "keinen", "keinem", "keiner", "keines", "nie", "niemals", "nichts", "niemand", "ohne", "weder", "kaum", "mangel an"],
  es: ["no", "nunca", "jamas", "nada", "ningun", "ninguno", "ninguna", "nadie", "ni", "sin", "tampoco", "apenas", "falta de"],
};

/** Contractions anglaises (n't) et formes élidées françaises (n'). */
const EN_NT = /[a-z]n't(?![a-z])/g;
/** « ne ... plus » : « plus » n'est une négation qu'avec « ne / n' ». */
const FR_NE_PLUS = /(?<![a-z])(?:ne\s+|n')[a-z']+(?:\s+[a-z']+)?\s+plus(?![a-z])/g;

/**
 * Tournures où le marqueur n'inverse pas le sens (« not only », « no doubt », « never forget »...) :
 * retirées avant la détection.
 */
const NON_NEGATING: Record<string, string[]> = {
  en: ["not only", "no doubt", "without a doubt", "without doubt", "never forget", "will never forget", "never seen such", "can't wait", "cannot wait", "couldn't be happier", "could not be happier", "couldn't have been better", "no wonder", "can't recommend enough", "cannot recommend enough", "can't thank you enough", "not to be missed"],
  fr: ["non seulement", "pas seulement", "sans doute", "sans aucun doute", "n'oublierai jamais", "oublierai jamais", "ne manquez pas", "a ne pas manquer", "a ne pas rater"],
  de: ["nicht nur", "ohne zweifel", "zweifellos", "nie vergessen", "niemals vergessen", "kann es kaum erwarten"],
  es: ["no solo", "no solamente", "sin duda", "sin ninguna duda", "nunca olvidare", "no me lo olvidare", "no te lo pierdas", "no hay que perderselo"],
};

/**
 * Tournures à portée incertaine : litotes (« pas mal », « not bad »), atténuations (« not really »,
 * « pas vraiment »). Le morceau passe en « pas sûr ».
 */
const UNCERTAIN: Record<string, string[]> = {
  en: ["not bad", "not too bad", "not so bad", "not really", "not exactly", "not sure", "not that", "not quite", "not the worst", "no complaints"],
  fr: ["pas mal", "pas si mal", "pas trop mal", "pas vraiment", "pas tout a fait", "pas sur", "pas sure", "pas forcement", "pas tellement", "pas terrible"],
  de: ["nicht schlecht", "nicht so schlecht", "nicht wirklich", "nicht ganz", "nicht unbedingt", "nicht sicher", "nicht so"],
  es: ["no esta mal", "no estuvo mal", "nada mal", "no tan mal", "no realmente", "no del todo", "no estoy seguro", "no estoy segura", "no tanto", "no muy"],
};

function forLang(table: Record<string, string[]>, lang: DetectedLang): string[] {
  return table[lang] ?? [...new Set(Object.values(table).flat())];
}

/** Détecte la négation dans un morceau (déjà découpé en proposition). */
export function detectNegation(chunk: string, lang: DetectedLang): NegationInfo {
  let t = fold(chunk);
  const cues: string[] = [];

  const nonNeg = wordListRegExp(forLang(NON_NEGATING, lang).map(fold));
  if (nonNeg) t = t.replace(nonNeg, " ");

  let uncertain = false;
  const unc = wordListRegExp(forLang(UNCERTAIN, lang).map(fold));
  if (unc) {
    t = t.replace(unc, (m) => {
      cues.push(m.replace(/\s+/g, " "));
      uncertain = true;
      return " ";
    });
  }

  let count = 0;
  const useEn = lang === "en" || !NEGATION_CUES[lang];
  const useFr = lang === "fr" || !NEGATION_CUES[lang];
  if (useEn) {
    t = t.replace(EN_NT, (m) => {
      cues.push("n't");
      count++;
      return `${m[0]} `;
    });
  }
  if (useFr) {
    t = t.replace(FR_NE_PLUS, (m) => {
      cues.push("ne...plus");
      count++;
      return m.replace(/plus$/, " ");
    });
  }
  const re = wordListRegExp(forLang(NEGATION_CUES, lang).map(fold));
  if (re) {
    for (const m of t.matchAll(re)) {
      cues.push(m[0].replace(/\s+/g, " "));
      count++;
    }
  }
  // « ne / n' » sans second marqueur (« je n'ai que... ») ne compte pas : seule la seconde partie est un indice.

  // Double négation (« not without », « nicht ohne ») : portée incertaine. En français et en espagnol,
  // plusieurs marqueurs forment une seule négation (« no había nada », « jamais rien ») : pas de doute.
  const concord = lang === "fr" || lang === "es";
  if (count >= 2 && !concord) uncertain = true;
  return { negated: count > 0 || uncertain, uncertain, cues };
}
