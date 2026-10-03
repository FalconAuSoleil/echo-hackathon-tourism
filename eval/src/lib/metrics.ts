// Mesures du classement (SPEC 9) à partir des sorties d'un système (Echo ou mots-clés) et des annotations.
//
// Définitions (écrites aussi dans RESULTS.md) :
// - Message : constats prédits (union des morceaux) contre `expectedFindings` → TP / FP / FN, P/R/F1.
// - Réponse acceptée : un couple (morceau, constat) que le système compte. Elle est JUSTE si le morceau
//   est aligné sur un passage annoté `finding` de ce constat ; s'il n'est aligné sur aucun passage annoté,
//   juste si le constat est attendu dans le message (et pas nié). Taux d'erreur parmi les réponses acceptées
//   = fausses / acceptées.
// - Remarque : un passage annoté `finding`. Captée correctement si un morceau aligné porte ce constat.
// - Alignement : un morceau prédit et un passage annoté partagent au moins la moitié des mots du plus court.
import type { FindingId } from "@echo/core";
import { words } from "@echo/core";
import type { AnnotatedChunk, Feedback } from "./corpus.ts";
import { round } from "./io.ts";

export type PredStatus = "matched" | "not_sure" | "off_list";

export interface PredChunk {
  text: string;
  status: PredStatus;
  findings: FindingId[];
  reason?: string;
}

export interface SystemOutput {
  id: string;
  /** Statut du message (Echo) : analyzed | not_sure | inaudible | duplicate ; "keywords" pour la référence. */
  messageStatus: string;
  chunks: PredChunk[];
  findings: FindingId[];
}

export const ALL_FINDINGS: FindingId[] = [
  "P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10", "P11",
  "N1", "N2", "N3", "N4", "N5", "N6", "N7", "N8", "N9", "N10",
];

function overlap(a: readonly string[], b: readonly string[]): number {
  const m = new Map<string, number>();
  for (const w of a) m.set(w, (m.get(w) ?? 0) + 1);
  let n = 0;
  for (const w of b) {
    const c = m.get(w) ?? 0;
    if (c > 0) {
      n++;
      m.set(w, c - 1);
    }
  }
  return n;
}

export function aligned(predWords: readonly string[], spanWords: readonly string[]): boolean {
  const ov = overlap(predWords, spanWords);
  return ov >= 1 && ov >= 0.5 * Math.min(predWords.length, spanWords.length);
}

/** Wilson 95 % pour une proportion. */
export function wilson(k: number, n: number): [number, number] {
  if (n === 0) return [0, 1];
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const r = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [round((c - r) / d, 4), round((c + r) / d, 4)];
}

const prf = (tp: number, fp: number, fn: number) => {
  const p = tp + fp ? tp / (tp + fp) : 0;
  const r = tp + fn ? tp / (tp + fn) : 0;
  return { tp, fp, fn, precision: round(p, 4), recall: round(r, 4), f1: round(p + r ? (2 * p * r) / (p + r) : 0, 4) };
};

export type ConfusionRow = "none" | "not_sure(ambiguous)" | "off_list" | "negated" | FindingId;

export interface Metrics {
  messages: number;
  micro: ReturnType<typeof prf>;
  macroF1: number;
  perFinding: Record<string, ReturnType<typeof prf>>;
  exactMatchRate: number;
  messageStatus: Record<string, number>;
  chunks: { total: number; matched: number; notSure: number; offList: number; coverage: number; notSureRate: number; offListRate: number };
  answers: { accepted: number; wrong: number; acceptedErrorRate: number; ci95: [number, number] };
  remarks: { total: number; captured: number; captureRate: number; ci95: [number, number]; wrongFinding: number; notSure: number; offList: number; missing: number };
  /** Passages annotés « pas sûr » (ambigus) : part qui finit sans constat, part qui reçoit un constat (erreur). */
  ambiguous: { total: number; noFinding: number; gotFinding: number; notSure: number };
  offListSpans: { total: number; offList: number; notSure: number; gotFinding: number };
  /** Négations qui annulent un constat : jamais le constat nié (SPEC 7). */
  negationCancels: { messages: number; spans: number; violations: number; accuracy: number };
  /** Négations qui SONT le constat (« no shade » → N8) : rappel. */
  negationInherent: { messages: number; expected: number; found: number; recall: number };
  confusion: { rows: string[]; cols: string[]; counts: number[][] };
}

