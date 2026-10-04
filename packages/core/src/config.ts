// Paramètres d'analyse. Les seuils par défaut viennent de calibration.ts, GÉNÉRÉ par l'évaluation
// (`pnpm eval -- --level 2`, SPEC 9) : l'app lit DEFAULT_CONFIG, donc les seuils mesurés sont ceux livrés.
import { CALIBRATION } from "./calibration.ts";

export interface AnalysisConfig {
  /**
   * Comment un morceau est rattaché à un constat :
   * - "similarity" : score = cosinus max (ou top-k) avec les exemples du constat, accepté si ≥ acceptThreshold ;
   * - "linear" : régression logistique entraînée sur les embeddings des exemples du catalogue, acceptée si la
   *   probabilité ≥ acceptProbability (meilleure calibration mesurée, voir eval/results/RESULTS.md).
   * Dans les deux cas : plancher « hors liste » (cosinus) et accord de négation identiques.
   */
  scoring: "similarity" | "linear";
  /** Mode "linear" : probabilité minimale du constat pour l'accepter. */
  acceptProbability: number;
  /** Mode "linear" : pénalité L2 et nombre d'époques de l'entraînement (sur les exemples du catalogue). */
  linearL2: number;
  linearEpochs: number;
  /**
   * Mode "linear" : accord de négation toléré à cette marge près (cosinus). 0 = règle stricte (les exemples de
   * même négation doivent être au moins aussi proches que ceux de négation opposée). Négatif = encore plus strict
   * (ils doivent l'emporter d'au moins |marge|). Calibré par l'évaluation sous contrainte : les négations qui
   * annulent un constat ne doivent pas passer plus souvent ; une marge positive (relâchée) n'est jamais retenue.
   */
  negationMargin: number;
  /** Mode "similarity" : score ≥ acceptThreshold : le morceau est rattaché au constat. */
  acceptThreshold: number;
  /** Score < offListThreshold pour tous les constats : « hors liste ». Entre les deux : « pas sûr ». */
  offListThreshold: number;
  /**
   * Découpage (SPEC 4.3 étape 4) : virgule seule entre deux propositions d'au moins N mots chacune (0 = jamais),
   * et coupure sur les connecteurs de cause / conséquence. Choisis sur la moitié calibration (eval/results/experiments/).
   */
  clauseCommaMinWords: number;
  clauseCausalSplit: boolean;
  /** Au plus 2 constats par morceau (SPEC 4.3). */
  maxFindingsPerChunk: number;
  /** Écart max entre le 1er et le 2e score pour retenir aussi le 2e constat. */
  secondFindingMargin: number;
  /** Score d'un constat : similarité max avec ses exemples, ou moyenne des k meilleures. */
  aggregation: "max" | "topk_mean";
  /** k pour aggregation = "topk_mean". */
  topK: number;
  /**
   * true : compare à tous les exemples, toutes langues confondues (modèle multilingue).
   * false : seulement aux exemples de la langue détectée quand le constat en a.
   */
  crossLingual: boolean;
  /** Confiance de transcription sous laquelle tout le message passe en « pas sûr ». */
  minTranscriptConfidence: number;
  /** Confiance si basse que le message est traité comme trop bruité : « inaudible » (SPEC 7). */
  inaudibleConfidence: number;
  /** Probabilité de langue sous laquelle tout le message passe en « pas sûr ». */
  minLanguageProbability: number;
  /** Message audio plus court : « inaudible » (SPEC 7). */
  minAudioSeconds: number;
  /** Énergie RMS sous laquelle l'audio est considéré comme silence. */
  minAudioRms: number;
  /**
   * Écart (dB) entre trames fortes (90e centile) et trames faibles (10e centile) sous lequel l'audio
   * est un bruit continu sans parole distincte : « inaudible ». 0 désactive la règle.
   */
  minAudioDynamicRangeDb: number;
  /** Langues traitées ; une autre langue détectée met le message en « pas sûr ». */
  supportedLangs: string[];
  /** Regroupement hors liste : similarité moyenne min pour fusionner deux groupes (dépend du modèle d'embedding). */
  offListClusterThreshold: number;
  /** Morceaux regroupés pour le signal « sujet inconnu qui revient » (voir unknownTopicItems). */
  unknownTopicSources: "off_list" | "off_list_and_unsure";
  /** Nombre de visiteurs distincts pour signaler un sujet inconnu qui revient (SPEC 4.5). */
  offListMinVisitors: number;
  /** Cosinus entre messages entiers au-dessus duquel c'est un quasi-doublon. */
  duplicateEmbeddingThreshold: number;
  /** Fenêtre (jours) dans laquelle un message identique est un doublon, quand les deux dates sont connues. */
  duplicateWindowDays: number;
}

export const DEFAULT_CONFIG: AnalysisConfig = {
  scoring: CALIBRATION.scoring,
  acceptProbability: CALIBRATION.acceptProbability,
  linearL2: CALIBRATION.linearL2,
  linearEpochs: CALIBRATION.linearEpochs,
  negationMargin: CALIBRATION.negationMargin,
  acceptThreshold: CALIBRATION.acceptThreshold,
  offListThreshold: CALIBRATION.offListThreshold,
  clauseCommaMinWords: CALIBRATION.clauseCommaMinWords,
  clauseCausalSplit: CALIBRATION.clauseCausalSplit,
  maxFindingsPerChunk: 2,
  secondFindingMargin: 0.08,
  aggregation: CALIBRATION.aggregation,
  topK: CALIBRATION.topK,
  crossLingual: CALIBRATION.crossLingual,
  minTranscriptConfidence: 0.45,
  inaudibleConfidence: 0.2,
  minLanguageProbability: 0.5,
  minAudioSeconds: 3,
  minAudioRms: 0.005,
  minAudioDynamicRangeDb: 3,
  supportedLangs: ["en", "fr", "de", "es"],
  offListClusterThreshold: CALIBRATION.offListClusterThreshold,
  unknownTopicSources: CALIBRATION.unknownTopicSources,
  offListMinVisitors: 3,
  duplicateEmbeddingThreshold: 0.98,
  duplicateWindowDays: 7,
};

/** Configuration complète à partir de surcharges partielles (ex. seuils calibrés gardés dans les réglages). */
export function makeConfig(overrides: Partial<AnalysisConfig> = {}): AnalysisConfig {
  const c = { ...DEFAULT_CONFIG, ...overrides };
  if (c.scoring === "similarity" && !(c.offListThreshold <= c.acceptThreshold)) throw new Error("offListThreshold must be <= acceptThreshold");
  if (!(c.acceptProbability > 0 && c.acceptProbability <= 1)) throw new Error("acceptProbability must be in (0, 1]");
  if (c.maxFindingsPerChunk < 1 || c.maxFindingsPerChunk > 2) throw new Error("maxFindingsPerChunk must be 1 or 2");
  if (c.topK < 1) throw new Error("topK must be >= 1");
  return c;
}
