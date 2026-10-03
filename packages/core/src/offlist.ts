// Regroupement des morceaux « hors liste » par sens (SPEC 4.5).
import type { AnalysisConfig } from "./config.ts";
import { notImplemented } from "./not-implemented.ts";

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
  /** distinctVisitors ≥ offListMinVisitors : signalé dans le récap, sans jamais nommer le sujet. */
  recurring: boolean;
}

export function clusterOffList(
  items: OffListItem[],
  config: Pick<AnalysisConfig, "offListClusterThreshold" | "offListMinVisitors">,
): OffListCluster[] {
  void items; void config;
  return notImplemented("clusterOffList");
}
