// Corpus synthétique (eval/data/feedback.jsonl) et partage calibration / test, stratifié et graine fixe.
import { join } from "node:path";
import type { FindingId } from "@echo/core";
import { readJsonl } from "./io.ts";
import { DATA_DIR } from "./paths.ts";

export interface AnnotatedChunk {
  span: string;
  kind: "finding" | "not_sure" | "off_list" | "negated";
  finding?: FindingId;
  negates?: FindingId;
  topic?: string;
}

export interface Feedback {
  id: string;
  lang: "en" | "fr" | "de" | "es";
  text: string;
  synthetic: true;
  expectedFindings: FindingId[];
  mustNotFindings: FindingId[];
  chunks: AnnotatedChunk[];
  flags: {
    negation: "cancels" | "inherent" | null;
    multiFinding: boolean;
    typo: boolean;
    length: "very_short" | "short" | "medium" | "long";
    offList: boolean;
    offListTopics: string[];
    ambiguous: boolean;
    picking: boolean;
    mentionsGuide: boolean;
  };
}

export function loadFeedback(): Feedback[] {
  return readJsonl<Feedback>(join(DATA_DIR, "feedback.jsonl"));
}

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(xs: readonly T[], rand: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Strate d'un retour : langue × catégorie principale. */
export function stratum(f: Feedback): string {
  const cat = f.flags.picking
    ? "picking"
    : f.flags.offList
      ? "offlist"
      : f.flags.ambiguous
        ? "ambiguous"
        : f.flags.negation === "cancels"
          ? "neg_cancels"
          : f.flags.negation === "inherent"
            ? "neg_inherent"
            : f.flags.multiFinding
              ? "multi"
              : "single";
  return `${f.lang}:${cat}`;
}

export const SPLIT_SEED = 20261004;

/** Partage stratifié 50/50 (calibration / test). Déterministe. */
export function splitCorpus(items: readonly Feedback[], seed = SPLIT_SEED): { calibration: Feedback[]; test: Feedback[] } {
  const groups = new Map<string, Feedback[]>();
  for (const f of [...items].sort((a, b) => a.id.localeCompare(b.id))) {
    const k = stratum(f);
    groups.set(k, [...(groups.get(k) ?? []), f]);
  }
  const rand = rng(seed);
  const calibration: Feedback[] = [];
  const test: Feedback[] = [];
  let flip = false; // alterne le côté qui reçoit l'élément impair, pour équilibrer les tailles
  for (const k of [...groups.keys()].sort()) {
    const g = shuffle(groups.get(k)!, rand);
    const half = g.length % 2 === 0 ? g.length / 2 : flip ? Math.ceil(g.length / 2) : Math.floor(g.length / 2);
    if (g.length % 2 === 1) flip = !flip;
    calibration.push(...g.slice(0, half));
    test.push(...g.slice(half));
  }
  return { calibration, test };
}
