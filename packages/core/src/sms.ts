// SMS : texte sûr en GSM-7 et découpage en SMS courts (SPEC 4.6). Envoi réel via l'URI sms: côté app.
import { notImplemented } from "./not-implemented.ts";

export const SMS_SINGLE_GSM7 = 160;
export const SMS_PART_GSM7 = 153;

/** Vrai si tous les caractères sont dans l'alphabet GSM 03.38 (table de base + extension). */
export function isGsm7(text: string): boolean {
  void text;
  return notImplemented("isGsm7");
}

/** Remplace les caractères hors GSM-7 (guillemets typographiques, tirets longs, accents rares) par des équivalents. */
export function toGsm7(text: string): string {
  void text;
  return notImplemented("toGsm7");
}

/** Découpe les lignes du récap en SMS d'au plus `maxLen` caractères GSM-7, sans couper une ligne si possible. */
export function splitSms(lines: string[], maxLen: number = SMS_SINGLE_GSM7): string[] {
  void lines; void maxLen;
  return notImplemented("splitSms");
}

/** URI sms: qui ouvre l'application SMS préremplie ; un humain appuie sur Envoyer. */
export function smsUri(phone: string, body: string): string {
  return `sms:${encodeURIComponent(phone)}?body=${encodeURIComponent(body)}`;
}
