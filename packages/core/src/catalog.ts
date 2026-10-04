// Types et validation du catalogue de constats (SPEC 5). Le fichier source est catalog/catalog.json,
// décrit aussi par catalog/catalog.schema.json. Validation écrite à la main : le cœur n'a aucune dépendance.

import type { FindingId, Polarity, VisitorLang } from "./types.ts";
import { VISITOR_LANGS } from "./types.ts";

export const CATALOG_SCHEMA_VERSION = 1;

export const FINDING_IDS: readonly FindingId[] = [
  "P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10", "P11",
  "N1", "N2", "N3", "N4", "N5", "N6", "N7", "N8", "N9", "N10",
] as const;

/** Emplacements numériques autorisés dans les modèles de phrases, plus {finding} (phrase figée d'un constat). */
export type Slot = "n" | "k" | "x" | "p" | "finding";

/** Une phrase kinyarwanda figée, produite une fois hors ligne (NLLB-200) et vérifiée par rétro-traduction. */
export interface KinyarwandaSentence {
  /** Texte kinyarwanda affiché / envoyé par SMS. Contient les emplacements tels quels, ex. "{k}/{n}". */
  rw: string;
  /** Phrases sources écrites à la main, courtes et simples. */
  source: { fr: string; en: string };
  /** Rétro-traduction kinyarwanda → français (et anglais si produite). */
  backTranslation: { fr?: string; en?: string };
  /** Similarité cosinus source/rétro-traduction (modèle de similarité). null tant que non calculée. */
  similarity: number | null;
  /** Nombre d'itérations de simplification de la source avant d'atteindre le seuil. */
  attempts?: number;
  /** Chemin relatif à catalog/ du fichier audio (MMS-TTS kin), ou null s'il n'existe pas encore. */
  audio: string | null;
  /** Toujours "machine_translated_unvalidated" tant qu'aucun locuteur n'a validé. */
  status: "machine_translated_unvalidated" | "speaker_validated";
}

export interface Finding {
  id: FindingId;
  labels: { fr: string; en: string };
  polarity: Polarity;
  /** 5 à 10 formulations par langue visiteur, rédigées pour le projet : toujours synthétiques. */
  examples: Record<VisitorLang, string[]>;
  examplesSynthetic: true;
  /** Listes de mots-clés de la méthode de comparaison sans IA (SPEC 9). */
  keywords: Record<VisitorLang, string[]>;
  /** Phrase kinyarwanda du constat, insérée dans {finding} des lignes du récap. null avant génération. */
  kinyarwanda: KinyarwandaSentence | null;
}

export type RecapTemplateId =
  | "volume" // « Ce mois-ci : {n} retours. »
  | "keep" // « À garder : {finding} ({k} sur {n}). »
  | "fix" // « À corriger en priorité : {finding} ({k} sur {n}). »
  | "fix_streak" // « À corriger en priorité : {finding} ({k} sur {n}), {x}e mois de suite. »
  | "nothing_urgent" // « Rien d'urgent à corriger. »
  | "unknown_topic" // « Un sujet que l'outil ne connaît pas revient chez {k} visiteurs : demandez à une personne de lire ces remarques. »
  | "not_understood" // « {p} remarques pas comprises : demandez à une personne. »
  | "no_feedback"; // « Pas de retour ce mois-ci. »

export const RECAP_TEMPLATE_IDS: readonly RecapTemplateId[] = [
  "volume", "keep", "fix", "fix_streak", "nothing_urgent", "unknown_topic", "not_understood", "no_feedback",
] as const;

export interface RecapTemplate {
  id: RecapTemplateId;
  slots: Slot[];
  kinyarwanda: KinyarwandaSentence;
  /**
   * Optionnel : clips audio des parties fixes de `kinyarwanda.rw`, découpées aux emplacements
   * (longueur = nombre d'emplacements dans rw + 1 ; null pour une partie vide). Le récap audio enchaîne
   * partie, clip de l'emplacement (nombre ou constat), partie... Sans ce champ, `kinyarwanda.audio`
   * est lu seul (les chiffres sont alors seulement affichés).
   */
  audioParts?: (string | null)[];
}

export interface CatalogProvenance {
  examples: "synthetic";
  kinyarwanda: {
    disclaimer: string; // « traduction automatique, non validée par un locuteur »
    mtModel: string | null; // ex. "facebook/nllb-200-distilled-600M"
    similarityModel: string | null;
    ttsModel: string | null; // ex. "facebook/mms-tts-kin"
    ttsLicense: string | null; // ex. "CC-BY-NC 4.0"
    floresReference: { metric: string; value: number; source: string } | null;
    acceptThreshold: number | null; // seuil de similarité de rétro-traduction retenu
  };
}

export interface Catalog {
  schemaVersion: number;
  version: string;
  provenance: CatalogProvenance;
  languages: VisitorLang[];
  findings: Finding[];
  templates: RecapTemplate[];
  /** Optionnel : clips audio des nombres pour lire le récap (clé = nombre en chiffres). */
  numbers?: Record<string, { rw: string; audio: string | null }>;
  /** Optionnel : libellés figés de l'app hôte (mode A), traduits hors ligne comme les phrases du récap. */
  ui?: UiLabel[];
}

