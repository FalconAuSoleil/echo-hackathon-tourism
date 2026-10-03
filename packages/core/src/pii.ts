// Retrait des noms propres, numéros de téléphone, e-mails et pseudonymes AVANT tout stockage
// (SPEC 4.3 étape 3, SPEC 6). Heuristiques sans modèle, volontairement larges : retirer un mot de trop
// coûte peu, garder un nom coûte la vie privée d'un visiteur.
import type { DetectedLang } from "./types.ts";
import { escapeRegExp, fold } from "./text.ts";

export interface ScrubResult {
  text: string;
  removed: { names: number; phones: number; emails: number; handles: number };
}

export const PII_TOKENS = { name: "[nom]", phone: "[numéro]", email: "[e-mail]", handle: "[pseudo]" } as const;

/** Tournures de présentation : le ou les mots qui suivent sont un nom. */
const INTRO_CUES: Record<string, string[]> = {
  en: ["my name is", "my name's", "name is", "i am called", "i'm called", "call me", "this is", "i am", "i'm", "signed", "from your friend", "regards", "cheers"],
  fr: ["je m'appelle", "je me nomme", "mon nom est", "mon prénom est", "moi c'est", "c'est", "je suis", "signé", "de la part de", "bises"],
  de: ["ich heiße", "ich heisse", "mein name ist", "mein vorname ist", "ich bin der", "ich bin die", "hier ist", "hier spricht", "grüße von", "gruß"],
  es: ["me llamo", "mi nombre es", "soy", "aquí", "habla", "de parte de", "saludos de", "firmado"],
};
/** Après ces tournures, on n'accepte que des mots à majuscule (sinon « I am happy » perdrait « happy »). */
const INTRO_CAPITALIZED_ONLY = new Set(["this is", "i am", "i'm", "c'est", "je suis", "soy", "aquí", "habla", "regards", "cheers", "bises", "gruß", "signed", "signé", "firmado", "hier ist"]);

/** Titres de civilité, et rôles suivis d'un prénom (« notre guide Eric »). */
const HONORIFICS = [
  "mr", "mrs", "ms", "miss", "dr", "sir", "madam", "mister", "monsieur", "madame", "mademoiselle", "mme", "mlle", "m.",
  "herr", "frau", "señor", "señora", "señorita", "sr", "sra", "srta", "don", "doña", "mama", "papa", "mzee",
  "guide", "führer", "fuhrer", "reiseleiter", "reiseleiterin", "guía", "guia", "farmer", "fermière", "fermier", "bäuerin", "bauer", "host", "hôte", "hôtesse", "gastgeber", "gastgeberin", "anfitrión", "anfitriona",
  "friend", "ami", "amie", "freund", "freundin", "amigo", "amiga", "daughter", "fille", "tochter", "hija", "son", "fils", "sohn", "hijo",
];
/** Remerciements ou salutations suivis d'un prénom à majuscule (« thank you Noor », « merci Marie »). */
const THANKS = ["thank you", "thanks", "thank", "hello", "hi", "dear", "merci", "bonjour", "salut", "cher", "chère", "danke", "vielen dank", "hallo", "liebe", "lieber", "gracias", "muchas gracias", "hola", "querida", "querido"];

