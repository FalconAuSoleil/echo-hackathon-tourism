// SMS : texte sûr en GSM-7 et découpage en SMS courts (SPEC 4.6). Envoi réel via l'URI sms: côté app.
// Chaque SMS est envoyé séparément (un appui sur Envoyer par SMS) : 160 caractères GSM-7 par message,
// et chaque SMS contient des lignes entières du récap pour se lire seul.

export const SMS_SINGLE_GSM7 = 160;
export const SMS_PART_GSM7 = 153;

/** Table de base GSM 03.38 (sans le caractère d'échappement). */
const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
/** Table d'extension (2 septets chacun). */
const GSM7_EXT = "^{}\\[~]|€\f";

const BASIC = new Set([...GSM7_BASIC]);
const EXT = new Set([...GSM7_EXT]);

/** Vrai si tous les caractères sont dans l'alphabet GSM 03.38 (table de base + extension). */
export function isGsm7(text: string): boolean {
  for (const ch of text) if (!BASIC.has(ch) && !EXT.has(ch)) return false;
  return true;
}

/** Longueur en septets (un caractère d'extension en compte deux). */
export function gsm7Length(text: string): number {
  let n = 0;
  for (const ch of text) n += EXT.has(ch) ? 2 : 1;
  return n;
}

const REPLACEMENTS: Record<string, string> = {
  "‘": "'", "’": "'", "‚": "'", "‛": "'", "′": "'", "´": "'", "`": "'", "ʼ": "'",
  "“": '"', "”": '"', "„": '"', "«": '"', "»": '"', "″": '"',
  "–": "-", "—": "-", "‒": "-", "−": "-", "‐": "-", "‑": "-",
  "…": "...", " ": " ", " ": " ", " ": " ", " ": " ", "\t": " ",
  "•": "-", "·": ".", "×": "x", "÷": "/", "°": "o",
  "œ": "oe", "Œ": "OE", "½": "1/2", "¼": "1/4", "¾": "3/4",
  "ł": "l", "Ł": "L", "đ": "d", "Đ": "D", "ı": "i",
};

/**
 * Remplace les caractères hors GSM-7 (guillemets typographiques, tirets longs, accents absents de la
 * table) par des équivalents ; à défaut, par « ? ». Le résultat vérifie toujours isGsm7.
 */
export function toGsm7(text: string): string {
  let out = "";
  for (const ch of text.normalize("NFC")) {
    if (BASIC.has(ch) || EXT.has(ch)) {
      out += ch;
      continue;
    }
    const rep = REPLACEMENTS[ch];
    if (rep !== undefined) {
      out += rep;
      continue;
    }
    // Lettre accentuée hors table (â, ê, î, ô, û, ë, ï, á, í, ó, ú, ç...) : lettre de base.
    const base = ch.normalize("NFD").replace(/\p{M}+/gu, "");
    if (base && [...base].every((c) => BASIC.has(c))) {
      out += base;
      continue;
    }
    out += "?";
  }
  return out;
}

/** Coupe une ligne trop longue aux espaces (un mot plus long que maxLen est coupé net). */
function wrapLine(line: string, maxLen: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const word of line.split(/ +/)) {
    const candidate = cur ? `${cur} ${word}` : word;
    if (gsm7Length(candidate) <= maxLen) {
      cur = candidate;
      continue;
    }
    if (cur) out.push(cur);
    let w = word;
    while (gsm7Length(w) > maxLen) {
      let cut = maxLen;
      while (gsm7Length(w.slice(0, cut)) > maxLen) cut--;
      out.push(w.slice(0, cut));
      w = w.slice(cut);
    }
    cur = w;
  }
  if (cur) out.push(cur);
  return out;
}

export interface SplitSmsOptions {
  /** Ajoute « (1/3) » à la fin de chaque SMS quand il y en a plusieurs (chiffres seulement). */
  numbered?: boolean;
}

/**
 * Découpe les lignes du récap en SMS d'au plus `maxLen` caractères GSM-7. Les lignes sont d'abord
 * translittérées (toGsm7), puis regroupées sans jamais couper une ligne, sauf si elle dépasse seule `maxLen`.
 */
export function splitSms(lines: string[], maxLen: number = SMS_SINGLE_GSM7, options: SplitSmsOptions = {}): string[] {
  if (maxLen < 20) throw new Error("maxLen too small");
  const pack = (limit: number): string[] => {
    const units = lines.map((l) => toGsm7(l).trim()).filter((l) => l.length > 0).flatMap((l) => wrapLine(l, limit));
    const parts: string[] = [];
    let cur = "";
    for (const u of units) {
      const candidate = cur ? `${cur}\n${u}` : u;
      if (gsm7Length(candidate) <= limit) cur = candidate;
      else {
        parts.push(cur);
        cur = u;
      }
    }
    if (cur) parts.push(cur);
    return parts;
  };
  let parts = pack(maxLen);
  if (options.numbered && parts.length > 1) {
    // Réserve la place du suffixe « (i/N) » et recommence.
    for (let reserve = 6; ; reserve++) {
      parts = pack(maxLen - reserve);
      const total = parts.length;
      const suffixed = parts.map((p, i) => `${p} (${i + 1}/${total})`);
      if (suffixed.every((p) => gsm7Length(p) <= maxLen)) return total > 1 ? suffixed : parts;
    }
  }
  return parts;
}

/** URI sms: qui ouvre l'application SMS préremplie ; un humain appuie sur Envoyer. */
export function smsUri(phone: string, body: string): string {
  return `sms:${encodeURIComponent(phone)}?body=${encodeURIComponent(body)}`;
}
