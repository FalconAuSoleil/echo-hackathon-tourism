// Retrait des noms propres, numéros de téléphone, e-mails et pseudonymes AVANT tout stockage
// (SPEC 4.3 étape 3, SPEC 6). Heuristiques sans modèle, volontairement larges : retirer un mot de trop
// coûte peu, garder un nom coûte la vie privée d'un visiteur.
import type { DetectedLang } from "./types.ts";
import { escapeRegExp, fold } from "./text.ts";
import { AMBIGUOUS_NAMES_PACKED, CAPITALIZED_ONLY_NAMES_PACKED, GIVEN_NAMES_PACKED } from "./given-names.ts";

export interface ScrubResult {
  text: string;
  removed: { names: number; phones: number; emails: number; handles: number };
}

export const PII_TOKENS = { name: "[nom]", phone: "[numéro]", email: "[e-mail]", handle: "[pseudo]" } as const;

/** Tournures de présentation : le ou les mots qui suivent sont un nom. */
const INTRO_CUES: Record<string, string[]> = {
  en: ["my name is", "my name's", "name is", "i am called", "i'm called", "call me", "this is", "i am", "i'm", "signed", "from your friend", "regards", "cheers", "named", "called", "name was"],
  fr: ["je m'appelle", "je me nomme", "mon nom est", "mon prénom est", "moi c'est", "c'est", "je suis", "signé", "de la part de", "bises", "nommé", "nommée", "s'appelle", "s'appelait", "appelé", "appelée", "prénommé", "prénommée"],
  de: ["ich heiße", "ich heisse", "mein name ist", "mein vorname ist", "ich bin der", "ich bin die", "hier ist", "hier spricht", "grüße von", "gruß", "hieß", "hiess", "heißt", "heisst", "namens", "genannt"],
  es: ["me llamo", "mi nombre es", "soy", "aquí", "habla", "de parte de", "saludos de", "firmado", "llamado", "llamada", "se llama", "se llamaba", "de nombre"],
};
/** Après ces tournures, on n'accepte que des mots à majuscule (sinon « I am happy » perdrait « happy »). */
const INTRO_CAPITALIZED_ONLY = new Set(["this is", "i am", "i'm", "c'est", "je suis", "soy", "aquí", "habla", "regards", "cheers", "bises", "gruß", "signed", "signé", "firmado", "hier ist", "hieß", "hiess", "heißt", "heisst", "called", "appelé", "appelée", "genannt", "llamado", "llamada"]);

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
    // Lieux, nationalités, mois et fêtes qui sont aussi des prénoms du dictionnaire (given-names.ts).
    "india", "jordan", "georgia", "virginia", "carolina", "paris", "victoria", "florence", "chad", "israel", "lorraine", "savannah",
    "sydney", "kampala", "nairobi", "london", "berlin", "madrid", "brussels", "bruxelles", "geneva", "genève", "milan", "roma", "rome", "vienna", "wien",
    "christian", "christians", "chrétien", "janvier", "avril", "juin", "juillet", "août", "mai", "enero", "febrero", "abril", "mayo", "junio", "julio", "agosto",
    "mercedes", "toyota", "jesus", "jésus", "jesús",
    // Mots techniques et unités que Whisper écrit avec une majuscule (« Is there any Wi-Fi? »).
    "wi-fi", "wifi", "hi-fi", "gps", "sms", "internet", "bluetooth", "youtube", "tiktok", "uber", "visa", "mastercard", "paypal",
    "euro", "euros", "franc", "francs", "franken", "dollar", "dollars", "rwf", "frw", "shilling", "shillings",
    // Villes d'où viennent souvent les visiteurs, dont certaines sont aussi des prénoms ou des noms de famille.
    "lyon", "marseille", "lille", "toulouse", "bordeaux", "nantes", "strasbourg", "montpellier", "rennes", "grenoble", "nice",
    "valencia", "barcelona", "sevilla", "seville", "bilbao", "granada", "zaragoza", "málaga", "malaga", "lisbon", "lisboa", "porto",
    "hamburg", "münchen", "munich", "köln", "cologne", "frankfurt", "stuttgart", "düsseldorf", "dresden", "leipzig", "zürich", "zurich", "basel", "bern", "lausanne",
    "amsterdam", "rotterdam", "antwerp", "anvers", "liège", "luxembourg", "manchester", "liverpool", "dublin", "boston", "chicago", "toronto", "montréal", "montreal", "québec", "quebec",
    // Noms communs allemands courants derrière « Liebe / Hallo / Danke » (« Liebe Grüße »).
    "grüße", "gruß", "grüsse", "gruss", "leute", "familie", "freunde", "gastgeber", "gastgeberin", "gäste", "kinder", "dank",
  ].map((w) => fold(w)),
);

/** Quantifieurs juste avant un mot : ce mot est une unité ou une chose (« jeden Frank », « every Euro »). */
const QUANTIFIER_BEFORE = /(?<![\p{L}\p{N}])(?:jeden|jede|jedes|keinen|pro|every|each|per|chaque|cada)\s+$/iu;

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

