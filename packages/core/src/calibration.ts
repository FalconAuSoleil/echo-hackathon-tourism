// GÉNÉRÉ par `pnpm eval -- --level 2` (eval/src/level2.ts) le 2026-10-03. Ne pas modifier à la main :
// relancer l'évaluation. Seuils calibrés sur la moitié « calibration » du corpus SYNTHÉTIQUE
// (eval/data/feedback.jsonl), règle fixée d'avance : part des remarques captées maximale sous la contrainte
// « erreur parmi les réponses acceptées ≤ 5 % ». Variante retenue : linear-minilm-l2=0.0001-neg0.
// Calibration : erreur 4.7 %, capture 43.9 %, couverture 30.6 %.
// Partie test réservée : erreur 5.1 %, capture 46.7 %. Détails : eval/results/RESULTS.md.

export const CALIBRATION = {
  scoring: "linear" as "similarity" | "linear",
  acceptProbability: 0.76,
  linearL2: 0.0001,
  linearEpochs: 150,
  negationMargin: 0,
  acceptThreshold: 0.6,
  offListThreshold: 0.57,
  aggregation: "max" as "max" | "topk_mean",
  topK: 3,
  crossLingual: true,
  offListClusterThreshold: 0.58,
  unknownTopicSources: "off_list_and_unsure" as "off_list" | "off_list_and_unsure",
  /** Modèle d'embedding avec lequel ces seuils ont été calibrés (les seuils n'ont de sens qu'avec lui). */
  embeddingModel: "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
  calibratedAt: "2026-10-03",
  catalogExamples: 756,
} as const;
