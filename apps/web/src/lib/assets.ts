// Données statiques servies par l'app (catalogue figé, manifeste des modèles, mots-clés, échantillons).
import { keywordListsFromFiles, validateCatalog, type Catalog, type KeywordFile, type KeywordLists } from "@echo/core";
import type { AssetsManifest } from "../worker/protocol.ts";

export interface DemoSample {
  id: string;
  file: string;
  lang: string;
  transcript: string;
  synthetic: boolean;
  voice: { engine: string; model: string; license: string; dataset?: string };
  durationSec: number;
  expected: { status: string; findings: string[]; notSure: boolean; note: string };
}

export interface StaticData {
  catalog: Catalog;
  manifest: AssetsManifest;
  keywords: KeywordLists;
  samples: DemoSample[];
}

let promise: Promise<StaticData> | null = null;

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export function loadStatic(): Promise<StaticData> {
  if (!promise) {
    promise = (async () => {
      const [rawCatalog, manifest, samplesManifest] = await Promise.all([
        json<unknown>("/catalog/catalog.json"),
        json<AssetsManifest>("/assets-manifest.json"),
        json<{ samples: DemoSample[] }>("/samples/manifest.json"),
      ]);
      const kwFiles = await Promise.all(manifest.keywords.map((u) => json<KeywordFile>(u)));
      return { catalog: validateCatalog(rawCatalog), manifest, keywords: keywordListsFromFiles(kwFiles), samples: samplesManifest.samples };
    })();
    promise.catch(() => (promise = null));
  }
  return promise;
}

export function findingLabel(catalog: Catalog, id: string, lang: "en" | "fr" = "en"): string {
  return catalog.findings.find((f) => f.id === id)?.labels[lang] ?? id;
}

export function findingPolarity(catalog: Catalog, id: string): "positive" | "negative" | undefined {
  return catalog.findings.find((f) => f.id === id)?.polarity;
}

export const LANG_NAMES: Record<string, string> = { en: "English", fr: "French", de: "German", es: "Spanish", sw: "Swahili", unknown: "unknown" };
export const langName = (code: string): string => LANG_NAMES[code] ?? code;
