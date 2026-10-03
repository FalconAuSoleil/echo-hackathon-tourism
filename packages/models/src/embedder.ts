// Adaptateur EmbedFn (port de @echo/core) au-dessus de transformers.js : mean pooling + normalisation L2.
import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import type { EmbedFn } from "@echo/core";
import { MODELS } from "./registry.ts";

export interface EmbedderOptions {
  /**
   * Taille des lots envoyés au modèle. Défaut 1 : avec la quantification dynamique (q8), l'embedding d'un texte
   * dépend des autres textes du lot (remplissage, plages de quantification) — mesuré : jusqu'à 0,003 de cosinus,
   * assez pour faire basculer une décision près du seuil. Un texte à la fois rend le résultat reproductible.
   */
  batchSize?: number;
  device?: "cpu" | "wasm" | "webgpu";
}

export async function createEmbedder(modelId: string, options: EmbedderOptions = {}): Promise<EmbedFn> {
  const info = MODELS[modelId];
  const prefix = info?.textPrefix ?? "";
  const batchSize = options.batchSize ?? 1;
  const extractor = (await pipeline("feature-extraction", modelId, {
    dtype: "q8",
    ...(options.device ? { device: options.device } : {}),
  })) as FeatureExtractionPipeline;

  return async (texts: string[]) => {
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize).map((t) => prefix + t);
      const tensor = await extractor(batch, { pooling: "mean", normalize: true });
      const [n, dim] = tensor.dims as [number, number];
      const data = tensor.data as Float32Array;
      for (let j = 0; j < n; j++) out.push(data.slice(j * dim, (j + 1) * dim));
    }
    return out;
  };
}
