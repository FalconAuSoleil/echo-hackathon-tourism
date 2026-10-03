// Regroupement des morceaux « hors liste » par sens (SPEC 4.5). Regroupement agglomératif à liaison
// moyenne sur les embeddings : deux groupes fusionnent tant que leur similarité moyenne dépasse le seuil.
// Le sujet n'est jamais nommé : seul le nombre de visiteurs distincts sort d'ici.
import type { AnalysisConfig } from "./config.ts";
import { cosine } from "./matcher.ts";
import type { MessageAnalysis } from "./types.ts";

export interface OffListItem {
  chunkId: string;
  /** Clé visiteur : l'identifiant du message (le numéro n'est jamais stocké ; doublons déjà retirés). */
  visitorKey: string;
  month: string;
  text: string;
  embedding: Float32Array;
}

export interface OffListCluster {
  id: string;
  chunkIds: string[];
  distinctVisitors: number;
  months: string[];
  /** distinctVisitors ≥ offListMinVisitors : signalé dans le récap, sans jamais nommer le sujet. */
  recurring: boolean;
}

export function clusterOffList(
  items: OffListItem[],
  config: Pick<AnalysisConfig, "offListClusterThreshold" | "offListMinVisitors">,
): OffListCluster[] {
  const n = items.length;
  if (n === 0) return [];
  // Matrice de similarité, puis fusions successives de la meilleure paire (liaison moyenne).
  const sim: number[][] = items.map((a, i) => items.map((b, j) => (i === j ? 1 : cosine(a.embedding, b.embedding))));
  let groups: number[][] = items.map((_, i) => [i]);
  const avg = (g: number[], h: number[]): number => {
    let s = 0;
    for (const i of g) for (const j of h) s += sim[i]![j]!;
    return s / (g.length * h.length);
  };
  for (;;) {
    let best = -Infinity;
    let bi = -1;
    let bj = -1;
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const s = avg(groups[i]!, groups[j]!);
        if (s > best) {
          best = s;
          bi = i;
          bj = j;
        }
      }
    }
    if (bi < 0 || best < config.offListClusterThreshold) break;
    const merged = [...groups[bi]!, ...groups[bj]!].sort((a, b) => a - b);
    groups = groups.filter((_, k) => k !== bi && k !== bj);
    groups.push(merged);
  }
  return groups
    .map((g) => g.sort((a, b) => a - b))
    .sort((a, b) => a[0]! - b[0]!)
    .map((g) => {
      const members = g.map((i) => items[i]!);
      const distinctVisitors = new Set(members.map((m) => m.visitorKey)).size;
      return {
        id: `offlist:${members[0]!.chunkId}`,
        chunkIds: members.map((m) => m.chunkId),
        distinctVisitors,
        months: [...new Set(members.map((m) => m.month))].sort(),
        recurring: distinctVisitors >= config.offListMinVisitors,
      };
    })
    .sort((a, b) => b.distinctVisitors - a.distinctVisitors || a.id.localeCompare(b.id));
}

/** Nombre de visiteurs du plus grand sujet inconnu récurrent (0 s'il n'y en a pas) : entrée du récap. */
export function recurringUnknownVisitors(clusters: readonly OffListCluster[]): number {
  return Math.max(0, ...clusters.filter((c) => c.recurring).map((c) => c.distinctVisitors));
}

/**
 * Morceaux candidats au signal « sujet inconnu qui revient », pris dans des messages déjà analysés
 * (doublons et inaudibles exclus) :
 * - "off_list" : seulement les morceaux « hors liste » (lecture littérale de SPEC 4.5) ;
 * - "off_list_and_unsure" : aussi les « pas sûr » dont aucun constat n'a atteint le seuil (raison
 *   "below_threshold"), mais jamais ceux mis en « pas sûr » par une négation ni par un message entier peu
 *   fiable. Mesure (eval/results/RESULTS.md) : un sujet nouveau mais proche du catalogue (la cueillette,
 *   proche de « visite des caféiers ») passe en « pas sûr », pas en « hors liste » ; sans cette option le
 *   signal ne se déclenche pas.
 */
export function unknownTopicItems(
  analyses: readonly MessageAnalysis[],
  sources: AnalysisConfig["unknownTopicSources"],
): OffListItem[] {
  const out: OffListItem[] = [];
  for (const a of analyses) {
    if (a.status !== "analyzed") continue;
    for (const c of a.chunks) {
      if (!c.embedding) continue;
      const take = c.status === "off_list" || (sources === "off_list_and_unsure" && c.status === "not_sure" && c.reason === "below_threshold");
      if (take) out.push({ chunkId: c.id, visitorKey: a.id, month: a.month, text: c.text, embedding: c.embedding });
    }
  }
  return out;
}
