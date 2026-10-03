// Vue coopérative (SPEC 4.7) : tendances anonymes par constat, pour les fermes qui ont donné leur accord.
// Entrée réduite à des identifiants de constats : aucun texte ne peut y entrer, et seuls les constats
// appuyés hors morceaux « guide » (coopFindings) sont comptés.
import type { Catalog } from "./catalog.ts";
import type { FindingId, MessageStatus, Polarity } from "./types.ts";

export interface CoopFarmInput {
  farmId: string;
  /** Accord de l'hôte pour partager ses chiffres. Sans accord, la ferme est ignorée (ni comptée, ni totalisée). */
  consent: boolean;
  messages: { month: string; status: MessageStatus; coopFindings: readonly FindingId[] }[];
}

export interface CoopFindingTrend {
  id: FindingId;
  polarity: Polarity;
  /** Fermes (avec accord) où le constat apparaît au moins une fois. */
  farms: number;
  /** Messages qui le citent, toutes fermes confondues. */
  mentions: number;
}

export interface CoopAggregate {
  /** Nombre de fermes avec accord (le « sur 12 » de « 5 fermes sur 12 »). */
  consentingFarms: number;
  /** Messages comptés (hors doublons et inaudibles). */
  messages: number;
  findings: CoopFindingTrend[];
}

/** Agrège les constats des fermes consentantes ; `months` limite la période (tous les mois sinon). */
export function aggregateCooperative(
  farms: readonly CoopFarmInput[],
  catalog: Pick<Catalog, "findings">,
  options: { months?: readonly string[] } = {},
): CoopAggregate {
  const months = options.months ? new Set(options.months) : null;
  const consenting = farms.filter((f) => f.consent === true);
  const farmsPer = new Map<FindingId, Set<string>>();
  const mentions = new Map<FindingId, number>();
  let messages = 0;
  for (const farm of consenting) {
    for (const m of farm.messages) {
      if (m.status === "duplicate" || m.status === "inaudible") continue;
      if (months && !months.has(m.month)) continue;
      messages++;
      for (const id of new Set(m.coopFindings)) {
        mentions.set(id, (mentions.get(id) ?? 0) + 1);
        const s = farmsPer.get(id) ?? new Set<string>();
        s.add(farm.farmId);
        farmsPer.set(id, s);
      }
    }
  }
  const findings = catalog.findings
    .filter((f) => mentions.has(f.id))
    .map((f) => ({ id: f.id, polarity: f.polarity, farms: farmsPer.get(f.id)!.size, mentions: mentions.get(f.id)! }))
    .sort((a, b) => b.farms - a.farms || b.mentions - a.mentions);
  return { consentingFarms: new Set(consenting.map((f) => f.farmId)).size, messages, findings };
}