export type UiLabelId = "listen" | "send_sms" | "analyse" | "recap_month" | "delete_whatsapp" | "deleted";
export const UI_LABEL_IDS: readonly UiLabelId[] = ["listen", "send_sms", "analyse", "recap_month", "delete_whatsapp", "deleted"];

export interface UiLabel {
  id: UiLabelId;
  /** Seul emplacement permis : {n} (un nombre en chiffres). */
  slots: "n"[];
  kinyarwanda: KinyarwandaSentence;
}

export class CatalogError extends Error {}

/** Vérifie la forme du catalogue et les règles simples (21 constats, emplacements intacts). */
export function validateCatalog(raw: unknown): Catalog {
  const errors: string[] = [];
  const c = raw as Partial<Catalog>;
  if (!c || typeof c !== "object") throw new CatalogError("catalog is not an object");
  if (c.schemaVersion !== CATALOG_SCHEMA_VERSION) errors.push(`schemaVersion must be ${CATALOG_SCHEMA_VERSION}`);
  if (!Array.isArray(c.findings)) errors.push("findings must be an array");
  if (!Array.isArray(c.templates)) errors.push("templates must be an array");
  const seen = new Set<string>();
  for (const f of c.findings ?? []) {
    if (!FINDING_IDS.includes(f.id)) errors.push(`unknown finding id ${String(f.id)}`);
    if (seen.has(f.id)) errors.push(`duplicate finding id ${f.id}`);
    seen.add(f.id);
    const expected: Polarity = f.id.startsWith("P") ? "positive" : "negative";
    if (f.polarity !== expected) errors.push(`${f.id}: polarity must be ${expected}`);
    if (!f.labels?.fr || !f.labels?.en) errors.push(`${f.id}: labels.fr and labels.en are required`);
    if (f.examplesSynthetic !== true) errors.push(`${f.id}: examplesSynthetic must be true`);
    for (const lang of VISITOR_LANGS) {
      if (!Array.isArray(f.examples?.[lang])) errors.push(`${f.id}: examples.${lang} must be an array`);
      if (!Array.isArray(f.keywords?.[lang])) errors.push(`${f.id}: keywords.${lang} must be an array`);
    }
  }
  for (const id of FINDING_IDS) if (!seen.has(id)) errors.push(`missing finding ${id}`);
  for (const t of c.templates ?? []) {
    if (!RECAP_TEMPLATE_IDS.includes(t.id)) errors.push(`unknown template id ${String(t.id)}`);
    const rw = t.kinyarwanda?.rw ?? "";
    for (const s of t.slots ?? []) {
      if (rw && !rw.includes(`{${s}}`)) errors.push(`template ${t.id}: slot {${s}} missing in kinyarwanda`);
    }
    if (t.audioParts !== undefined) {
      const occurrences = (rw.match(/\{(n|k|x|p|finding)\}/g) ?? []).length;
      if (!Array.isArray(t.audioParts) || t.audioParts.length !== occurrences + 1) {
        errors.push(`template ${t.id}: audioParts must have ${occurrences + 1} entries`);
      }
    }
  }
  for (const u of c.ui ?? []) {
    if (!UI_LABEL_IDS.includes(u.id)) errors.push(`unknown ui label id ${String(u.id)}`);
    const rw = u.kinyarwanda?.rw ?? "";
    if (!rw) errors.push(`ui ${u.id}: empty kinyarwanda`);
    const found = rw.match(/\{(n|k|x|p|finding)\}/g) ?? [];
    if (found.length !== (u.slots ?? []).length || (u.slots ?? []).some((s) => !rw.includes(`{${s}}`))) {
      errors.push(`ui ${u.id}: slots in kinyarwanda must match ${JSON.stringify(u.slots)}`);
    }
  }
  if (errors.length) throw new CatalogError(`invalid catalog:\n- ${errors.join("\n- ")}`);
  return c as Catalog;
}

/** Libellé figé de l'app hôte (kinyarwanda, emplacement {n} rempli en chiffres), ou null s'il est absent. */
export function uiLabel(catalog: Catalog, id: UiLabelId, n?: number): string | null {
  const u = catalog.ui?.find((x) => x.id === id);
  if (!u) return null;
  return fillSlots(u.kinyarwanda.rw, n === undefined ? {} : { n });
}

/** Remplit les emplacements {n},{k},{x},{p},{finding} d'une phrase figée. Aucun autre texte n'est produit. */
export function fillSlots(template: string, values: Partial<Record<Slot, string | number>>): string {
  return template.replace(/\{(n|k|x|p|finding)\}/g, (m, s: Slot) => {
    const v = values[s];
    if (v === undefined) throw new CatalogError(`missing value for slot {${s}}`);
    return String(v);
  });
}
