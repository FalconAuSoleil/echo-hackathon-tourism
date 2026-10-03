// Détection des doublons (SPEC 7) : le même message envoyé deux fois est compté une seule fois.
// Deux niveaux : empreinte du texte normalisé (doublon exact, même après une retranscription identique),
// et cosinus entre embeddings des messages entiers (quasi-doublon : ponctuation, un mot de différence).
import { cosine } from "./matcher.ts";
import { words } from "./text.ts";

/** Texte normalisé : minuscules, sans accents ni ponctuation, espaces uniques. */
export function normalizeForFingerprint(text: string): string {
  return words(text).join(" ");
}

/** Hachage 53 bits (cyrb53) en hexadécimal : stable, synchrone, sans dépendance. */
function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

/** Empreinte stable du texte normalisé (minuscules, sans ponctuation ni espaces multiples). Pas le texte. */
export function fingerprint(text: string): string {
  const n = normalizeForFingerprint(text);
  return `${cyrb53(n)}${cyrb53(n, 0x9e3779b9)}`;
}

/** Un message déjà stocké, vu par la détection des doublons (aucun texte). */
export interface KnownMessage {
  fingerprint: string;
  receivedAt?: string;
  embedding?: Float32Array;
}

export interface DuplicateCheck {
  duplicate: boolean;
  reason?: "duplicate_fingerprint" | "duplicate_embedding";
}

function withinWindow(a: string | undefined, b: string | undefined, days: number): boolean {
  if (!a || !b) return true;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return true;
  return Math.abs(ta - tb) <= days * 86_400_000;
}

/** Le message est-il un doublon d'un message connu ? (embedding facultatif : quasi-doublon). */
export function checkDuplicate(
  candidate: { fingerprint: string; receivedAt?: string; embedding?: Float32Array },
  known: readonly KnownMessage[],
  config: { duplicateEmbeddingThreshold: number; duplicateWindowDays: number },
): DuplicateCheck {
  for (const k of known) {
    if (!withinWindow(candidate.receivedAt, k.receivedAt, config.duplicateWindowDays)) continue;
    if (k.fingerprint === candidate.fingerprint) return { duplicate: true, reason: "duplicate_fingerprint" };
  }
  if (candidate.embedding) {
    for (const k of known) {
      if (!k.embedding || !withinWindow(candidate.receivedAt, k.receivedAt, config.duplicateWindowDays)) continue;
      if (cosine(candidate.embedding, k.embedding) >= config.duplicateEmbeddingThreshold) {
        return { duplicate: true, reason: "duplicate_embedding" };
      }
    }
  }
  return { duplicate: false };
}
