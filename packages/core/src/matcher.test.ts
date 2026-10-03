import { describe, expect, it } from "vitest";
import { makeConfig } from "./config.ts";
import { createMatcher, decideChunk, exportExampleEmbeddings, type FindingRawScore } from "./matcher.ts";
import { detectNegation } from "./negation.ts";
import { SIMILARITY_TEST_CONFIG, fakeEmbedder, testCatalog } from "./test-fixtures.ts";
import type { FindingId, NegationInfo } from "./types.ts";

const plain: NegationInfo = { negated: false, uncertain: false, cues: [] };
const raw = (id: FindingId, agree: number, inverted = -1): FindingRawScore => ({ id, agree, inverted, any: Math.max(agree, inverted) });

async function setup(overrides = {}) {
  const embed = fakeEmbedder();
  const matcher = await createMatcher(testCatalog(), embed, makeConfig({ ...SIMILARITY_TEST_CONFIG, ...overrides }));
  const one = async (text: string, lang = "en") => (await matcher.match([{ text, negation: detectNegation(text, lang) }], lang))[0]!;
  return { embed, matcher, one };
}

describe("decideChunk (règles pures)", () => {
  const cfg = makeConfig(SIMILARITY_TEST_CONFIG); // accept 0.6, floor 0.4, marge 0.08, max 2
  it("au-dessus du seuil → rattaché", () => {
    const d = decideChunk([raw("N1", 0.8), raw("P1", 0.3)], plain, cfg);
    expect(d).toMatchObject({ status: "matched", findings: [{ id: "N1", score: 0.8 }] });
  });
  it("entre le plancher et le seuil → pas sûr ; sous le plancher → hors liste", () => {
    expect(decideChunk([raw("N1", 0.5)], plain, cfg)).toMatchObject({ status: "not_sure", reason: "below_threshold", findings: [] });
    expect(decideChunk([raw("N1", 0.3)], plain, cfg)).toMatchObject({ status: "off_list", findings: [] });
  });
  it("au plus 2 constats, et le 2e seulement s'il est au-dessus du seuil et proche du 1er", () => {
    expect(decideChunk([raw("P1", 0.8), raw("P4", 0.78), raw("P3", 0.77)], plain, cfg).findings.map((f) => f.id)).toEqual(["P1", "P4"]);
    expect(decideChunk([raw("P1", 0.8), raw("P4", 0.65)], plain, cfg).findings.map((f) => f.id)).toEqual(["P1"]);
    expect(decideChunk([raw("P1", 0.8), raw("P4", 0.78)], plain, { ...cfg, maxFindingsPerChunk: 1 }).findings).toHaveLength(1);
  });
  it("sens inversé (exemple de négation opposée plus proche) → jamais compté, pas sûr", () => {
    const negated: NegationInfo = { negated: true, uncertain: false, cues: ["not"] };
    expect(decideChunk([raw("N1", 0.2, 0.9)], negated, cfg)).toMatchObject({ status: "not_sure", reason: "negation", findings: [] });
    // même si un autre constat passe le seuil, le doute l'emporte quand l'inversion est plus forte
    expect(decideChunk([raw("N1", 0.2, 0.9), raw("N8", 0.65)], negated, cfg).status).toBe("not_sure");
  });
  it("négation incertaine → pas sûr (sauf si rien ne ressemble : hors liste)", () => {
    const unc: NegationInfo = { negated: true, uncertain: true, cues: ["not bad"] };
    expect(decideChunk([raw("P4", 0.9)], unc, cfg)).toMatchObject({ status: "not_sure", reason: "negation_uncertain" });
    expect(decideChunk([raw("P4", 0.1)], unc, cfg).status).toBe("off_list");
  });
  it("donne toujours les 3 meilleurs scores bruts", () => {
    const d = decideChunk([raw("P1", 0.1), raw("P2", 0.5), raw("P3", 0.3), raw("P4", 0.2)], plain, cfg);
    expect(d.topScores.map((s) => s.id)).toEqual(["P2", "P3", "P4"]);
  });
});