/** Étiquette attendue d'un passage annoté (ligne de la matrice de confusion). */
function rowOf(c: AnnotatedChunk): ConfusionRow {
  if (c.kind === "finding") return c.finding!;
  if (c.kind === "not_sure") return "not_sure(ambiguous)";
  if (c.kind === "off_list") return "off_list";
  return "negated";
}

export function evaluate(feedbacks: readonly Feedback[], outputs: ReadonlyMap<string, SystemOutput>): Metrics {
  const counts = new Map<string, { tp: number; fp: number; fn: number }>(ALL_FINDINGS.map((f) => [f, { tp: 0, fp: 0, fn: 0 }]));
  let exact = 0;
  const messageStatus: Record<string, number> = {};
  const ch = { total: 0, matched: 0, notSure: 0, offList: 0 };
  let accepted = 0;
  let wrong = 0;
  const rem = { total: 0, captured: 0, wrongFinding: 0, notSure: 0, offList: 0, missing: 0 };
  const amb = { total: 0, noFinding: 0, gotFinding: 0, notSure: 0 };
  const off = { total: 0, offList: 0, notSure: 0, gotFinding: 0 };
  const negC = { messages: 0, spans: 0, violations: 0 };
  const negI = { messages: 0, expected: 0, found: 0 };
  const cols = [...ALL_FINDINGS, "not_sure", "off_list", "nothing"];
  const rows: string[] = [...ALL_FINDINGS, "not_sure(ambiguous)", "off_list", "negated"];
  const conf = rows.map(() => cols.map(() => 0));
  const bump = (r: string, c: string) => {
    conf[rows.indexOf(r)]![cols.indexOf(c)]!++;
  };

  for (const fb of feedbacks) {
    const out = outputs.get(fb.id);
    if (!out) throw new Error(`no output for ${fb.id}`);
    messageStatus[out.messageStatus] = (messageStatus[out.messageStatus] ?? 0) + 1;
    const expected = new Set(fb.expectedFindings);
    const predicted = new Set(out.findings);
    for (const f of ALL_FINDINGS) {
      const c = counts.get(f)!;
      if (predicted.has(f) && expected.has(f)) c.tp++;
      else if (predicted.has(f)) c.fp++;
      else if (expected.has(f)) c.fn++;
    }
    if (expected.size === predicted.size && [...expected].every((f) => predicted.has(f))) exact++;

    const spanWords = fb.chunks.map((c) => words(c.span));
    const predWords = out.chunks.map((c) => words(c.text));
    const align = predWords.map((pw) => spanWords.map((sw) => aligned(pw, sw)));

    // Morceaux et réponses acceptées.
    for (const [i, pc] of out.chunks.entries()) {
      ch.total++;
      if (pc.status === "matched") ch.matched++;
      else if (pc.status === "not_sure") ch.notSure++;
      else ch.offList++;
      for (const f of pc.findings) {
        accepted++;
        const spans = fb.chunks.filter((_, j) => align[i]![j]);
        const ok = spans.length > 0 ? spans.some((s) => s.kind === "finding" && s.finding === f) : expected.has(f) && !fb.mustNotFindings.includes(f);
        if (!ok) wrong++;
      }
    }

    // Passages annotés (centré annotation).
    for (const [j, span] of fb.chunks.entries()) {
      const preds = out.chunks.filter((_, i) => align[i]![j]);
      const predFindings = preds.flatMap((p) => p.findings);
      const anyNotSure = preds.some((p) => p.status === "not_sure");
      const anyOff = preds.some((p) => p.status === "off_list");
      let col: string;
      if (span.kind === "finding" && predFindings.includes(span.finding!)) col = span.finding!;
      else if (predFindings.length > 0) col = predFindings[0]!;
      else if (anyNotSure) col = "not_sure";
      else if (anyOff) col = "off_list";
      else col = "nothing";
      bump(rowOf(span), col);

      if (span.kind === "finding") {
        rem.total++;
        if (col === span.finding) rem.captured++;
        else if (predFindings.length > 0) rem.wrongFinding++;
        else if (col === "not_sure") rem.notSure++;
        else if (col === "off_list") rem.offList++;
        else rem.missing++;
      } else if (span.kind === "not_sure") {
        amb.total++;
        if (predFindings.length > 0) amb.gotFinding++;
        else amb.noFinding++;
        if (col === "not_sure") amb.notSure++;
      } else if (span.kind === "off_list") {
        off.total++;
        if (predFindings.length > 0) off.gotFinding++;
        else if (col === "not_sure") off.notSure++;
        else off.offList++;
      } else if (span.kind === "negated" && span.negates) {
        negC.spans++;
        if (predFindings.includes(span.negates)) negC.violations++;
      }
    }
    if (fb.flags.negation === "cancels") negC.messages++;
    if (fb.flags.negation === "inherent") {
      negI.messages++;
      negI.expected += fb.expectedFindings.length;
      negI.found += fb.expectedFindings.filter((f) => predicted.has(f)).length;
    }
  }

  const perFinding = Object.fromEntries([...counts.entries()].map(([f, c]) => [f, prf(c.tp, c.fp, c.fn)]));
  const tot = [...counts.values()].reduce((a, c) => ({ tp: a.tp + c.tp, fp: a.fp + c.fp, fn: a.fn + c.fn }), { tp: 0, fp: 0, fn: 0 });
  const present = Object.values(perFinding).filter((p) => p.tp + p.fn > 0);
  return {
    messages: feedbacks.length,
    micro: prf(tot.tp, tot.fp, tot.fn),
    macroF1: round(present.reduce((a, p) => a + p.f1, 0) / Math.max(1, present.length), 4),
    perFinding,
    exactMatchRate: round(exact / Math.max(1, feedbacks.length), 4),
    messageStatus,
    chunks: {
      ...ch,
      coverage: round(ch.matched / Math.max(1, ch.total), 4),
      notSureRate: round(ch.notSure / Math.max(1, ch.total), 4),
      offListRate: round(ch.offList / Math.max(1, ch.total), 4),
    },
    answers: { accepted, wrong, acceptedErrorRate: round(accepted ? wrong / accepted : 0, 4), ci95: wilson(wrong, accepted) },
    remarks: { ...rem, captureRate: round(rem.captured / Math.max(1, rem.total), 4), ci95: wilson(rem.captured, rem.total) },
    ambiguous: amb,
    offListSpans: off,
    negationCancels: { ...negC, accuracy: round(negC.spans ? 1 - negC.violations / negC.spans : 1, 4) },
    negationInherent: { ...negI, recall: round(negI.expected ? negI.found / negI.expected : 0, 4) },
    confusion: { rows, cols, counts: conf },
  };
}

