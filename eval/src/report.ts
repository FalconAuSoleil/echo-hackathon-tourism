// Génère eval/results/RESULTS.md et la courbe couverture/erreur (SVG) à partir des JSON des niveaux.
// Tout chiffre issu des données synthétiques est marqué comme tel.
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readJson } from "./lib/io.ts";
import { RESULTS_DIR } from "./lib/paths.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
type J = any;
const load = (f: string): J | undefined => (existsSync(join(RESULTS_DIR, f)) ? readJson<J>(join(RESULTS_DIR, f)) : undefined);
const pct = (x: number | undefined, d = 1) => (x === undefined || x === null || Number.isNaN(x) ? "–" : `${(x * 100).toFixed(d)} %`);
const ci = (c: [number, number] | undefined) => (c ? `[${(c[0] * 100).toFixed(0)}–${(c[1] * 100).toFixed(0)}]` : "");
const num = (x: number | undefined, d = 2) => (x === undefined || x === null ? "–" : x.toFixed(d));
const table = (head: string[], rows: (string | number)[][]) =>
  [`| ${head.join(" | ")} |`, `|${head.map((_, i) => (i === 0 ? "---" : "---:")).join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");

const LANGS = ["en", "fr", "de", "es"];

/** Matrice de confusion (lignes = passages annotés, colonnes = décision d'Echo), colonnes et lignes vides masquées. */
function confusionTable(conf: { rows: string[]; cols: string[]; counts: number[][] }): string {
  const usedCols = conf.cols.filter((_, j) => conf.counts.some((r) => (r[j] ?? 0) > 0));
  return table(["annotated \\ Echo", ...usedCols], conf.rows.map((r, i) => [r, ...usedCols.map((cname) => {
    const v = conf.counts[i]![conf.cols.indexOf(cname)];
    return v ? (cname === r ? `**${v}**` : String(v)) : "·";
  })]).filter((row) => row.slice(1).some((x) => x !== "·")));
}

/** Tableau par langue du niveau 3 (résumés plats de level3.json : models.*.*.echo.byLang / keywords.byLang). */
export function level3LangTable(r: J): string {
  return table(["Lang", "Clips", "WER", "Echo P", "Echo R", "Echo F1", "Echo error among accepted", "Echo captured", "Echo not sure", "Kw P", "Kw R", "Kw F1", "Kw error among accepted", "Kw captured"],
    LANGS.map((l) => {
      const a = r.echo.byLang[l];
      const b = r.keywords.byLang[l];
      return [l, a.messages, pct(r.werByLang[l]?.wer), num(a.precision), num(a.recall), num(a.f1), `${pct(a.acceptedErrorRate)} ${ci(a.acceptedErrorCi95)} (${a.accepted} acc.)`, pct(a.captureRate), pct(a.notSureRate), num(b.precision), num(b.recall), num(b.f1), `${pct(b.acceptedErrorRate)} (${b.accepted} acc.)`, pct(b.captureRate)];
    }));
}

// --- Courbe SVG (statique, fond clair explicite pour rester lisible dans un rendu sombre) ---
function curveSvg(cal: J[], test: J[], chosen: number, kw: { coverage: number; err: number } | undefined, label: string, maxErr = 0.05): string {
  const W = 720, H = 420, L = 64, R = 24, T = 48, B = 56;
  const x = (v: number) => L + v * (W - L - R);
  const maxY = 0.4;
  const y = (v: number) => T + (1 - Math.min(v, maxY) / maxY) * (H - T - B);
  const path = (pts: J[]) => pts.filter((p) => p.accepted > 0).map((p, i) => `${i ? "L" : "M"}${x(p.coverage).toFixed(1)},${y(p.acceptedErrorRate).toFixed(1)}`).join(" ");
  const grid = [0, 0.1, 0.2, 0.3, 0.4].map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#e4e3df" stroke-width="1"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" font-size="12" fill="#52514e">${v * 100} %</text>`).join("");
  const xt = [0, 0.2, 0.4, 0.6, 0.8, 1].map((v) => `<text x="${x(v)}" y="${H - B + 20}" text-anchor="middle" font-size="12" fill="#52514e">${v * 100} %</text>`).join("");
  const dots = (pts: J[], color: string, name: string) =>
    pts.filter((p) => p.accepted > 0).map((p) => `<circle cx="${x(p.coverage).toFixed(1)}" cy="${y(p.acceptedErrorRate).toFixed(1)}" r="3" fill="${color}"><title>${name}, threshold ${p.threshold}: chunks accepted ${pct(p.coverage)}, error among accepted ${pct(p.acceptedErrorRate)}, remarks captured ${pct(p.captureRate)}</title></circle>`).join("");
  const c = test.find((p) => Math.abs(p.threshold - chosen) < 1e-6);
  const cc = cal.find((p) => Math.abs(p.threshold - chosen) < 1e-6);
  // Étiquettes dans la zone vide en bas à droite, reliées à l'anneau par un trait fin.
  const mark = (p: J | undefined, color: string, text: string, ly: number) => {
    if (!p) return "";
    const cx = x(p.coverage), cy = y(p.acceptedErrorRate), lx = x(0.66);
    return `<circle cx="${cx}" cy="${cy}" r="7" fill="none" stroke="${color}" stroke-width="2"/><line x1="${cx + 7}" y1="${cy}" x2="${lx - 4}" y2="${ly - 4}" stroke="#a8a7a1" stroke-width="1"/><text x="${lx}" y="${ly}" font-size="12" fill="#0b0b0b">${text}</text>`;
  };
  const kwMark = kw ? `<rect x="${x(kw.coverage) - 6}" y="${y(kw.err) - 6}" width="12" height="12" fill="#52514e" rx="2"><title>Keyword baseline: chunks with a hit ${pct(kw.coverage)}, error among accepted ${pct(kw.err)}</title></rect><text x="${x(kw.coverage) - 10}" y="${y(kw.err) - 12}" text-anchor="end" font-size="12" fill="#0b0b0b">keywords (no threshold)</text>` : "";
  const bound = `<line x1="${L}" x2="${W - R}" y1="${y(maxErr)}" y2="${y(maxErr)}" stroke="#a8a7a1" stroke-dasharray="4 4"/><text x="${W - R}" y="${y(maxErr) - 6}" text-anchor="end" font-size="11" fill="#52514e">${maxErr * 100} % bound (calibration rule)</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Inter, system-ui, sans-serif" role="img" aria-label="Coverage versus error among accepted answers as the acceptance threshold varies">
<rect width="${W}" height="${H}" fill="#fcfcfb"/>
<text x="${L}" y="24" font-size="15" font-weight="600" fill="#0b0b0b">Echo: share of chunks accepted vs error among accepted (SYNTHETIC level 2)</text>
<text x="${L}" y="40" font-size="12" fill="#52514e">${label}. Dot = one threshold; ring = chosen.</text>
${grid}${xt}${bound}
<text x="${(L + W - R) / 2}" y="${H - 14}" text-anchor="middle" font-size="12" fill="#52514e">share of chunks accepted (coverage)</text>
<text transform="translate(16 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle" font-size="12" fill="#52514e">error among accepted answers</text>
<path d="${path(cal)}" fill="none" stroke="#2a78d6" stroke-width="2"/>${dots(cal, "#2a78d6", "calibration")}
<path d="${path(test)}" fill="none" stroke="#eb6834" stroke-width="2"/>${dots(test, "#eb6834", "held-out test")}
${mark(cc, "#2a78d6", `chosen threshold ${chosen} on calibration`, y(0.012))}${mark(c, "#eb6834", `same threshold on held-out test`, y(0.032))}${kwMark}
<g transform="translate(${W - R - 200} ${T + 8})"><rect width="200" height="48" fill="#fcfcfb" stroke="#e4e3df" rx="4"/>
<line x1="10" x2="30" y1="16" y2="16" stroke="#2a78d6" stroke-width="2"/><text x="38" y="20" font-size="12" fill="#0b0b0b">calibration half</text>
<line x1="10" x2="30" y1="34" y2="34" stroke="#eb6834" stroke-width="2"/><text x="38" y="38" font-size="12" fill="#0b0b0b">held-out test half</text></g>
</svg>
`;
}

