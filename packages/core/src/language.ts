// Détection simple de la langue d'un message ÉCRIT (pas de Whisper pour le texte) : mots outils et
// lettres caractéristiques. En cas de doute, "unknown" : le message entier passe alors en « pas sûr ».
import type { DetectedLang, VisitorLang } from "./types.ts";
import { words } from "./text.ts";

const STOPWORDS: Record<VisitorLang, string[]> = {
  en: ["the", "and", "was", "were", "is", "it", "we", "i", "to", "of", "a", "very", "but", "not", "with", "for", "you", "this", "that", "my", "our", "too", "so", "had", "have", "they", "there", "loved", "really", "would"],
  fr: ["le", "la", "les", "et", "est", "etait", "c'etait", "nous", "je", "de", "des", "un", "une", "tres", "mais", "pas", "avec", "pour", "vous", "ce", "cette", "mon", "notre", "trop", "on", "du", "au", "il", "y", "avait", "j'ai", "c'est", "merci"],
  de: ["der", "die", "das", "und", "ist", "war", "wir", "ich", "zu", "von", "ein", "eine", "sehr", "aber", "nicht", "mit", "fur", "sie", "es", "unser", "zu", "auch", "hat", "haben", "den", "dem", "uns", "danke", "schon", "wirklich"],
  es: ["el", "la", "los", "las", "y", "es", "fue", "era", "nosotros", "yo", "de", "un", "una", "muy", "pero", "no", "con", "para", "usted", "este", "esta", "mi", "nuestro", "demasiado", "que", "del", "al", "se", "gracias", "nos", "hay", "todo"],
};

const HINTS: { re: RegExp; lang: VisitorLang; weight: number }[] = [
  { re: /[ñ¿¡]/u, lang: "es", weight: 2 },
  { re: /[ßäöü]/u, lang: "de", weight: 2 },
  { re: /[çèêàùœ]/u, lang: "fr", weight: 1.5 },
];

export interface LanguageGuess {
  lang: DetectedLang;
  /** Part du score de la langue retenue, dans [0, 1]. */
  probability: number;
}

/** Devine la langue d'un texte parmi en/fr/de/es. "unknown" si trop peu d'indices. */
export function detectTextLanguage(text: string, minProbability = 0.5): LanguageGuess {
  const ws = words(text);
  const scores: Record<VisitorLang, number> = { en: 0, fr: 0, de: 0, es: 0 };
  for (const lang of Object.keys(STOPWORDS) as VisitorLang[]) {
    const set = new Set(STOPWORDS[lang]);
    for (const w of ws) if (set.has(w)) scores[lang] += 1;
  }
  const lower = text.toLowerCase();
  for (const h of HINTS) if (h.re.test(lower)) scores[h.lang] += h.weight;
  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  const [best, bestScore] = (Object.entries(scores) as [VisitorLang, number][]).sort((a, b) => b[1] - a[1])[0]!;
  if (bestScore < 1) return { lang: "unknown", probability: 0 };
  const probability = bestScore / total;
  return probability >= minProbability ? { lang: best, probability } : { lang: "unknown", probability };
}