/** Dictionnaire de prénoms (en/fr/de/es + noms rwandais) : given-names.ts, généré, sources dans DATASHEET. */
const GIVEN_NAMES = new Set(GIVEN_NAMES_PACKED.split("|"));
export const GIVEN_NAME_COUNT = GIVEN_NAMES.size;
const unpack = (packed: Record<string, string>): Record<string, Set<string>> =>
  Object.fromEntries(Object.entries(packed).map(([l, v]) => [l, new Set(v ? v.split("|") : [])]));
const AMBIGUOUS_NAMES = unpack(AMBIGUOUS_NAMES_PACKED);
const CAPITALIZED_ONLY_NAMES = unpack(CAPITALIZED_ONLY_NAMES_PACKED);
const anyLang = (table: Record<string, Set<string>>, key: string): boolean => Object.values(table).some((set) => set.has(key));

/**
 * Le mot est-il un prénom du dictionnaire, retirable quelle que soit sa position (début de phrase, allemand,
 * texte en minuscules) ? Non si le prénom est aussi un mot courant de la langue (« Grace », « Pierre »,
 * « Dolores ») : celui-là n'est retiré que par les règles de contexte. Un prénom parfois écrit en minuscules
 * (« jack », « jean » en français) n'est retiré qu'avec sa majuscule. Langue inconnue : prudence de toutes.
 */