/** Mots à majuscule qui ne sont pas des noms de personnes (lieux, langues, jours, marques...). */
const NOT_NAMES = new Set(
  [
    "i", "i'm", "i've", "i'd", "i'll", "ok", "okay", "wow", "god", "dieu", "gott", "dios",
    "rwanda", "kigali", "ondera", "africa", "afrique", "afrika", "áfrica", "east", "europe", "europa", "america", "amérique", "amerika", "asia",
    "uganda", "kenya", "tanzania", "burundi", "congo", "musanze", "huye", "rubavu", "nyungwe", "kivu", "lake",
    "england", "france", "germany", "deutschland", "allemagne", "spain", "españa", "espagne", "italy", "usa", "uk", "canada", "belgium", "belgique", "switzerland", "suisse", "schweiz", "netherlands", "mexico", "méxico", "argentina", "colombia", "chile", "perú", "peru", "japan", "china", "australia",
    "english", "french", "german", "spanish", "kinyarwanda", "swahili", "kiswahili", "anglais", "français", "allemand", "espagnol", "englisch", "französisch", "deutsch", "spanisch", "inglés", "francés", "alemán", "español", "europeans", "african", "rwandan", "rwandais", "ruandisch", "ruandés",
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
    "whatsapp", "google", "facebook", "instagram", "tripadvisor", "airbnb", "booking", "mtn", "airtel", "momo", "arabica", "bourbon", "robusta", "echo",
    "christmas", "easter", "noël", "weihnachten", "navidad", "covid",
  ].map((w) => fold(w)),
);

const NAME_WORD = "\\p{Lu}[\\p{Ll}\\p{Lm}'’]+(?:-\\p{Lu}[\\p{Ll}\\p{Lm}]+)*";
const ANY_WORD = "[\\p{L}][\\p{L}'’-]*";
const B = "(?<![\\p{L}\\p{N}])";
const E = "(?![\\p{L}\\p{N}])";

/** Mots courants qui ne sont jamais pris comme nom après une présentation en minuscules. */
const LOWERCASE_STOP = new Set(
  ["a", "an", "the", "not", "on", "at", "in", "for", "back", "anytime", "au", "à", "sur", "dans", "pour", "an", "am", "auf", "unter", "bei", "en", "por", "al", "para", "very", "so", "really", "happy", "glad", "here", "from", "and", "un", "une", "le", "la", "les", "pas", "très", "ici", "de", "et", "ein", "eine", "der", "die", "das", "nicht", "sehr", "hier", "aus", "und", "el", "los", "las", "no", "muy", "aquí", "y", "de"].map(fold),
);

function forLang(table: Record<string, string[]>, lang: DetectedLang): string[] {
  return table[lang] ?? [...new Set(Object.values(table).flat())];
}

/**
 * Alternative insensible à la casse écrite lettre par lettre ([mM][yY]...) : le drapeau « i » rendrait
 * aussi \p{Lu} insensible à la casse, et la règle « nom à majuscule » ne marcherait plus.
 */
function alternation(terms: string[]): string {
  const ci = (t: string): string =>
    [...t]
      .map((ch) => {
        if (/\s/.test(ch)) return "\\s+";
        if (ch === "'" || ch === "’") return "['’]";
        const lo = ch.toLowerCase();
        const up = ch.toUpperCase();
        return lo !== up && up.length === 1 ? `[${lo}${up}]` : escapeRegExp(ch);
      })
      .join("")
      .replace(/(\\s\+)+/g, "\\s+");
  return [...terms].sort((a, b) => b.length - a.length).map(ci).join("|");
}

