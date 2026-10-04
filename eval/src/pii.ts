// Niveau 2, contrôle du nettoyage des données personnelles (SPEC 4.3 étape 3, SPEC 6) avec le scrubPii livré.
// 1. Phrases SYNTHÉTIQUES annotées (eval/data/pii-names.jsonl) : prénoms dans des positions variées (début de
//    phrase, allemand, après un rôle ou une présentation, composés, noms rwandais, prénoms qui sont aussi des
//    mots courants) et numéros dictés en toutes lettres ; chaque phrase aussi en minuscules (transcription
//    sans majuscules). Rappel = part des noms (et numéros) dont aucun mot ne reste après nettoyage.
// 2. Retraits à tort : mots qui ne sont ni un nom ni un numéro et qui disparaissent, dans ces phrases et dans
//    tout le corpus écrit (eval/data/feedback.jsonl + exemples du catalogue, où « Noor » est le seul prénom).
// 3. Retraits à tort sur des TRANSCRIPTIONS Whisper (niveau 3, voix synthétiques sans bruit, eval/results/
//    level3.json) : Whisper met des majuscules à des mots qui n'en ont pas à l'écrit (« Wi-Fi ») et entend mal
//    des mots (« Frank » pour « Franc »). Seule personne citée : « Noor », que Whisper écrit Nor, Nora, Noa, No.
import { GIVEN_NAME_COUNT, scrubPii, words } from "@echo/core";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { readJson, readJsonl, round, writeJson } from "./lib/io.ts";
import { CATALOG_PATH, DATA_DIR, RESULTS_DIR } from "./lib/paths.ts";

interface PiiItem {
  id: string;
  lang: string;
  text: string;
  names: string[];
  phones: string[];
  position: string;
}

/** Mots de `before` absents de `after` (multiensemble, alignement par plus longue sous-suite commune). */
export function removedWords(before: string[], after: string[]): string[] {
  const n = before.length;
  const m = after.length;
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i]![j] = before[i] === after[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n) {
    if (j < m && before[i] === after[j]) {
      i++;
      j++;
    } else if (j < m && L[i]![j + 1]! >= L[i + 1]![j]!) j++;
    else out.push(before[i++]!);
  }
  return out;
}

/** Mots du texte nettoyé, sans les jetons [nom], [numéro]... */
const cleanWords = (t: string): string[] => words(t.replace(/\[(nom|numéro|e-mail|pseudo)\]/g, " "));

interface Tally {
  names: number;
  namesRemoved: number;
  phones: number;
  phonesRemoved: number;
  otherWords: number;
  otherRemoved: number;
}
const tally = (): Tally => ({ names: 0, namesRemoved: 0, phones: 0, phonesRemoved: 0, otherWords: 0, otherRemoved: 0 });

