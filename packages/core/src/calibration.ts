// GÉNÉRÉ par `eval/src/experiments/select.ts --write` (eval/src/level2.ts) le 2026-10-04. Ne pas modifier à la main :
// relancer l'évaluation. Seuils calibrés sur la moitié « calibration » du corpus SYNTHÉTIQUE
// (eval/data/feedback.jsonl), règle : part des remarques captées maximale sous la contrainte
// « erreur parmi les réponses acceptées ≤ 8 % » et négations qui annulent ≥ 100 %. Variante retenue : linear-minilm-l2=0.00003-neg0.
// Calibration : erreur 3.9 %, capture 53.8 %, couverture 36.8 %.
// Partie test réservée : pas encore mesurée avec cette configuration (à faire : pnpm eval -- --level 2).

export const CALIBRATION = {
  scoring: "linear" as "similarity" | "linear",
  acceptProbability: 0.82,
  linearL2: 0.00003,
  linearEpochs: 150,
  negationMargin: 0,
  acceptThreshold: 0.62,
  offListThreshold: 0.62,
  aggregation: "max" as "max" | "topk_mean",
  topK: 3,
  crossLingual: true,
  clauseCommaMinWords: 0,
  clauseCausalSplit: false,
  offListClusterThreshold: 0.57,
  unknownTopicSources: "off_list_and_unsure" as "off_list" | "off_list_and_unsure",
  /** Modèle d'embedding avec lequel ces seuils ont été calibrés (les seuils n'ont de sens qu'avec lui). */
  embeddingModel: "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
  calibratedAt: "2026-10-04",
  catalogExamples: 1260,
} as const;