function isNotName(word: string): boolean {
  return NOT_NAMES.has(fold(word).replace(/['’]s$/, ""));
}

/** Remplace par des jetons neutres : [nom], [numéro], [e-mail], [pseudo]. */
export function scrubPii(text: string, lang: DetectedLang): ScrubResult {
  const removed = { names: 0, phones: 0, emails: 0, handles: 0 };
  let t = text;

  // 1. E-mails, écrits ou dictés (« anna at gmail dot com »).
  t = t.replace(/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu, () => {
    removed.emails++;
    return PII_TOKENS.email;
  });
  t = t.replace(
    new RegExp(`${B}[\\p{L}\\p{N}._-]+\\s+(?:at|arobase|chez|ät|arroba)\\s+[\\p{L}\\p{N}-]+\\s+(?:dot|point|punkt|punto)\\s+(?:com|org|net|fr|de|es|rw|be|ch|uk|io|co)${E}`, "giu"),
    () => {
      removed.emails++;
      return PII_TOKENS.email;
    },
  );

  // 2. Pseudonymes (@handle).
  t = t.replace(/(?<![\p{L}\p{N}@])@[\p{L}\p{N}_.]{2,}/gu, () => {
    removed.handles++;
    return PII_TOKENS.handle;
  });

  // 3. Numéros de téléphone : au moins 7 chiffres, séparateurs usuels.
  t = t.replace(/(?<![\p{L}\p{N}])\+?\(?\d[\d\s().\-/]{5,}\d(?![\p{L}\p{N}])/gu, (m) => {
    const digits = m.replace(/\D/g, "").length;
    if (digits < 7 || digits > 15) return m;
    removed.phones++;
    return PII_TOKENS.phone;
  });

  const replaceName = (): string => {
    removed.names++;
    return PII_TOKENS.name;
  };

  // 4. Présentations : « my name is Anna Smith », « je m'appelle marie ».
  for (const cue of forLang(INTRO_CUES, lang)) {
    const capOnly = INTRO_CAPITALIZED_ONLY.has(cue);
    const re = new RegExp(`(${B}${alternation([cue])}\\s+)(${NAME_WORD}(?:\\s+${NAME_WORD}){0,2}${capOnly ? "" : `|${ANY_WORD}`})`, "gu");
    t = t.replace(re, (m, pre: string, name: string) => {
      if (capOnly) {
        // La tournure elle-même peut être en tête de phrase, mais le nom doit avoir sa majuscule.
        if (!new RegExp(`^${NAME_WORD}`, "u").test(name) || isNotName(name.split(/\s+/)[0] ?? "")) return m;
      } else if (!new RegExp(`^${NAME_WORD}`, "u").test(name)) {
        if (LOWERCASE_STOP.has(fold(name)) || isNotName(name)) return m;
      } else if (isNotName(name.split(/\s+/)[0] ?? "")) return m;
      return pre + replaceName();
    });
  }

  // 5. Civilités et rôles suivis d'un nom à majuscule : « Mr Smith », « notre guide Eric », « Frau Müller ».
  const hon = new RegExp(`(${B}(?:${alternation(HONORIFICS)})\\.?\\s+)(${NAME_WORD}(?:\\s+${NAME_WORD}){0,2})`, "gu");
  t = t.replace(hon, (m, pre: string, name: string) => (isNotName(name.split(/\s+/)[0] ?? "") ? m : pre + replaceName()));

  // 6. Remerciements / salutations + nom : « thank you Noor », « danke Jean ».
  const thanks = new RegExp(`(${B}(?:${alternation(THANKS)}),?\\s+)(${NAME_WORD}(?:\\s+${NAME_WORD}){0,2})`, "gu");
  t = t.replace(thanks, (m, pre: string, name: string) => (isNotName(name.split(/\s+/)[0] ?? "") ? m : pre + replaceName()));

  // 7. Mots à majuscule en milieu de phrase (anglais, français, espagnol : les noms communs n'y ont pas
  //    de majuscule). En allemand, tous les noms communs en ont une : seules les règles 4 à 6 s'appliquent.
  if (lang !== "de") {
    const mid = new RegExp(`(?<=[\\p{L}\\p{N},;'’)]\\s+)(${NAME_WORD}(?:\\s+${NAME_WORD}){0,2})`, "gu");
    t = t.replace(mid, (m: string, _name: string, offset: number, whole: string) => {
      // Début de phrase après ponctuation forte : pas un indice.
      const before = whole.slice(0, offset).trimEnd();
      if (/[.!?…:;"«“]$/.test(before) || /\n\s*$/.test(whole.slice(0, offset))) return m;
      const parts = m.split(/\s+/);
      if (parts.every((p) => isNotName(p))) return m;
      return replaceName();
    });
  }

  // Jetons [nom] consécutifs (« [nom] [nom] ») fusionnés.
  t = t.replace(/\[nom\](?:\s+\[nom\])+/g, PII_TOKENS.name);
  return { text: t, removed };
}
