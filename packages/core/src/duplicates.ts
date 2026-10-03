// Détection des doublons (SPEC 7) : le même message envoyé deux fois est compté une seule fois.
import { notImplemented } from "./not-implemented.ts";

/** Empreinte stable du texte normalisé (minuscules, sans ponctuation ni espaces multiples). */
export function fingerprint(text: string): string {
  void text;
  return notImplemented("fingerprint");
}