export function runReport(log: (s: string) => void = console.log) {
  const l1 = load("level1.json");
  const l2 = load("level2.json");
  const l3 = load("level3.json");
  const perf = load("perf.json");
  const pii = load("pii.json");
  const out: string[] = [];
  const w = (s = "") => out.push(s);

  w("# Echo — evaluation results (SPEC 9)");
  w();
  w(`Generated by \`pnpm eval\` (eval/src/report.ts) on ${new Date().toISOString().slice(0, 10)}. Raw numbers: \`eval/results/level1.json\`, \`level2.json\`, \`level3.json\`, \`perf.json\`, \`thresholds.json\`.`);
  w("Every number is produced by the shipped code (`@echo/core` + `@echo/models`, same models as the app).");
  w();
  w("> **What is real and what is synthetic.** Level 1 uses **real human voices** (FLEURS). Levels 2 and 3 use a");
  w("> **SYNTHETIC** corpus: 250 visitor feedbacks written by the team (no real visitor) and, for level 3, **synthetic");
  w("> voices** (Piper TTS) mixed with public outdoor noise (ESC-50). Synthetic text and TTS voices are cleaner and more");
  w("> regular than real visitors outdoors: treat levels 2–3 as an upper bound on real-world quality.");
  w();

  // ---------- Headline ----------
  if (l2) {
    const e = l2.echo.test.all;
    const sets = (l2.keywordSets ?? {}) as Record<string, J>;
    const primary: string = l2.keywordSet ?? "original";
    const k = l2.keywords.test.all; // jeu principal
    const other = primary === "blind" ? "original" : "blind";
    const ko = sets[other]?.test?.all as J | undefined;
    const base3 = l3?.models?.["whisper-base"]?.snr10;
    const e3 = base3?.echo?.all;
    const k3 = base3?.keywords?.all;
    const ko3 = base3?.keywordSets?.[other];
    const setLabel = (n: string) => (n === "blind" ? "Keywords, blind lists" : "Keywords, original lists");
    // Chiffres précédents d'Echo (avant le travail sur le rappel), gardés pour la transparence.
    const prevFile = "previous/2026-10-04-before-recall/level2.json";
    const prev = load(prevFile);
    const pe = prev?.echo?.test?.all;
    const negCell = (m: J) => `${pct(m.negationCancels.accuracy, 0)} (${m.negationCancels.spans - m.negationCancels.violations}/${m.negationCancels.spans})`;
    w("## Headline");
    w();
    w("**Share of visitor remarks correctly captured** (SPEC 13). Definition: a *remark* is a passage of a feedback annotated");
    w("as expressing one catalog finding (P1–N10). It is *correctly captured* when the system counts exactly that finding on");
    w("a chunk that overlaps the passage (≥ half of the shorter one's words in common). Remarks left \"not sure\" or counted as");
    w("another finding are not captured. Measured on the held-out half of the SYNTHETIC level-2 corpus");
    w(`(${e.remarks.total} remarks in ${e.messages} feedbacks); the same remark set for every method.`);
    w();
    const cols = ["", "Echo", `**${setLabel(primary)}** (headline baseline)`, ...(ko ? [`${setLabel(other)} (transparency)`] : [])];
    const row = (label: string, ec: string, kc: string, oc?: string) => [label, ec, kc, ...(ko ? [oc ?? "–"] : [])];
    w(table(cols, [
      row("Remarks correctly captured (X / Y)", `**${pct(e.remarks.captureRate, 0)}** ${ci(e.remarks.ci95)}`, `**${pct(k.remarks.captureRate, 0)}** ${ci(k.remarks.ci95)}`, ko && `${pct(ko.remarks.captureRate, 0)} ${ci(ko.remarks.ci95)}`),
      row("Of the answers it counts, share that are wrong", `${pct(e.answers.acceptedErrorRate, 1)} ${ci(e.answers.ci95)} (${e.answers.wrong}/${e.answers.accepted})`, `${pct(k.answers.acceptedErrorRate, 1)} ${ci(k.answers.ci95)} (${k.answers.wrong}/${k.answers.accepted})`, ko && `${pct(ko.answers.acceptedErrorRate, 1)} ${ci(ko.answers.ci95)} (${ko.answers.wrong}/${ko.answers.accepted})`),
      row("Cancelling negations not counted (\"the walk was not too long\")", negCell(e), negCell(k), ko && negCell(ko)),
      row("Off-list feedbacks given a finding anyway", `${e.offListSpans.gotFinding}/${e.offListSpans.total}`, `${k.offListSpans.gotFinding}/${k.offListSpans.total}`, ko && `${ko.offListSpans.gotFinding}/${ko.offListSpans.total}`),
      row("Remarks flagged \"not sure — ask a person\" instead", pct(e.remarks.notSure / Math.max(1, e.remarks.total), 0), "0 % (no such state)", "0 %"),
      row("Remarks either counted right or flagged \"not sure — ask a person\"", pct((e.remarks.captured + e.remarks.notSure) / Math.max(1, e.remarks.total), 0), `${pct(k.remarks.captureRate, 0)} (no such flag)`, ko && pct(ko.remarks.captureRate, 0)),
      ...(e3 && k3 ? [row(`Same, end to end on audio (whisper-base, 10 dB SNR, synthetic voices; ${l3.clips} messages, ${l3.clips - l3.clipsInTestHalf} of them from the calibration half): captured / wrong`, `${pct(e3.remarks.captureRate, 0)} / ${pct(e3.answers.acceptedErrorRate, 0)}`, `${pct(k3.remarks.captureRate, 0)} / ${pct(k3.answers.acceptedErrorRate, 0)}`, ko3 && `${pct(ko3.captureRate, 0)} / ${pct(ko3.acceptedErrorRate, 0)}`)] : []),
    ]));
    w();
    w("95 % Wilson intervals in brackets. Reading: keyword matching *touches* more remarks, but more than one counted answer in");
    w("four is wrong (negations such as \"the walk was not too long\" count as complaints, a \"delicious coffee\" counts as a meal, …),");
    w("and it never says when it does not know. Echo counts fewer remarks automatically, keeps the wrong-answer rate on text under the");
    w(`${(l2.calibration.maxAcceptedError ?? 0.05) * 100} % bound of the calibration rule, and routes the rest to a person. The host acts on the counts, so a wrong count`);
    w("costs more than a missed one (a missed remark is still read by a person from the review list).");
    if (e3) {
      const sub = base3?.echoTestSubset;
      w(`On audio the bound is not kept: ${pct(e3.answers.acceptedErrorRate, 1)} wrong at 10 dB (whisper-base), above the ${(l2.calibration.maxAcceptedError ?? 0.05) * 100} % bound (Level 3).`);
      if (sub) w(`The audio row uses ${l3.clips} messages, ${l3.clips - l3.clipsInTestHalf} of them from the calibration half the thresholds were tuned on; on the ${sub.messages} held-out messages only, Echo captures ${pct(sub.captureRate, 1)} with ${pct(sub.acceptedErrorRate, 1)} of ${sub.accepted} accepted answers wrong (small sample).`);
    }
    w();
    w("**Why the blind lists are the headline baseline.** The original lists (`eval/keywords/`) were written by the same agent");
    w("that wrote the synthetic corpus, so they can repeat its exact wording, which flatters keyword matching. The blind lists");
    w("(`eval/keywords-blind/`) were written in one pass from the catalog's finding labels and example phrasings only, without");
    w("opening the corpus, the results or the first lists, and were never tuned on a score (protocol: eval/keywords-blind/README.md).");
    if (ko) {
      w(`The gap between the two (${pct(ko.remarks.captureRate, 0)} vs ${pct(k.remarks.captureRate, 0)} of remarks captured) is an estimate of that leak; both are kept above.`);
      w("Neither is a tuned commercial keyword system: a person maintaining lists for months would do better than the blind lists.");
    }
    w();
    if (pe) {
      w("**Previous Echo configuration** (same held-out half, kept for transparency; raw numbers in `eval/results/previous/2026-10-04-before-recall/`):");
      w();
      w(table(["Echo, held-out half", "Remarks captured", "Error among accepted", "Remarks flagged not sure", "Cancelling negations not counted", "Accepted answers"], [
        [`Before (catalog ${prev.catalogExamples} examples, probability ≥ ${prev.calibration.acceptProbability}, floor ${prev.calibration.offListThreshold})`, `${pct(pe.remarks.captureRate)} ${ci(pe.remarks.ci95)}`, `${pct(pe.answers.acceptedErrorRate)} ${ci(pe.answers.ci95)}`, pct(pe.remarks.notSure / Math.max(1, pe.remarks.total)), negCell(pe), pe.answers.accepted],
        [`Now (catalog ${l2.catalogExamples} examples, probability ≥ ${l2.calibration.acceptProbability}, floor ${l2.calibration.offListThreshold})`, `${pct(e.remarks.captureRate)} ${ci(e.remarks.ci95)}`, `${pct(e.answers.acceptedErrorRate)} ${ci(e.answers.ci95)}`, pct(e.remarks.notSure / Math.max(1, e.remarks.total)), negCell(e), e.answers.accepted],
      ]));
      w();
      w("What changed (all decided on the calibration half only; details and every intermediate run in eval/results/experiments/log.md):");
      w(`${prev.catalogExamples} → ${l2.catalogExamples} synthetic catalog examples (6 more per finding and language, written from the finding definitions, checked disjoint`);
      w("from the corpus); idioms that are not negations (\"sans hésiter\", \"without hesitation\") no longer block a finding; wider");
      w("written-language detection; selection rule: error bound 8 % (was 5 %), every cancelling negation of the calibration half handled");
      w("(was 85 %), lowest error among variants within 2 capture points of the best. The held-out half was evaluated once, after these");
      w(`choices. On the calibration half the shipped setting gives ${pct(l2.calibration.atThresholdCalibration.captureRate)} captured, ${pct(l2.calibration.atThresholdCalibration.acceptedErrorRate)} wrong; on the held-out half the error`);
      w(`is higher (${pct(e.answers.acceptedErrorRate)}, ${e.answers.wrong} of ${e.answers.accepted}), still under the 8 % bound but above the 5 % target of the first rule. The gain in capture`);
      w(`(+${((e.remarks.captureRate - pe.remarks.captureRate) * 100).toFixed(1)} points, ${e.remarks.captured - pe.remarks.captured} remarks) is inside the 95 % intervals: it is a modest improvement, not a step change.`);
      w();
    }
    w("Suggested wording for the problem sentence: *\"our tests on synthetic feedback show the tool correctly captures " +
      `${pct(e.remarks.captureRate, 0)} of visitor remarks with ${pct(e.answers.acceptedErrorRate, 1)} of its counted answers wrong ` +
      `(most of the rest is flagged \"not sure\" for a person), versus ${pct(k.remarks.captureRate, 0)} for keyword matching with ${pct(k.answers.acceptedErrorRate, 0)} wrong.\"*`);
    w();
  }

  // ---------- Level 1 ----------
  if (l1) {
    w("## Level 1 — Whisper on real human voices (FLEURS)");
    w();
    w(`Dataset: ${l1.dataset.name}, ${l1.dataset.license}, ${l1.dataset.source}. Configs: ${Object.entries(l1.dataset.configs).map(([k, v]) => `${k}=${v}`).join(", ")}.`);
    w(`Sample: ${l1.dataset.sampling}. Decoding: ${l1.setup.decoding}. Normaliser: ${l1.setup.normaliser}.`);
    w();
    const rows: (string | number)[][] = [];
    for (const [m, byLang] of Object.entries<J>(l1.models)) {
      for (const lang of ["en", "fr", "de", "es", "sw"]) {
        const r = byLang[lang];
        if (!r) continue;
        rows.push([m, lang, r.n, pct(r.wer), pct(r.cer), pct(r.languageIdAccuracy, 0), num(r.realTimeFactor)]);
      }
    }
    w(table(["Model (q8)", "Lang", "Utterances", "WER", "CER", "Language detected right", "Real-time factor"], rows));
    w();
    w("Real-time factor = compute time / audio time on this machine with all 8 threads, while other jobs shared the CPU");
    w("(load average recorded in level1.json), so it is pessimistic; controlled timings are in the Performance section.");
    w("Swahili is a bonus language: Whisper's Swahili is weak and the app treats it as unsupported (→ \"not sure\").");
    w();
  }

  // ---------- Level 2 ----------
  if (l2) {
    const c = l2.calibration;
    const e = l2.echo.test;
    const k = l2.keywords.test;
    w("## Level 2 — classification of written feedback (SYNTHETIC)");
    w();
    w(`Corpus: ${l2.corpus.total} synthetic feedbacks (eval/data/feedback.jsonl), split ${c.split.calibration}/${c.split.test} into a calibration half and a held-out test half (seed ${c.split.seed}, stratified by ${c.split.stratifiedBy}).`);
    w(`Catalog: ${l2.catalogExamples} synthetic examples (catalog/catalog.json), disjoint from the corpus (eval/data/check_disjoint.py).`);
    w("Everything below is on the **held-out test half** unless marked otherwise. Written messages go through the shipped path with");
    const ld = l2.languageDetection;
    const otherLang = ld.total - ld.correct - ld.unknown;
    w(`automatic language detection (all ${ld.total} feedbacks: ${ld.correct} right, ${ld.unknown} "unknown" → whole message not sure, ${otherLang} detected as another supported language and analysed in that language).`);
    w();
    w("### How the threshold was chosen (calibration half only)");
    w();
    w(`Rule (computed on the calibration half only): ${c.rule}.`);
    w();
    w("Honesty note on the order of decisions: the classifier change (similarity → linear) and the hyper-parameter grid were");
    w("decided on the calibration half. Test-half numbers were then printed by intermediate runs, and three changes were made");
    w("after that: (1) the off-list floor is now chosen *before* the threshold sweep (the first version swept without the floor,");
    w("so the calibration numbers did not describe the shipped configuration); (2) relaxed negation margins were excluded (below);");
    w("(3) the unknown-topic rule (below). Changes (1) and (2) made the procedure more faithful or the system stricter; change (3)");
    w("was made so that the picking signal fires, i.e. it is tuned on the only recurring-topic example. The test half is therefore");
    w("not perfectly untouched. A fourth round (echo-recall, 2026-10-04: more catalog examples, non-negating idioms, language");
    w("detection, the selection rule below) was decided on the calibration half only, but after the previous held-out numbers");
    w("(48 % captured, 6 % wrong, fewer remarks than keywords) were known; the held-out half was then run once for this report.");
    w();
    w(`Chosen: **${c.variant.name}** — embedding model \`${c.embeddingModel}\`, scoring \`${c.scoring}\`` +
      (c.scoring === "linear" ? `, accept when the classifier probability ≥ **${c.acceptProbability}** (L2 ${c.linearL2}, ${c.linearEpochs} epochs, trained only on catalog examples)` : `, accept threshold **${c.acceptThreshold}**`) +
      `, off-list floor (cosine) **${c.offListThreshold}**, unknown-topic cluster threshold **${c.offListClusterThreshold}** (${c.clusterThresholdSelection.rule}; Youden would give ${c.clusterThresholdSelection.youden.threshold}), unknown-topic sources \`${c.unknownTopicSources}\`.`);
    w(`At that threshold on the calibration half: capture ${pct(c.atThresholdCalibration.captureRate)}, error among accepted ${pct(c.atThresholdCalibration.acceptedErrorRate)}, coverage ${pct(c.atThresholdCalibration.coverage)}.`);
    w("These values are written to `packages/core/src/calibration.ts`, which `DEFAULT_CONFIG` (read by the app) uses.");
    w();
    w("Why a linear classifier: the first run used the core's original rule (cosine with the closest catalog example). On the");
    w("calibration half no threshold reached ≤ 5 % error with MiniLM (≥ 20 % error even at high thresholds: close findings such as");
    w("tasting vs field visit, welcome vs general thanks get confused). A multinomial logistic regression trained on the catalog");
    w("examples' embeddings (21 × 385 weights, deterministic, a few seconds to train) gives a probability that ranks right and");
    w("wrong answers much better. Both are kept in the core (`scoring: \"similarity\" | \"linear\"`).");
    w();
    w("Variants marked *not selectable* relax the negation agreement by a margin (`negationMargin` 0.05 or 0.1). They looked better");
    w("on the calibration half, but on the test half cancelling negations (\"the path was not too long\") slipped through far more");
    w("often (≈ 62 % handled correctly vs ≈ 85 % with the strict rule). The calibration half has only 16 such passages, too few for");
    w("the negation constraint to catch it, so after seeing this we excluded them from selection for safety (a decision informed by");
    w("the test half, stated here). A positive (relaxed) margin is never selected; a negative margin makes the rule stricter and is");
    w("selectable. The `mpnet` variants (Xenova/paraphrase-multilingual-mpnet-base-v2, 296 MB, ~1.4 GB peak memory in WebAssembly");
    w("against ~0.64 GB for MiniLM) are measured but not selectable: too heavy for a 2 GB phone (eval/results/experiments/log.md).");
    w("Since 2026-10-04 (echo-recall): error bound 8 % (was 5 %), cancelling negations 100 % on the calibration half (was 85 %),");
    w("and among variants within 2 capture points of the best, the lowest error wins; previous numbers: eval/results/experiments/log.md.");
    w();
    w(table(["Variant", "Calibration: threshold", "capture", "error", "Test: capture", "error [95 % CI]", "F1", "Test: cancelling negations OK"],
      l2.variants.map((v: J) => {
        const t = l2.variantsOnTest.find((x: J) => x.variant === v.variant);
        return [v.selectable === false ? `${v.variant} (not selectable)` : v.variant, v.chosen ? v.chosen.threshold : `none ≤ ${(l2.calibration.maxAcceptedError ?? 0.05) * 100} %`, v.chosen ? pct(v.chosen.captureRate) : "–", v.chosen ? pct(v.chosen.acceptedErrorRate) : "–", t ? pct(t.test.captureRate) : "–", t ? `${pct(t.test.acceptedErrorRate)} ${ci(t.test.acceptedErrorCi95)}` : "–", t ? num(t.test.f1) : "–", t ? pct(t.test.negationCancelsAccuracy, 0) : "–"];
      })));
    w();
    w("![coverage vs error curve](coverage-error-curve.svg)");
    w();
    w("### Echo vs keywords (held-out test half)");
    w();
    const rowFor = (name: string, m: J): (string | number)[] => [name, num(m.micro.precision), num(m.micro.recall), num(m.micro.f1), `${pct(m.answers.acceptedErrorRate)} ${ci(m.answers.ci95)}`, pct(m.remarks.captureRate), pct(m.chunks.notSureRate), pct(m.chunks.offListRate), pct(m.negationCancels.accuracy), pct(m.negationInherent.recall), `${m.ambiguous.gotFinding}/${m.ambiguous.total}`, `${m.offListSpans.gotFinding}/${m.offListSpans.total}`];
    const head = ["", "Precision", "Recall", "F1", "Error among accepted", "Remarks captured", "Not-sure rate", "Off-list rate", "Cancelling negations OK", "Negation-is-finding recall", "Ambiguous given a finding", "Off-list given a finding"];
    const kwRows = l2.keywordSets
      ? Object.entries(l2.keywordSets as Record<string, J>).map(([name, m]) => rowFor(`Keywords (${name})`, m.test.all))
      : [rowFor("Keywords", k.all)];
    w(table(head, [rowFor("**Echo**", e.all), ...kwRows]));
    w();
    w("Precision / recall / F1: message level (predicted set of findings vs expected). Error among accepted: chunk-level answers");
    w("(chunk, finding) counted by the system that do not match the annotation. Not-sure / off-list rates: share of chunks.");
    w("Cancelling negations OK: share of annotated cancelling negations (\"the path was not too long\") that did **not** produce the");
    w("negated finding. Keywords have no not-sure state: a chunk without a hit is shown as off-list.");
    w();
    w(`Per language (test half; Kw = \`${l2.keywordSet ?? "original"}\` keyword lists):`);
    w();
    w(table(["Lang", "Feedbacks", "Echo P", "Echo R", "Echo F1", "Echo error among accepted", "Echo captured", "Echo not sure", "Kw P", "Kw R", "Kw F1", "Kw error among accepted", "Kw captured"],
      LANGS.map((l) => {
        const a = e.byLang[l];
        const b = k.byLang[l];
        return [l, a.messages, num(a.micro.precision), num(a.micro.recall), num(a.micro.f1), pct(a.answers.acceptedErrorRate), pct(a.remarks.captureRate), pct(a.chunks.notSureRate), num(b.micro.precision), num(b.micro.recall), num(b.micro.f1), pct(b.answers.acceptedErrorRate), pct(b.remarks.captureRate)];
      })));
    w();
    w("Per finding (test half, message level):");
    w();
    w(table(["Finding", "Support", "Echo P", "Echo R", "Echo F1", "Kw P", "Kw R", "Kw F1"],
      Object.keys(e.all.perFinding).map((f) => {
        const a = e.all.perFinding[f];
        const b = k.all.perFinding[f];
        return [f, a.tp + a.fn, num(a.precision), num(a.recall), num(a.f1), num(b.precision), num(b.recall), num(b.f1)];
      })));
    w();
    // Confusion matrix (Echo, test): rows = annotated, cols = predicted
    w("Confusion matrix (Echo, test half, annotated passages → what Echo did on the overlapping chunks; empty columns hidden):");
    w();
    w(confusionTable(e.all.confusion));
    w();

    // Unknown topics
    const u = l2.unknownTopics;
    w("### Unknown topic that comes back (coffee-cherry picking, 3 visitors)");
    w();
    w(`Chunks are clustered with the shipped \`clusterOffList\` (average linkage, threshold ${u.clusterThreshold}); the signal fires when a cluster spans ≥ ${u.minVisitors} distinct visitors. Simulated months follow SPEC 2 (6–7 visitors a month): 4 random feedbacks + the 3 picking ones, and 7 random feedbacks without picking (500 months each). The whole corpus (250 feedbacks as one month) is a much harsher stress test.`);
    w();
    w(table(["Chunks clustered", "Candidate chunks", "Picking flagged (250 as one month)", "False alerts (250 as one month)", "Picking flagged (realistic months)", "Months with a false alert"],
      [u.offListOnly, u.offListAndUnsure].map((m: J) => [`\`${m.sources}\`${m.sources === u.shipped.sources ? " (shipped)" : ""}`, m.candidateChunks, m.fullCorpus.detected ? "yes" : "no", m.fullCorpus.falseAlerts, pct(m.realisticMonths.detectionRate), pct(m.realisticMonths.falseAlertMonthRate)])));
    w();
    {
      const sh = u.shipped?.realisticMonths;
      const md = (u.shipped?.sources === u.offListOnly?.sources ? u.offListOnly : u.offListAndUnsure)?.realisticMonths;
      if (sh && md && (sh.falseAlertMonthRate !== md.falseAlertMonthRate || sh.detectionRate !== md.detectionRate))
        w(`The shipped configuration was also simulated separately (other random months, same setting): picking flagged ${pct(sh.detectionRate)}, months with a false alert ${pct(sh.falseAlertMonthRate)}. The spread between the two draws (${pct(md.falseAlertMonthRate)} vs ${pct(sh.falseAlertMonthRate)}) is Monte Carlo noise (500 months each); the false-alert rate is somewhere around that range, not precisely either value.`);
    }
    w("Where the three picking remarks land: " + u.pickingMessages.map((p: J) => `${p.id}: ${p.chunks.map((c: J) => `${c.status} (${c.reason})`).join(", ")}`).join("; ") + ".");
    w("With the literal SPEC 4.5 rule (only off-list chunks), the picking remarks never trigger the signal: they are close to");
    w("\"field visit\" findings, so they end up \"not sure\" rather than off-list. The shipped rule also clusters \"not sure\" chunks whose");
    w("best finding stayed below the threshold (never those made unsure by a negation). This choice was made *after* seeing the");
    w("picking result, and the cluster threshold rule (≤ 1 % of different-finding catalog pairs merged, computed on catalog examples");
    w("only) was also adopted after the Youden rule gave too many false alerts: there is no second annotated recurring topic to");
    w("validate both blind. Many known-topic \"not sure\" chunks also recur, so with hundreds of messages a month the signal would");
    w("fire often (column \"250 as one month\"): fine for one farm, not for a cooperative-wide feed.");
    w();
    w("Sensitivity to the cluster threshold (shipped sources):");
    w();
    w(table(["Cluster threshold", "Picking flagged (250)", "False alerts (250)", "Picking flagged (months)", "Months with false alert"], u.sensitivity.map((s: J) => [s.clusterThreshold, s.fullCorpusDetected ? "yes" : "no", s.fullCorpusFalseAlerts, pct(s.detectionRate), pct(s.falseAlertMonthRate)])));
    w();
    const d = l2.duplicates;
    w("### Duplicates");
    w();
    w(`Rule: ${d.rule}. Test half (${d.originals} distinct feedbacks) processed in sequence like the app; then each one re-sent.`);
    w();
    w(table(["Case", "Sent", "Flagged duplicate"], [
      ["Distinct feedbacks (should not be flagged)", d.originals, d.falseDuplicatesAmongDistinctMessages],
      ...Object.entries<J>(d.resend).map(([k2, v]) => [`Re-sent: ${k2.replace(/_/g, " ")}`, v.sent, `${v.flagged} (${pct(v.rate, 0)})`]),
      ["Same text a month later (outside the 7-day window, should not be flagged)", d.sameTextOutsideWindow.sent, d.sameTextOutsideWindow.flagged],
    ]));
    w();
    w("A forwarded voice note is bit-identical, so its transcript is identical: that case is the \"exact\" row. \"One word added\" is");
    w("deliberately ambiguous (a resend after an edit, or a second visitor): about 4 in 5 are merged.");
    w();
  }

  // ---------- Level 2 : nettoyage des données personnelles ----------
  if (pii) {
    const o = pii.byVariant.original;
    const lo = pii.byVariant.lowercase;
    w("### Personal data scrubbing: names and spoken phone numbers (SYNTHETIC sentences)");
    w();
    w(`\`scrubPii\` (the shipped heuristic scrubber, no model) on ${pii.sentences} synthetic sentences written for this check (eval/data/pii-names.jsonl): first names at the start of a sentence, in the middle, after a role or an introduction (\"our guide was called …\", \"hieß …\"), at the end, compound names, Rwandan names, names that are also common words (Grace, Claire, Pierre, Pilar, Ernst, Rose, Dolores), and phone numbers spoken as words. Each sentence is also run lowercased, as a transcript without capitals. A name counts as removed when none of its words is left.`);
    w();
    w(table(["", "Original case", "Lowercased"], [
      ["Names removed (recall)", `**${pct(o.nameRecall, 0)}** (${o.namesRemoved}/${o.names})`, `**${pct(lo.nameRecall, 0)}** (${lo.namesRemoved}/${lo.names})`],
      ["Spoken phone numbers removed", `${o.phonesRemoved}/${o.phones}`, `${lo.phonesRemoved}/${lo.phones}`],
      ["Other words removed by mistake", `${pct(o.falseRemovalRate, 1)} (${o.otherRemoved}/${o.otherWords})`, `${pct(lo.falseRemovalRate, 1)} (${lo.otherRemoved}/${lo.otherWords})`],
    ]));
    w();
    w(table(["Language", "Recall, original case", "Recall, lowercased"], ["en", "fr", "de", "es"].map((l) => [l, `${pct(pii.byLang[`${l} original`].nameRecall, 0)} (${pii.byLang[`${l} original`].namesRemoved}/${pii.byLang[`${l} original`].names})`, `${pct(pii.byLang[`${l} lowercase`].nameRecall, 0)} (${pii.byLang[`${l} lowercase`].namesRemoved}/${pii.byLang[`${l} lowercase`].names})`])));
    w();
    const missed = [...new Set<string>(pii.misses.filter((m: J) => m.kind === "name").map((m: J) => `${m.value}${m.variant === "lowercase" ? " (lowercased)" : ""}`))];
    w(`Names kept: ${missed.join(", ")}. They are names that are also common words (kept on purpose unless next to another name or \"and I\"), names absent from the first-name list (Noor, Kwame) when they start a sentence or are lowercased, and lowercased names whose lowercase form is a word.`);
    const corpusRemoved = Object.keys(pii.corpus.removed);
    w(`On the whole written corpus (${pii.corpus.texts} texts: the 250 feedbacks and the catalog examples, where the fictional farmer \"Noor\" is the only person name), ${pii.corpus.removedWords} of ${pii.corpus.words} words were removed by mistake${corpusRemoved.length ? ` (${corpusRemoved.join(", ")})` : ""}. Lyon and Valencia were removed before the list of capitalised non-names (cities, units, Wi-Fi, GPS…) was added.`);
    if (pii.transcripts) {
      const tm = pii.transcripts.models as Record<string, J>;
      w();
      w(`Over-scrubbing on **Whisper transcripts** (level-3 clean clips, synthetic voices): Whisper capitalises words that are lowercase in writing (\"Wi-Fi\") and mishears others (\"Frank\" for \"Franc\"). \"Noor\" is the only person in these feedbacks; a removed word within edit distance 2 of \"noor\" (Nor, Nora, Noa) counts as her name.`);
      w();
      w(table(["Model", "Transcripts", "Words", "Noor removed", "Other words removed by mistake", "Which"], Object.entries(tm).map(([m, v]) => [m, `${v.transcripts}`, `${v.words}`, `${v.nameRemovals}`, `${pct(v.falseRemovalRate, 1)} (${v.falseRemovals}/${v.words})`, [...new Set((v.removed as J[]).map((r: J) => r.word))].join(", ") || "–"])));
      w();
      w("Before the allow-list of capitalised non-names and the quantifier rule (\"jeden Frank\"), the same transcripts lost 4 (tiny), 6 (base: Wi-Fi counted as two words, Newson's, Lyon, Frank, Valencia) and 6 (small) words this way; the remaining ones are mishearings (Newson's for Musanze, Frank for Franc at the start of a sentence) or common nouns that Whisper capitalised (Dog, Village).");
    }
    w(`The first-name list (${pii.givenNames} names: US Census 1990, INSEE, Wikidata incl. Rwandan and Burundian names; docs/DATASHEET.md) was widened once after the first run of this check (Rwandan names from Wikidata person labels) and \"Liebe Grüße\" was fixed: these sentences are not a blind test set, so read the recall as optimistic. Real names said by real visitors, through Whisper, are not measured.`);
    w();
  }

  // ---------- Level 3 ----------
  if (l3) {
    w("## Level 3 — end to end on audio (SYNTHETIC voices + real outdoor noise)");
    w();
    w(`${l3.clips} feedbacks from the corpus (${Object.entries(l3.byLang).map(([k2, v]) => `${k2} ${v}`).join(", ")}) spoken by Piper TTS voices (13 voices, varied speakers and speed), clean and mixed with ESC-50 outdoor noise at 20, 10 and 5 dB SNR (eval/data/README.md). Audio → \`analyzeAudioMessage\` (audio checks, Whisper with automatic language detection, audio wiped, analysis) with the calibrated configuration. English translation: ${l3.englishTranslation}. WER references contain the corpus' deliberate typos.`);
    w();
    const s2 = l3.level2SameMessages;
    const rows: (string | number)[][] = [["text (level 2, same messages)", "–", "–", "–", "–", pct(s2.echo.all.remarks.captureRate), pct(s2.echo.all.answers.acceptedErrorRate), num(s2.echo.all.micro.f1), pct(s2.echo.all.chunks.notSureRate), pct(s2.keywords.all.remarks.captureRate), pct(s2.keywords.all.answers.acceptedErrorRate), num(s2.keywords.all.micro.f1)]];
    const kw3 = l3.keywordSet ?? "original";
    const oth3 = kw3 === "blind" ? "original" : "blind";
    const o2 = s2.keywordSets?.[oth3];
    rows[0]!.push(o2 ? `${pct(o2.captureRate)} / ${pct(o2.acceptedErrorRate)}` : "–");
    for (const [m, conds] of Object.entries<J>(l3.models)) {
      for (const [cond, r] of Object.entries<J>(conds)) {
        const o = r.keywordSets?.[oth3];
        rows.push([`${m}, ${cond}`, pct(r.wer), pct(r.languageIdAccuracy, 0), `${r.messageStatus.inaudible ?? 0}`, num(r.realTimeFactor), pct(r.echo.all.remarks.captureRate), pct(r.echo.all.answers.acceptedErrorRate), num(r.echo.all.micro.f1), pct(r.echo.all.chunks.notSureRate), pct(r.keywords.all.remarks.captureRate), pct(r.keywords.all.answers.acceptedErrorRate), num(r.keywords.all.micro.f1), o ? `${pct(o.captureRate)} / ${pct(o.acceptedErrorRate)}` : "–"]);
      }
    }
    w(`Kw = keyword baseline with the \`${kw3}\` lists (the headline baseline); the last column gives the \`${oth3}\` lists (captured / error among accepted) for transparency.`);
    w();
    w(table(["Input", "WER", "Lang right", "Inaudible", "RTF", "Echo captured", "Echo error among accepted", "Echo F1", "Echo not sure", "Kw captured", "Kw error among accepted", "Kw F1", `Kw ${oth3}: captured / error`], rows));
    w();
    w("Inaudible: clips the app refuses to analyse (SPEC 7). The very short feedbacks (\"Thanks!\", \"Meh.\") become clips under 3 s and are");
    w("inaudible by design; they count as missed remarks above. The raw TTS clips (\"clean\") have no silence around the speech, so");
    w("30 of 80 last under 3 s; with the 0.4 s of silence before and after that a real voice note has (\"clean_pad\", and the noisy");
    w("versions), 12 remain under 3 s. Keywords run on the same Whisper transcripts (no inaudible rule).");
    w();
    const anyModel = l3.models["whisper-base"] ? "whisper-base" : Object.keys(l3.models)[0];
    if (anyModel) {
      w(`WER by language (${anyModel}):`);
      w();
      w(table(["Condition", ...LANGS], Object.entries<J>(l3.models[anyModel]).map(([cond, r]) => [cond, ...LANGS.map((l) => pct(r.werByLang[l].wer))])));
      w();
    }
    // Détail par langue, par constat et matrice de confusion (SPEC 9 « Les mesures, langue par langue »)
    if (l3.models["whisper-base"]) {
      for (const cond of ["snr10", "clean_pad"].filter((c) => l3.models["whisper-base"][c])) {
        const r = l3.models["whisper-base"][cond];
        const label = cond === "snr10" ? "whisper-base, 10 dB SNR outdoor noise" : "whisper-base, clean speech with 0.4 s silence around it";
        w(`### Level 3 in detail: ${label} (SYNTHETIC voices, all ${l3.clips} clips)`);
        w();
        w("Per language. P / R / F1: message level. Error among accepted: chunk answers counted that do not match the annotation, with");
        w("its 95 % interval and the number of accepted answers (\"acc.\"); with so few accepted answers per language the intervals");
        w("are very wide. Captured: annotated remarks counted with the right finding. Not sure: share of chunks. Kw: keyword baseline on the");
        w(`same Whisper transcripts (\`${l3.keywordSet ?? "original"}\` lists).`);
        w();
        w(level3LangTable(r));
        w();
        w("Per finding (message level):");
        w();
        w(table(["Finding", "Support", "Echo P", "Echo R", "Echo F1", "Kw P", "Kw R", "Kw F1"],
          Object.keys(r.echo.all.perFinding).map((f) => {
            const a = r.echo.all.perFinding[f];
            const b = r.keywords.all.perFinding[f];
            return [f, a.tp + a.fn, num(a.precision), num(a.recall), num(a.f1), num(b?.precision), num(b?.recall), num(b?.f1)];
          })));
        w();
        w("Confusion matrix (Echo; annotated passages → what Echo did on the overlapping chunks; empty rows and columns hidden):");
        w();
        w(confusionTable(r.echo.all.confusion));
        w();
      }
    }
    // Choix du Whisper
    const base10 = (m: string) => l3.models[m]?.snr10?.echo?.all;
    const cands = ["whisper-tiny", "whisper-base", "whisper-small"].filter((m) => base10(m));
    if (cands.length) {
      const best = Math.max(...cands.map((m) => base10(m).remarks.captureRate));
      const fleursOk = (m: string) => LANGS.every((l) => (l1?.models?.[m]?.[l]?.wer ?? 1) <= 0.3);
      const ok = cands.filter((m) => fleursOk(m) && base10(m).answers.acceptedErrorRate <= 0.1 && base10(m).remarks.captureRate >= best - 0.1);
      w("### Which Whisper (SPEC 4.3: the smallest with acceptable results)");
      w();
      w("Rule: the smallest model that (1) keeps FLEURS WER ≤ 30 % in each visitor language on real voices, and (2) end to end at");
      w("10 dB SNR keeps the error among accepted answers ≤ 10 % and captures at most 10 points fewer remarks than the best model");
      w("(with ~90 remarks the 95 % interval is about ±10 points, so smaller gaps are not distinguishable). The rule was written after");
      w("seeing the numbers; the table lets the reader apply another one.");
      w();
      w(table(["Model", "Size (MB)", "FLEURS WER en/fr/de/es", "10 dB: captured", "10 dB: error among accepted", "Meets rule", "FLEURS RTF (en, 8 threads)"], cands.map((m) => {
        const f = l1?.models?.[m];
        const size = perf?.modelSizes?.[`onnx-community/${m}`]?.totalMB;
        return [m, size ?? "–", f ? LANGS.map((l) => (f[l] ? pct(f[l].wer, 0) : "–")).join(" / ") : "–", pct(base10(m).remarks.captureRate), pct(base10(m).answers.acceptedErrorRate), ok.includes(m) ? "yes" : "no", num(f?.en?.realTimeFactor)];
      })));
      w();
      w(`→ Smallest model meeting the rule: **${ok[0] ?? "none"}**.`);
      w();
    }
  }

  // ---------- Perf ----------
  if (perf) {
    w("## Performance");
    w();
    w(`Machine: ${perf.machine.cpuModel}, ${perf.machine.logicalCpus} logical CPUs, ${perf.machine.platform}. Message: ${perf.message}.`);
    w();
    w(table(["Model", "Files (MB)", "Total (MB)"], Object.entries<J>(perf.modelSizes).filter(([, v]) => v.present).map(([id, v]) => [id, v.files.filter((f: J) => f.mb >= 0.1).map((f: J) => `${f.file} ${f.mb}`).join(", "), v.totalMB])));
    w();
    if (perf.appDownload) w(`App download for the shipped pair: **${perf.appDownload.totalMB} MB** (${perf.appDownload.models.join(" + ")}).`);
    w();
    w(table(["Whisper", "onnxruntime threads", "Load models (s)", "1st run: embed examples + train (s)", "30 s message with EN translation (s)", "without translation (s)", "RSS after loading (MB)", "Peak RSS (MB)"],
      perf.runs.map((r: J) => r.error ? [r.whisper, r.cores, "failed", "", "", "", "", ""] : [r.whisper, r.cores, num(r.loadEmbedderSec + r.loadAsrSec, 1), num(r.firstRunMatcherSec, 1), num(r.message30sWithTranslationSec, 1), num(r.message30sNoTranslationSec, 1), num(r.rssAfterLoadMB, 0), num(r.peakRssMB, 0)])));
    w();
    w("Memory is the whole Node process (onnxruntime-node native libraries alone take ~170 MB, each model is held both as a file");
    w("buffer and as an onnxruntime session, plus the decoding arena). It is an upper bound for the app's own share; a browser tab");
    w("uses onnxruntime-web (WebAssembly) with a different footprint, to be measured on the phone (docs/MANUAL_TESTS.md).");
    w("\"1st run\" = embedding the catalog examples one by one and training the classifier, done once and cached by the app.");
    w();
    if (perf.androidEstimate) {
      w("### Low-end Android: ESTIMATE, not a measurement");
      w();
      for (const line of perf.androidEstimate.lines) w(line);
      w();
    }
    w("The real measurement on a phone is a manual procedure: docs/MANUAL_TESTS.md (\"Performance on a low-end Android\").");
    w();
  }

  w("## Limits of this evaluation");
  w();
  w("- Levels 2–3 are synthetic (written feedback, TTS voices): real visitors are messier (code-switching, names, long rambling voice notes, wind on the microphone, WhatsApp Opus compression).");
  w("- The held-out half has 125 feedbacks; intervals are wide (see brackets). Many choices (classifier, threshold, floor) were made on the calibration half, but the unknown-topic rule and cluster threshold were adjusted after seeing the only recurring-topic example (picking).");
  w("- The catalog examples and the corpus were written by the same team; they are checked for near-duplicates but share a style.");
  w("- The original keyword lists were written by the author of the corpus (they can repeat its wording); the blind lists were not, but were written by the same team that wrote the catalog examples, from the catalog's labels and examples. Neither is a keyword system maintained by a person for months.");
  w("- The held-out half had been evaluated before (previous configuration: 48 % captured, 6 % wrong). The recall changes were decided on the calibration half only, but with the knowledge that Echo captured fewer remarks than keywords on the held-out half.");
  w("- Mozilla Common Voice was not used: it moved to Mozilla Data Collective (account required) in Oct 2025 (docs/DATASHEET.md). FLEURS accents are read speech.");
  w("- The personal-data check uses 52 synthetic sentences written by the team, not names spoken by real visitors through Whisper; the scrubber is a heuristic and misses names (see the recall above).");
  w("- No Kinyarwanda is evaluated here: the host side only plays frozen catalog sentences (catalog back-translation scores are in the catalog).");
  w();

  writeFileSync(join(RESULTS_DIR, "RESULTS.md"), out.join("\n"));
  if (l2) {
    const kwPoint = { coverage: l2.keywords.test.all.chunks.coverage, err: l2.keywords.test.all.answers.acceptedErrorRate };
    const chosen = l2.calibration.scoring === "linear" ? l2.calibration.acceptProbability : l2.calibration.acceptThreshold;
    writeFileSync(join(RESULTS_DIR, "coverage-error-curve.svg"), curveSvg(l2.curves.calibration, l2.curves.test, chosen, kwPoint, `${l2.calibration.variant.name}, probability threshold 0.30–1.00`, l2.calibration.maxAcceptedError ?? 0.05));
  }
  log("[report] eval/results/RESULTS.md written");
}
