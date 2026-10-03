import { describe, expect, it } from "vitest";
import type { Feedback } from "./corpus.ts";
import { splitCorpus } from "./corpus.ts";
import { aligned, evaluate, wilson, type SystemOutput } from "./metrics.ts";

const fb = (id: string, text: string, chunks: Feedback["chunks"], expected: Feedback["expectedFindings"], mustNot: Feedback["mustNotFindings"] = [], negation: Feedback["flags"]["negation"] = null): Feedback => ({
  id, lang: "en", text, synthetic: true, expectedFindings: expected, mustNotFindings: mustNot, chunks,
  flags: { negation, multiFinding: false, typo: false, length: "medium", offList: false, offListTopics: [], ambiguous: false, picking: false, mentionsGuide: false },
});

describe("metrics", () => {
  const f1 = fb("a", "The lunch was delicious but the road was brutal.", [
    { span: "The lunch was delicious", kind: "finding", finding: "P4" },
    { span: "the road was brutal.", kind: "finding", finding: "N1" },
  ], ["P4", "N1"]);
  const f2 = fb("b", "The walk was not too long.", [{ span: "The walk was not too long.", kind: "negated", negates: "N1" }], [], ["N1"], "cancels");

  it("alignement par mots communs", () => {
    expect(aligned(["the", "lunch", "was", "delicious"], ["the", "lunch", "was", "delicious"])).toBe(true);
    expect(aligned(["the", "road"], ["lunch", "delicious", "great", "food"])).toBe(false);
  });

  it("réponses acceptées, remarques captées, négations", () => {
    const outs = new Map<string, SystemOutput>([
      ["a", { id: "a", messageStatus: "analyzed", findings: ["P4", "P3"], chunks: [
        { text: "The lunch was delicious", status: "matched", findings: ["P4"] },
        { text: "the road was brutal.", status: "matched", findings: ["P3"] },
      ] }],
      ["b", { id: "b", messageStatus: "analyzed", findings: ["N1"], chunks: [{ text: "The walk was not too long.", status: "matched", findings: ["N1"] }] }],
    ]);
    const m = evaluate([f1, f2], outs);
    expect(m.answers).toMatchObject({ accepted: 3, wrong: 2 });
    expect(m.remarks).toMatchObject({ total: 2, captured: 1, wrongFinding: 1 });
    expect(m.negationCancels).toMatchObject({ spans: 1, violations: 1, accuracy: 0 });
    expect(m.micro).toMatchObject({ tp: 1, fp: 2, fn: 1 });
  });

  it("intervalle de Wilson", () => {
    const [lo, hi] = wilson(5, 100);
    expect(lo).toBeGreaterThan(0.01);
    expect(hi).toBeLessThan(0.12);
  });

  it("partage stratifié déterministe et disjoint", () => {
    const items = Array.from({ length: 20 }, (_, i) => fb(`x${String(i).padStart(2, "0")}`, "t", [], []));
    const a = splitCorpus(items);
    const b = splitCorpus(items);
    expect(a.calibration.map((f) => f.id)).toEqual(b.calibration.map((f) => f.id));
    expect(a.calibration.length + a.test.length).toBe(20);
    expect(a.calibration.some((f) => a.test.includes(f))).toBe(false);
  });
});
