// Modèles candidats (vérifiés sur Hugging Face le 2026-10-03, chargés avec transformers.js 4.3 en Node).
// Les fichiers sont servis depuis models/<id>/ (téléchargés par tools/scripts/download-models.mjs).

export type ModelKind = "asr" | "embedding";

export interface ModelInfo {
  id: string;
  kind: ModelKind;
  /** Fichiers ONNX chargés (quantification int8 dynamique, suffixe _quantized = dtype "q8"). */
  onnxFiles: string[];
  /** Taille totale téléchargée (ONNX + tokenizer + configs), en Mo. */
  sizeMB: number;
  license: string;
  source: string;
  /** Préfixe à ajouter aux textes (modèles e5). */
  textPrefix?: string;
}

export const MODELS: Record<string, ModelInfo> = {
  "onnx-community/whisper-tiny": {
    id: "onnx-community/whisper-tiny",
    kind: "asr",
    onnxFiles: ["onnx/encoder_model_quantized.onnx", "onnx/decoder_model_merged_quantized.onnx"],
    sizeMB: 43.6,
    license: "Apache-2.0 (OpenAI Whisper weights: MIT)",
    source: "https://huggingface.co/onnx-community/whisper-tiny",
  },
  "onnx-community/whisper-base": {
    id: "onnx-community/whisper-base",
    kind: "asr",
    onnxFiles: ["onnx/encoder_model_quantized.onnx", "onnx/decoder_model_merged_quantized.onnx"],
    sizeMB: 79.7,
    license: "Apache-2.0 (OpenAI Whisper weights: MIT)",
    source: "https://huggingface.co/onnx-community/whisper-base",
  },
  "onnx-community/whisper-small": {
    id: "onnx-community/whisper-small",
    kind: "asr",
    onnxFiles: ["onnx/encoder_model_quantized.onnx", "onnx/decoder_model_merged_quantized.onnx"],
    sizeMB: 252,
    license: "Apache-2.0 (OpenAI Whisper weights: MIT)",
    source: "https://huggingface.co/onnx-community/whisper-small",
  },
  "Xenova/paraphrase-multilingual-MiniLM-L12-v2": {
    id: "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
    kind: "embedding",
    onnxFiles: ["onnx/model_quantized.onnx"],
    sizeMB: 135.4,
    license: "Apache-2.0",
    source: "https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
  },
  "Xenova/multilingual-e5-small": {
    id: "Xenova/multilingual-e5-small",
    kind: "embedding",
    onnxFiles: ["onnx/model_quantized.onnx"],
    sizeMB: 135.4,
    license: "MIT",
    source: "https://huggingface.co/intfloat/multilingual-e5-small",
    textPrefix: "query: ",
  },
};

/** Choix par défaut du squelette ; l'évaluation (SPEC 9) confirme ou remplace. */
export const DEFAULT_ASR_MODEL = "onnx-community/whisper-base";
export const DEFAULT_EMBEDDING_MODEL = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
