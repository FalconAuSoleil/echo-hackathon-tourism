// Récap mensuel (SPEC 4.6) construit UNIQUEMENT à partir des phrases kinyarwanda figées du catalogue.
import type { Catalog, RecapTemplateId, Slot } from "./catalog.ts";
import type { FindingId, MessageStatus } from "./types.ts";
import { notImplemented } from "./not-implemented.ts";

/** Résumé d'un message tel qu'il est stocké (SPEC 6). */
export interface MonthMessage {
  id: string;
  month: string;
  status: MessageStatus;
  findings: FindingId[];
  /** Nombre de morceaux « pas sûr » de ce message. */
  notSureCount: number;
}

export interface RecapInput {
  month: string; // "YYYY-MM"
  /** Messages de tous les mois connus (le mois courant et l'historique, pour « {x}e mois de suite »). */
  messages: MonthMessage[];
  /** Plus grand groupe hors liste récurrent du mois (visiteurs distincts), ou 0. */
  recurringUnknownVisitors: number;
}

export interface RecapLine {
  templateId: RecapTemplateId;
  findingId?: FindingId;
  slots: Partial<Record<Slot, number>>;
  /** Texte kinyarwanda final (phrases figées + chiffres). */
  rw: string;
  /** Gloses pour la démo (à partir des sources fr/en figées), jamais montrées à l'hôte comme traduction libre. */
  fr: string;
  en: string;
  /** Fichiers audio à enchaîner pour la lecture (relatifs à catalog/). */
  audio: string[];
}

export interface Recap {
  month: string;
  lines: RecapLine[]; // au plus 5
}

export function buildMonthlyRecap(input: RecapInput, catalog: Catalog): Recap {
  void input; void catalog;
  return notImplemented("buildMonthlyRecap");
}
