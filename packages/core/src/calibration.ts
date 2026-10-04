// GÉNÉRÉ par `pnpm eval -- --level 2` (eval/src/level2.ts) le 2026-10-04. Ne pas modifier à la main :
// relancer l'évaluation. Seuils calibrés sur la moitié « calibration » du corpus SYNTHÉTIQUE
// (eval/data/feedback.jsonl), règle : part des remarques captées maximale sous la contrainte
// « erreur parmi les réponses acceptées ≤ 5 % » et négations qui annulent ≥ 85 %. Variante retenue : linear-minilm-l2=0.00003-neg0.
// Calibration : erreur 4.5 %, capture 46.2 %, couverture 32.1 %.
// Partie test réservée : erreur 6.0 %, capture 48.0 %. Détails : eval/results/RESULTS.md.

export const CALIBRATION = {
  scoring: "linear" as "similarity" | "linear",
  acceptProbability: 0.84,
  linearL2: 0.00003,
  linearEpochs: 150,
  negationMargin: 0,
  acceptThreshold: 0.6,
  offListThreshold: 0.59,
  aggregation: "max" as "max" | "topk_mean",
  topK: 3,
  crossLingual: true,
  offListClusterThreshold: 0.59,
  unknownTopicSources: "off_list_and_unsure" as "off_list" | "off_list_and_unsure",
  /** Modèle d'embedding avec lequel ces seuils ont été calibrés (les seuils n'ont de sens qu'avec lui). */
  embeddingModel: "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
  calibratedAt: "2026-10-04",
  catalogExamples: 756,
} as const;