export function isGazetteerName(word: string, lang: DetectedLang): boolean {
  const key = fold(word).replace(/['’]s$/, "");
  if (key.length < 3 || NOT_NAMES.has(key)) return false;
  const known = AMBIGUOUS_NAMES[lang] !== undefined;
  const ambiguous = (k: string) => (known ? AMBIGUOUS_NAMES[lang]!.has(k) : anyLang(AMBIGUOUS_NAMES, k));
  const capOnly = (k: string) => (known ? CAPITALIZED_ONLY_NAMES[lang]!.has(k) : anyLang(CAPITALIZED_ONLY_NAMES, k));
  const capitalized = /^\p{Lu}/u.test(word);
  const ok = (k: string) => GIVEN_NAMES.has(k) && !ambiguous(k) && (capitalized || !capOnly(k));
  if (ok(key)) return true;
  // Prénom composé absent du dictionnaire (« Marie-Claude ») : chaque partie est un prénom, majuscule exigée.
  const parts = key.split("-");
  return capitalized && parts.length > 1 && parts.every((p) => GIVEN_NAMES.has(p) && !NOT_NAMES.has(p)) && !ambiguous(parts[0]!);
}

/** Chiffres dictés en toutes lettres (numéro de téléphone dit à voix haute), et combien de chiffres chacun vaut. */
const DIGIT_WORDS: Record<string, number> = Object.fromEntries(
  [
    ...["zero", "oh", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"].map((w) => [w, 1]),
    ...["zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf"].map((w) => [w, 1]),
    ...["null", "eins", "zwei", "zwo", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun"].map((w) => [w, 1]),
    ...["cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve"].map((w) => [w, 1]),
    // Dizaines et nombres de 10 à 99 dits par paires (« zéro sept, quatre-vingt-huit, douze »).
    ...["ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"].map((w) => [w, 2]),
    ...["dix", "onze", "douze", "treize", "quatorze", "quinze", "seize", "vingt", "trente", "quarante", "cinquante", "soixante", "septante", "huitante", "nonante"].map((w) => [w, 2]),
    ...["zehn", "elf", "zwölf", "dreizehn", "vierzehn", "fünfzehn", "sechzehn", "siebzehn", "achtzehn", "neunzehn", "zwanzig", "dreißig", "dreissig", "vierzig", "fünfzig", "sechzig", "siebzig", "achtzig", "neunzig"].map((w) => [w, 2]),
    ...["diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve", "veinte", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"].map((w) => [w, 2]),
  ].map(([w, n]) => [fold(w as string), n as number]),
);
const REPEATERS: Record<string, number> = { double: 2, triple: 3, doppel: 2, doble: 2 };
const NUMBER_JOINERS = new Set(["and", "et", "und", "y", "o"].map(fold));

/** Valeur en chiffres d'un mot d'une suite dictée (« quatre-vingt-huit » → 2, « 788 » → 3), ou null. */
function spokenDigits(token: string): number | null {
  const f = fold(token);
  if (/^\d+$/.test(f)) return f.length;
  if (DIGIT_WORDS[f] !== undefined) return DIGIT_WORDS[f]!;
  // Composés : « quatre-vingt-huit », « twenty-one », « vingt et un » (géré par les joints), « dreiundzwanzig ».
  const parts = f.split(/-|und/).filter(Boolean);
  if (parts.length > 1 && parts.every((p) => DIGIT_WORDS[p] !== undefined)) return 2;
  return null;
}

function isNotName(word: string): boolean {
  return NOT_NAMES.has(fold(word).replace(/['’]s$/, ""));
}

/**
 * Remplace les suites de chiffres dictés (au moins 4 mots, au moins 7 chiffres en tout) par le jeton donné.
 * « double » / « triple » répètent le chiffre suivant ; « plus » en tête (indicatif) est inclus.
 */
function replaceSpokenNumbers(text: string, token: () => string): string {
  const re = new RegExp(`${ANY_WORD}|\\d+|\\+`, "gu");
  const toks: { s: number; e: number; w: string }[] = [];
  for (let m = re.exec(text); m; m = re.exec(text)) toks.push({ s: m.index, e: m.index + m[0].length, w: m[0] });
  const spans: [number, number][] = [];
  let i = 0;
  while (i < toks.length) {
    let j = i;
    let digits = 0;
    let words = 0;
    let pending = 1;
    let lastDigit = -1;
    const start = toks[i]!.w === "+" || fold(toks[i]!.w) === "plus" ? i + 1 : i;
    for (j = start; j < toks.length; j++) {
      // Seuls des espaces, virgules, points, tirets ou barres séparent deux mots d'une même suite.
      if (j > start && !/^[\s,.\-/()]*$/.test(text.slice(toks[j - 1]!.e, toks[j]!.s))) break;
      const f = fold(toks[j]!.w);
      const rep = REPEATERS[f];
      if (rep) {
        pending = rep;
        continue;
      }
      const d = spokenDigits(toks[j]!.w);
      if (d === null) {
        if (NUMBER_JOINERS.has(f) && j + 1 < toks.length && spokenDigits(toks[j + 1]!.w) !== null) continue;
        break;
      }
      digits += d * pending;
      pending = 1;
      words++;
      lastDigit = j;
    }
    if (lastDigit >= 0 && words >= 4 && digits >= 7 && digits <= 15) {
      spans.push([toks[i]!.s, toks[lastDigit]!.e]);
      i = lastDigit + 1;
    } else i++;
  }
  let out = text;
  for (const [s, e] of spans.reverse()) out = out.slice(0, s) + token() + out.slice(e);
  return out;
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

  // 3b. Numéros dictés en toutes lettres : « zero seven eight eight, one two three... », au moins 7 chiffres.
  t = replaceSpokenNumbers(t, () => {
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
    // Mot entier seulement : « WhatsApp », « WiFi » ne perdent pas leur début (« [nom]App »).
    const mid = new RegExp(`(?<=[\\p{L}\\p{N},;'’)]\\s+)(${NAME_WORD}(?:\\s+${NAME_WORD}){0,2})${E}`, "gu");
    t = t.replace(mid, (m: string, _name: string, offset: number, whole: string) => {
      // Début de phrase après ponctuation forte : pas un indice.
      const before = whole.slice(0, offset).trimEnd();
      if (/[.!?…:;"«“]$/.test(before) || /\n\s*$/.test(whole.slice(0, offset))) return m;
      const parts = m.split(/\s+/);
      if (parts.every((p) => isNotName(p))) return m;
      return replaceName();
    });
  }

  // 8. Prénoms du dictionnaire, dans toute position et toute langue (allemand compris), y compris en minuscules
  //    (transcription sans majuscules) : « Eric was hard to follow », « Thomas fand den Weg lang ».
  //    Pas juste après un quantifieur (« jeden Frank wert », Whisper pour « jeden Franken ») : une unité, pas une
  //    personne.
  t = t.replace(new RegExp(`(?<![\\[\\p{L}\\p{N}'’-])${ANY_WORD}`, "gu"), (w: string, offset: number, whole: string) =>
    isGazetteerName(w, lang) && !QUANTIFIER_BEFORE.test(whole.slice(Math.max(0, offset - 12), offset)) ? replaceName() : w,
  );

  // 9. Prénom du dictionnaire mais aussi mot courant (« Pierre », « Grace ») : retiré seulement s'il est coordonné
  //    à un nom déjà retiré ou à « moi / I / ich / yo » (« Pierre et [nom] », « Grace and I loved it »).
  const coord = "(?:and|et|und|y|e|&)";
  const self = "(?:I|me|moi|ich|yo|mí)";
  const asName = (w: string): boolean => GIVEN_NAMES.has(fold(w).replace(/['’]s$/, "")) && !NOT_NAMES.has(fold(w)) && /^\p{Lu}/u.test(w);
  t = t.replace(new RegExp(`(?<![\\p{L}\\p{N}'’-])(${NAME_WORD})(?=\\s+${coord}\\s+(?:\\[nom\\]|${self}${E}))`, "gu"), (w: string) => (asName(w) ? replaceName() : w));
  t = t.replace(new RegExp(`(\\[nom\\],?\\s+${coord}\\s+)(${NAME_WORD})${E}`, "gu"), (m: string, pre: string, w: string) => (asName(w) ? pre + replaceName() : m));

  // Jetons [nom] consécutifs (« [nom] [nom] ») fusionnés.
  t = t.replace(/\[nom\](?:\s+\[nom\])+/g, PII_TOKENS.name);
  return { text: t, removed };
}
