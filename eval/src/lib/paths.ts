// Chemins du dépôt utilisés par l'évaluation.
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const MODELS_DIR = join(ROOT, "models");
export const RESULTS_DIR = join(ROOT, "eval", "results");
export const RAW_DIR = join(RESULTS_DIR, "raw"); // git-ignoré : transcriptions en cache, sorties détaillées
export const DATA_DIR = join(ROOT, "eval", "data");
export const FLEURS_DIR = join(ROOT, "datasets", "fleurs");
export const CATALOG_PATH = join(ROOT, "catalog", "catalog.json");
export const KEYWORDS_DIR = join(ROOT, "eval", "keywords");

export const abs = (p: string): string => (p.startsWith("/") ? p : join(ROOT, p));