/** Mesures globales et par langue. */
export function evaluateByLang(feedbacks: readonly Feedback[], outputs: ReadonlyMap<string, SystemOutput>) {
  const langs = [...new Set(feedbacks.map((f) => f.lang))].sort();
  return {
    all: evaluate(feedbacks, outputs),
    byLang: Object.fromEntries(langs.map((l) => [l, evaluate(feedbacks.filter((f) => f.lang === l), outputs)])),
  };
}

/** Version compacte (sans matrice ni détail par constat) pour les tableaux et les balayages. */
export function summary(m: Metrics) {
  return {
    messages: m.messages,
    precision: m.micro.precision,
    recall: m.micro.recall,
    f1: m.micro.f1,
    macroF1: m.macroF1,
    acceptedErrorRate: m.answers.acceptedErrorRate,
    acceptedErrorCi95: m.answers.ci95,
    accepted: m.answers.accepted,
    coverage: m.chunks.coverage,
    notSureRate: m.chunks.notSureRate,
    offListRate: m.chunks.offListRate,
    captureRate: m.remarks.captureRate,
    captureCi95: m.remarks.ci95,
    negationCancelsAccuracy: m.negationCancels.accuracy,
    negationInherentRecall: m.negationInherent.recall,
    ambiguousGotFinding: m.ambiguous.gotFinding,
    offListGotFinding: m.offListSpans.gotFinding,
  };
}
