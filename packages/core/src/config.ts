// Paramètres d'analyse. Les seuils par défaut sont provisoires : l'évaluation (SPEC 9) les calibre
// et la valeur retenue est recopiée ici avec sa justification (docs/PROGRESS.md, README).

export interface AnalysisConfig {
  /** Score ≥ acceptThreshold : le morceau est rattaché au constat. */
  acceptThreshold: number;
  /** Score < offListThreshold pour tous les constats : « hors liste ». Entre les deux : « pas sûr ». */
  offListThreshold: number;
  /** Au plus 2 constats par morceau (SPEC 4.3). */
  maxFindingsPerChunk: number;
  /** Écart max entre le 1er et le 2e score pour retenir aussi le 2e constat. */
  secondFindingMargin: number;
  /** Confiance de transcription sous laquelle tout le message passe en « pas sûr ». */
  minTranscriptConfidence: number;
  /** Probabilité de langue sous laquelle tout le message passe en « pas sûr ». */
  minLanguageProbability: number;
  /** Message audio plus court : « inaudible » (SPEC 7). */
  minAudioSeconds: number;
  /** Énergie RMS sous laquelle l'audio est considéré comme silence. */
  minAudioRms: number;
  /** Langues traitées ; une autre langue détectée met le message en « pas sûr ». */
  supportedLangs: string[];
  /** Regroupement hors liste : similarité min pour rejoindre un groupe. */
  offListClusterThreshold: number;
  /** Nombre de visiteurs distincts pour signaler un sujet inconnu qui revient (SPEC 4.5). */
  offListMinVisitors: number;
}

export const DEFAULT_CONFIG: AnalysisConfig = {
  acceptThreshold: 0.6,
  offListThreshold: 0.4,
  maxFindingsPerChunk: 2,
  secondFindingMargin: 0.08,
  minTranscriptConfidence: 0.45,
  minLanguageProbability: 0.5,
  minAudioSeconds: 3,
  minAudioRms: 0.005,
  supportedLangs: ["en", "fr", "de", "es"],
  offListClusterThreshold: 0.55,
  offListMinVisitors: 3,
};