describe("createMatcher (faux embedder)", () => {
  it("plonge les exemples une seule fois, et repère leur négation", async () => {
    const { embed, matcher, one } = await setup();
    expect(embed.calls).toHaveLength(1);
    await one("The meal was delicious");
    await one("The path was too long");
    expect(embed.calls).toHaveLength(3);
    expect(matcher.examples.find((e) => e.text === "There was no shade")?.negated).toBe(true);
    expect(matcher.examples.find((e) => e.text === "The path was too long")?.negated).toBe(false);
  });
  it("réutilise des embeddings d'exemples précalculés (cache) et ne plonge que les manquants", async () => {
    const { matcher } = await setup();
    const cache = exportExampleEmbeddings(matcher);
    cache.delete("Kein Schatten");
    const embed2 = fakeEmbedder();
    const m2 = await createMatcher(testCatalog(), embed2, makeConfig(SIMILARITY_TEST_CONFIG), { precomputed: cache });
    expect(embed2.calls).toEqual([["Kein Schatten"]]);
    expect(m2.examples).toHaveLength(matcher.examples.length);
  });
  it("rattache les paraphrases, dans toutes les langues", async () => {
    const { one } = await setup();
    expect((await one("the path was really too long")).findings.map((f) => f.id)).toEqual(["N1"]);
    expect((await one("Der Weg war viel zu lang", "de")).findings.map((f) => f.id)).toEqual(["N1"]);
    expect((await one("El almuerzo estaba delicioso", "es")).findings.map((f) => f.id)).toEqual(["P4"]);
  });
  it("« the path was not too long » ne donne jamais N1 (négation d'un constat négatif)", async () => {
    const { one } = await setup();
    for (const [t, lang] of [
      ["The path was not too long", "en"],
      ["Le chemin n'était pas trop long", "fr"],
      ["Der Weg war nicht zu lang", "de"],
      ["El camino no era demasiado largo", "es"],
    ] as const) {
      const m = await one(t, lang);
      expect(m.findings.map((f) => f.id)).not.toContain("N1");
      expect(m.status).toBe("not_sure");
      expect(m.reason).toBe("negation");
    }
  });
  it("une négation qui EST le constat reste comptée (« there was no shade » → N8)", async () => {
    const { one } = await setup();
    expect((await one("There was no shade at all")).findings.map((f) => f.id)).toEqual(["N8"]);
    expect((await one("Es gab keinen Schatten", "de")).findings.map((f) => f.id)).toEqual(["N8"]);
    expect((await one("We couldn't buy any coffee")).findings.map((f) => f.id)).toEqual(["N10"]);
  });
  it("positif nié (« the food was not good ») ne donne jamais P4", async () => {
    const { one } = await setup();
    const m = await one("The food was not good");
    expect(m.findings).toEqual([]);
    expect(m.status).toBe("not_sure");
  });
  it("sujet hors catalogue → hors liste", async () => {
    const { one } = await setup();
    expect((await one("Picking cherries was the highlight")).status).toBe("off_list");
  });
  it("crossLingual=false : n'utilise que les exemples de la langue détectée", async () => {
    const { matcher } = await setup({ crossLingual: false });
    const [s] = await matcher.score([{ text: "Der Weg war zu lang", negation: plain }], "de");
    expect(s!.scores.find((x) => x.id === "N1")!.agree).toBeCloseTo(1, 5);
  });
  it("topk_mean : moyenne des k meilleurs exemples", async () => {
    const { matcher } = await setup({ aggregation: "topk_mean", topK: 2 });
    const [s] = await matcher.score([{ text: "Der Weg war zu lang", negation: plain }], "de");
    const n1 = s!.scores.find((x) => x.id === "N1")!;
    expect(n1.agree).toBeLessThanOrEqual(1);
    expect(n1.agree).toBeGreaterThan(0.6);
  });
});

describe("mode linear (régression logistique sur les exemples)", () => {
  const lin = makeConfig({ scoring: "linear", acceptProbability: 0.6, offListThreshold: 0.3 });
  const rawP = (id: FindingId, probability: number, agree = 0.7, inverted = -1): FindingRawScore => ({ id, agree, inverted, any: Math.max(agree, inverted), probability });
  it("accepte le constat le plus probable au-dessus du seuil de probabilité", () => {
    expect(decideChunk([rawP("N1", 0.8), rawP("P1", 0.1)], plain, lin)).toMatchObject({ status: "matched", findings: [{ id: "N1", score: 0.8 }] });
  });
  it("probabilité trop basse → pas sûr ; cosinus sous le plancher → hors liste", () => {
    expect(decideChunk([rawP("N1", 0.5), rawP("P1", 0.4)], plain, lin)).toMatchObject({ status: "not_sure", reason: "below_threshold" });
    expect(decideChunk([rawP("N1", 0.9, 0.2)], plain, lin)).toMatchObject({ status: "off_list" });
  });
  it("accord de négation : exemples de négation opposée plus proches → pas sûr (negation)", () => {
    const neg: NegationInfo = { negated: true, uncertain: false, cues: ["not"] };
    expect(decideChunk([rawP("N1", 0.9, 0.4, 0.8)], neg, lin)).toMatchObject({ status: "not_sure", reason: "negation", findings: [] });
  });
  it("negationMargin tolère un léger avantage des exemples de négation opposée, jamais un constat sans exemple de même négation", () => {
    const loose = { ...lin, negationMargin: 0.1 };
    expect(decideChunk([rawP("N8", 0.9, 0.75, 0.8)], plain, loose)).toMatchObject({ status: "matched" });
    expect(decideChunk([rawP("N8", 0.9, 0.6, 0.8)], plain, loose)).toMatchObject({ status: "not_sure", reason: "negation" });
    expect(decideChunk([rawP("N1", 0.9, -1, 0.8)], plain, { ...lin, negationMargin: 5 })).toMatchObject({ status: "not_sure", reason: "negation" });
  });
  it("le matcher entraîne le classifieur sur les exemples et le réutilise s'il est fourni", async () => {
    const embed = fakeEmbedder();
    const m = await createMatcher(testCatalog(), embed, lin);
    expect(m.classifier?.classes.length).toBe(testCatalog().findings.length);
    const [s] = await m.score([{ text: "The path to the farm was far too long", negation: plain }], "en");
    const best = [...s!.scores].sort((a, b) => b.probability! - a.probability!)[0]!;
    expect(best.id).toBe("N1");
    const m2 = await createMatcher(testCatalog(), embed, lin, { classifier: m.classifier });
    expect(m2.classifier).toBe(m.classifier);
  });
});