export function runPii(opts: { log: (s: string) => void }): void {
  const items = readJsonl<PiiItem>(join(DATA_DIR, "pii-names.jsonl"));
  const variants = { original: (t: string) => t, lowercase: (t: string) => t.toLowerCase() } as const;
  const byVariant: Record<string, Tally> = {};
  const byLang: Record<string, Tally> = {};
  const byPosition: Record<string, Tally> = {};
  const misses: { id: string; variant: string; kind: "name" | "phone"; value: string; output: string }[] = [];
  const falseRemovals: { id: string; variant: string; words: string[]; output: string }[] = [];

  for (const [variant, f] of Object.entries(variants)) {
    for (const it of items) {
      const input = f(it.text);
      const output = scrubPii(input, it.lang).text;
      const outWords = cleanWords(output);
      const keys = [byVariant[variant] ??= tally(), byLang[`${it.lang} ${variant}`] ??= tally(), byPosition[it.position.split(" ")[0]!] ??= tally()];
      const piiWords = new Set([...it.names, ...it.phones].flatMap((x) => words(x)));
      for (const name of it.names) {
        const gone = words(name).every((w) => !outWords.includes(w));
        for (const k of keys) {
          k.names++;
          if (gone) k.namesRemoved++;
        }
        if (!gone) misses.push({ id: it.id, variant, kind: "name", value: name, output });
      }
      for (const phone of it.phones) {
        const gone = output.includes("[numéro]") && words(phone).filter((w) => outWords.includes(w)).length <= 1;
        for (const k of keys) {
          k.phones++;
          if (gone) k.phonesRemoved++;
        }
        if (!gone) misses.push({ id: it.id, variant, kind: "phone", value: phone, output });
      }
      const others = words(input).filter((w) => !piiWords.has(w.replace(/'s$/, "")));
      const lost = removedWords(others, outWords.filter((w) => !piiWords.has(w.replace(/'s$/, ""))));
      for (const k of keys) {
        k.otherWords += others.length;
        k.otherRemoved += lost.length;
      }
      if (lost.length) falseRemovals.push({ id: it.id, variant, words: lost, output });
    }
  }

  // Corpus écrit entier : retraits de mots qui ne sont pas des prénoms (« Noor » est la fermière fictive).
  const corpus: { lang: string; text: string }[] = readJsonl<{ lang: string; text: string }>(join(DATA_DIR, "feedback.jsonl"));
  const catalog = readJson<{ findings: { examples: Record<string, string[]> }[] }>(CATALOG_PATH);
  for (const fd of catalog.findings) for (const [lang, list] of Object.entries(fd.examples)) for (const text of list) corpus.push({ lang, text });
  const corpusNames = new Set(["noor"]);
  let corpusWords = 0;
  const corpusRemoved: Record<string, number> = {};
  let corpusTextsTouched = 0;
  for (const c of corpus) {
    const before = words(c.text).filter((w) => !corpusNames.has(w));
    const lost = removedWords(before, cleanWords(scrubPii(c.text, c.lang).text).filter((w) => !corpusNames.has(w)));
    corpusWords += before.length;
    if (lost.length) corpusTextsTouched++;
    for (const w of lost) corpusRemoved[w] = (corpusRemoved[w] ?? 0) + 1;
  }
  const corpusRemovedCount = Object.values(corpusRemoved).reduce((a, b) => a + b, 0);

  const transcripts = transcriptOverScrub();

  const summarize = (t: Tally) => ({
    ...t,
    nameRecall: t.names ? round(t.namesRemoved / t.names, 3) : null,
    phoneRecall: t.phones ? round(t.phonesRemoved / t.phones, 3) : null,
    falseRemovalRate: t.otherWords ? round(t.otherRemoved / t.otherWords, 4) : null,
  });
  const map = (o: Record<string, Tally>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, summarize(v)]));
  const out = {
    synthetic: true,
    sentences: items.length,
    givenNames: GIVEN_NAME_COUNT,
    note: "Synthetic sentences written for this check (eval/data/pii-names.jsonl); each also lowercased (Whisper-style transcript without capitals). Same scrubPii as the app.",
    byVariant: map(byVariant),
    byLang: map(byLang),
    byPosition: map(byPosition),
    misses,
    falseRemovals,
    corpus: {
      texts: corpus.length,
      words: corpusWords,
      removedWords: corpusRemovedCount,
      falseRemovalRate: round(corpusRemovedCount / corpusWords, 4),
      textsTouched: corpusTextsTouched,
      removed: corpusRemoved,
      note: "feedback.jsonl (250) + catalog examples; 'Noor' (the fictional farmer) is the only person name, every other removed word counts as a false removal.",
    },
    transcripts,
  };
  writeJson(join(RESULTS_DIR, "pii.json"), out);
  const o = out.byVariant.original!;
  const l = out.byVariant.lowercase!;
  opts.log(
    `PII: names recall ${o.nameRecall} (original case), ${l.nameRecall} (lowercase); phones ${o.phoneRecall}/${l.phoneRecall}; ` +
      `false removals ${o.falseRemovalRate}/${l.falseRemovalRate} in the PII set, ${out.corpus.falseRemovalRate} on the corpus (${corpusRemovedCount}/${corpusWords} words)` +
      (transcripts ? `; on level-3 clean transcripts (whisper-base) ${transcripts.models["whisper-base"]?.falseRemovals}/${transcripts.models["whisper-base"]?.words} words` : ""),
  );
}

/** Distance d'édition (Levenshtein), pour reconnaître « Noor » mal entendu (Nor, Nora, Noa, No). */
function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length]![b.length]!;
}

interface Level3Message {
  id: string;
  lang: string;
  transcript?: string;
}

/**
 * Retraits sur les transcriptions Whisper des clips sans bruit (level3.json, écrit par `pnpm eval -- --level 3`).
 * Un mot retiré à distance d'édition ≤ 2 de « noor » est le prénom de la fermière (retrait correct), tout autre
 * mot retiré est un retrait à tort.
 */
function transcriptOverScrub() {
  const path = join(RESULTS_DIR, "level3.json");
  if (!existsSync(path)) return null;
  const l3 = readJson<{ models: Record<string, Record<string, { perMessage?: Level3Message[] }>> }>(path);
  const models: Record<string, { transcripts: number; words: number; nameRemovals: number; falseRemovals: number; falseRemovalRate: number; removed: { id: string; word: string; output: string }[] }> = {};
  for (const [model, conds] of Object.entries(l3.models)) {
    const msgs = (conds.clean?.perMessage ?? []).filter((m) => m.transcript);
    let totalWords = 0;
    let nameRemovals = 0;
    const removed: { id: string; word: string; output: string }[] = [];
    for (const m of msgs) {
      const before = words(m.transcript!);
      const output = scrubPii(m.transcript!, m.lang).text;
      totalWords += before.length;
      for (const w of removedWords(before, cleanWords(output))) {
        if (editDistance(w, "noor") <= 2) nameRemovals++;
        else removed.push({ id: m.id, word: w, output });
      }
    }
    models[model] = { transcripts: msgs.length, words: totalWords, nameRemovals, falseRemovals: removed.length, falseRemovalRate: round(removed.length / Math.max(1, totalWords), 4), removed };
  }
  return {
    synthetic: true,
    note: "Whisper transcripts of the level-3 clean clips (synthetic Piper voices, no noise). 'Noor' is the only person in these feedbacks; a removed word within edit distance 2 of 'noor' counts as her name, any other removed word as a false removal.",
    models,
  };
}
