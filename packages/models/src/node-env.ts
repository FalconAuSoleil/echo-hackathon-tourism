// Configuration Node : modèles lus uniquement depuis models/ du dépôt, jamais depuis le hub.
import { env } from "@huggingface/transformers";

export function useLocalModels(modelsDir: string): void {
  env.localModelPath = modelsDir.endsWith("/") ? modelsDir : `${modelsDir}/`;
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
}
