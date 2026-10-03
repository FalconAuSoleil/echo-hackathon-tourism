// Petits outils de texte partagés (aucune dépendance, déterministes).

/** Minuscules, sans diacritiques (é → e, ß → ss, ñ → n), apostrophes typographiques unifiées. */
export function fold(text: string): string {
  return text
    .replace(/[‘’ʼ`´]/g, "'")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "");
}

/** Mots (lettres, chiffres, apostrophes internes) du texte replié. */
export function words(text: string): string[] {
  return fold(text).match(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu) ?? [];
}

/** Échappe une chaîne pour l'insérer dans une expression régulière. */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const L = "\\p{L}\\p{N}";

/**
 * Expression qui trouve une liste de mots ou locutions, en mots entiers (frontières Unicode).
 * Un terme finissant par "*" est un préfixe (« explic* »). Les termes doivent être déjà repliés si
 * l'on cherche dans un texte replié.
 */
export function wordListRegExp(terms: readonly string[], flags = "gu"): RegExp | null {
  const parts = terms
    .filter((t) => t.trim().length > 0)
    .sort((a, b) => b.length - a.length)
    .map((t) => {
      const prefix = t.endsWith("*");
      const core = escapeRegExp((prefix ? t.slice(0, -1) : t).trim()).replace(/\s+/g, "\\s+");
      return prefix ? `${core}[${L}]*` : core;
    });
  if (parts.length === 0) return null;
  return new RegExp(`(?<![${L}])(?:${parts.join("|")})(?![${L}])`, flags);
}
