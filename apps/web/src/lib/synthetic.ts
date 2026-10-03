// Données SYNTHÉTIQUES de la démo, écrites à la main et affichées avec le badge « synthetic » :
//   - 3 mois d'historique d'une ferme (listes de constats par message, pas de texte : ce n'est pas passé
//     par les modèles), pour montrer les tendances et le « {x} mois de suite » ;
//   - 11 fermes fictives d'une coopérative, pour la vue coopérative.
// Rien de tout cela ne vient de vrais visiteurs.
import type { CoopFarmInput, FindingId, MonthMessage } from "@echo/core";
import { addMonths } from "./recap-service.ts";

type Row = [FindingId[], number?]; // constats du message, nombre de morceaux « pas sûr »

/** Historique fictif : le chemin (N1) revient chaque mois, les prix (N2) baissent après correction, la torréfaction (P3) monte. */
const HISTORY: Row[][] = [
  // mois -3
  [[["P1", "N1"]], [["P2", "N2"]], [["P1", "P4"]], [["N2", "P11"], 1], [["P5"]], [["N1"]]],
  // mois -2
  [[["P1", "P3"]], [["N1", "N8"]], [["P3"]], [["N2"]], [["P4", "N1"], 1], [["P10"]], [["P7"]]],
  // mois -1
  [[["P3", "P9"]], [["P3", "N1"]], [["P1"]], [["N1", "P11"]], [["P3", "P10"]], [[], 2]],
];

export const SYNTHETIC_FARM_COUNT = 11;

export function syntheticHistory(currentMonth: string): MonthMessage[] {
  const out: MonthMessage[] = [];
  HISTORY.forEach((rows, i) => {
    const month = addMonths(currentMonth, i - HISTORY.length);
    rows.forEach(([findings, notSure], j) => {
      out.push({ id: `synthetic-${month}-${j}`, month, status: findings.length || !notSure ? "analyzed" : "not_sure", findings, notSureCount: notSure ?? 0 });
    });
  });
  return out;
}

/** Petit générateur pseudo-aléatoire déterministe (mulberry32) : les fermes fictives sont toujours les mêmes. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Probabilité qu'un message d'une ferme fictive cite le constat (torréfaction appréciée partout, chemin trop long dans 5 fermes…). */
const FINDING_RATES: Partial<Record<FindingId, number>> = {
  P1: 0.35, P2: 0.2, P3: 0.45, P4: 0.15, P5: 0.15, P6: 0.12, P7: 0.15, P9: 0.12, P10: 0.1, P11: 0.25,
  N2: 0.08, N3: 0.04, N5: 0.06, N7: 0.04, N8: 0.06, N9: 0.05, N10: 0.07,
};
const PATH_FARMS = new Set([1, 3, 4, 7, 9]); // le chemin trop long ne concerne que ces fermes fictives

export function syntheticCoopFarms(currentMonth: string): CoopFarmInput[] {
  const months = [addMonths(currentMonth, -2), addMonths(currentMonth, -1), currentMonth];
  const farms: CoopFarmInput[] = [];
  for (let f = 1; f <= SYNTHETIC_FARM_COUNT; f++) {
    const r = rng(1000 + f);
    const messages: CoopFarmInput["messages"] = [];
    for (const month of months) {
      const n = 3 + Math.floor(r() * 5);
      for (let k = 0; k < n; k++) {
        const ids = (Object.entries(FINDING_RATES) as [FindingId, number][]).filter(([, p]) => r() < p).map(([id]) => id);
        if (PATH_FARMS.has(f) && r() < 0.4) ids.push("N1");
        messages.push({ month, status: "analyzed", coopFindings: ids.slice(0, 3) });
      }
    }
    farms.push({ farmId: `synthetic-farm-${f}`, consent: true, messages });
  }
  return farms;
}
