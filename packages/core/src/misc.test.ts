import { describe, expect, it } from "vitest";
import { keywordAnalyze, keywordClassify, keywordListsFromFiles, type KeywordLists } from "./baseline.ts";
import { aggregateCooperative } from "./coop.ts";
import { checkDuplicate, fingerprint } from "./duplicates.ts";
import { detectTextLanguage } from "./language.ts";
import { clusterOffList, recurringUnknownVisitors, type OffListItem } from "./offlist.ts";
import { fakeVector, testCatalog } from "./test-fixtures.ts";
import { computeAudioStats } from "./audio-stats.ts";

describe("fingerprint / checkDuplicate", () => {
  it("même texte à la casse, la ponctuation et aux accents près → même empreinte", () => {
    expect(fingerprint("Le repas était délicieux !")).toBe(fingerprint("le repas etait delicieux"));
    expect(fingerprint("Le repas était délicieux")).not.toBe(fingerprint("Le repas était froid"));
    expect(fingerprint("x")).toMatch(/^[0-9a-f]{28}$/);
  });
  it("quasi-doublon par embedding, dans la fenêtre de dates", () => {
    const e = fakeVector("The meal was delicious");
    const cfg = { duplicateEmbeddingThreshold: 0.98, duplicateWindowDays: 7 };
    const known = [{ fingerprint: "other", receivedAt: "2026-10-01T00:00:00Z", embedding: e }];
    expect(checkDuplicate({ fingerprint: "x", receivedAt: "2026-10-02T00:00:00Z", embedding: e }, known, cfg)).toEqual({ duplicate: true, reason: "duplicate_embedding" });
    expect(checkDuplicate({ fingerprint: "x", receivedAt: "2026-10-20T00:00:00Z", embedding: e }, known, cfg).duplicate).toBe(false);
    expect(checkDuplicate({ fingerprint: "x", embedding: fakeVector("The path was too long") }, known, cfg).duplicate).toBe(false);
  });
});

describe("clusterOffList (SPEC 4.5)", () => {
  const item = (chunkId: string, visitorKey: string, text: string, month = "2026-10"): OffListItem => ({ chunkId, visitorKey, month, text, embedding: fakeVector(text) });
  const cfg = { offListClusterThreshold: 0.55, offListMinVisitors: 3 };

  it("regroupe la cueillette en 3 langues chez 3 visiteurs → sujet récurrent, sans le nommer", () => {
    const items = [
      item("a:0", "a", "Picking cherries was the best part"),
      item("b:1", "b", "Kirschen pflücken war toll"),
      item("c:0", "c", "La cueillette des cerises était géniale"),
      item("d:0", "d", "My phone battery died"),
    ];
    const clusters = clusterOffList(items, cfg);
    const picking = clusters.find((c) => c.chunkIds.includes("a:0"))!;
    expect(picking.chunkIds.sort()).toEqual(["a:0", "b:1", "c:0"]);
    expect(picking).toMatchObject({ distinctVisitors: 3, recurring: true });
    expect(Object.keys(picking)).not.toContain("label");
    expect(clusters.find((c) => c.chunkIds.includes("d:0"))!.recurring).toBe(false);
    expect(recurringUnknownVisitors(clusters)).toBe(3);
  });
  it("le même visiteur répété ne fait pas un sujet récurrent", () => {
    const items = [
      item("a:0", "a", "Picking cherries was fun"),
      item("a:1", "a", "We loved picking cherries"),
      item("b:0", "b", "Cherry picking was great"),
    ];
    const clusters = clusterOffList(items, cfg);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({ distinctVisitors: 2, recurring: false });
    expect(recurringUnknownVisitors(clusters)).toBe(0);
  });
  it("vide → aucun groupe", () => {
    expect(clusterOffList([], cfg)).toEqual([]);
  });
});

describe("keyword baseline", () => {
  const kw: KeywordLists = {
    N1: { en: ["path", "far", "long walk"], fr: ["chemin"] },
    P5: { en: ["explan"] },
    P4: { de: ["essen"] },
  };
  it("début de mot (racines), locutions ; aucune gestion de la négation (référence naïve)", () => {
    expect(keywordClassify("The path was not too long", "en", kw)).toEqual(["N1"]);
    expect(keywordClassify("It was a long walk", "en", kw)).toEqual(["N1"]);
    expect(keywordClassify("Great explanations", "en", kw)).toEqual(["P5"]);
    expect(keywordClassify("The pathway was nice", "en", kw)).toEqual(["N1"]);
    expect(keywordClassify("Le CHEMIN était dur", "fr", kw)).toEqual(["N1"]);
    expect(keywordClassify("A sociopath", "en", kw)).toEqual([]); // jamais au milieu d'un mot
  });
  it("mode mot entier", () => {
    expect(keywordClassify("The pathway was nice", "en", kw, "word")).toEqual([]);
    expect(keywordClassify("Great explanations", "en", kw, "word")).toEqual([]);
    expect(keywordClassify("the path", "en", kw, "word")).toEqual(["N1"]);
  });
  it("lit le format des fichiers eval/keywords/<lang>.json", () => {
    const lists = keywordListsFromFiles([
      { lang: "en", findings: { P1: ["welcom"] } },
      { lang: "de", findings: { P1: ["herzlich"], P3: ["röst"] } },
    ]);
    expect(lists).toEqual({ P1: { en: ["welcom"], de: ["herzlich"] }, P3: { de: ["röst"] } });
    expect(keywordClassify("Die Röstung war toll", "de", lists)).toEqual(["P3"]);
    expect(keywordClassify("Such a warm welcome", "en", lists)).toEqual(["P1"]);
  });
  it("langue sans liste ou inconnue : toutes les listes", () => {
    expect(keywordClassify("Das Essen war gut", "unknown", kw)).toEqual(["P4"]);
    expect(keywordClassify("das essen", "es", kw)).toEqual(["P4"]);
  });
  it("lit aussi les mots-clés du catalogue, et analyse un message entier", () => {
    const cat = testCatalog();
    cat.findings.find((f) => f.id === "P3")!.keywords.de = ["röstung"];
    expect(keywordClassify("Die Röstung war toll", "de", cat)).toEqual(["P3"]);
    const a = keywordAnalyze("The path was far. Great explanations!", "en", kw);
    expect(a.chunks.map((c) => c.findings)).toEqual([["N1"], ["P5"]]);
    expect(a.findings).toEqual(["N1", "P5"]);
  });
});

describe("aggregateCooperative (SPEC 4.7)", () => {
  it("compte les fermes consentantes seulement, jamais les constats « guide », jamais de texte", () => {
    const cat = testCatalog();
    const agg = aggregateCooperative(
      [
        { farmId: "f1", consent: true, messages: [{ month: "2026-10", status: "analyzed", coopFindings: ["N1", "P3"] }, { month: "2026-10", status: "analyzed", coopFindings: ["N1"] }] },
        { farmId: "f2", consent: true, messages: [{ month: "2026-10", status: "analyzed", coopFindings: ["P3"] }, { month: "2026-10", status: "duplicate", coopFindings: ["N1"] }] },
        { farmId: "f3", consent: false, messages: [{ month: "2026-10", status: "analyzed", coopFindings: ["N1"] }] },
        { farmId: "f4", consent: true, messages: [{ month: "2026-09", status: "analyzed", coopFindings: ["N9"] }] },
      ],
      cat,
      { months: ["2026-10"] },
    );
    expect(agg.consentingFarms).toBe(3);
    expect(agg.messages).toBe(3);
    expect(agg.findings).toEqual([
      { id: "P3", polarity: "positive", farms: 2, mentions: 2 },
      { id: "N1", polarity: "negative", farms: 1, mentions: 2 },
    ]);
  });
});

describe("detectTextLanguage", () => {
  it("devine en/fr/de/es et renvoie unknown sans indice", () => {
    expect(detectTextLanguage("The path was too long but the coffee was great").lang).toBe("en");
    expect(detectTextLanguage("Le chemin était trop long mais le café était bon").lang).toBe("fr");
    expect(detectTextLanguage("Der Weg war zu lang, aber der Kaffee war gut").lang).toBe("de");
    expect(detectTextLanguage("El camino era demasiado largo pero el café muy rico").lang).toBe("es");
    expect(detectTextLanguage("Njia ilikuwa ndefu sana").lang).toBe("unknown");
    // echo-recall : á/í/ó/ú signalent l'espagnol, mots outils fréquents ajoutés
    expect(detectTextLanguage("Duró poco, una pena").lang).toBe("es");
    expect(detectTextLanguage("Thanks for everything").lang).toBe("en");
    expect(detectTextLanguage("Bien reçus, merci").lang).toBe("fr");
    expect(detectTextLanguage("Alles prima, gerne").lang).toBe("de");
    expect(detectTextLanguage("Murakoze cyane").lang).toBe("unknown");
  });
});

describe("computeAudioStats", () => {
  it("durée, énergie, dynamique", () => {
    const silent = computeAudioStats(new Float32Array(16000 * 4));
    expect(silent).toMatchObject({ durationSec: 4, rms: 0 });
    const a = new Float32Array(16000);
    a.fill(0.5);
    expect(computeAudioStats(a).rms).toBeCloseTo(0.5, 5);
    expect(computeAudioStats(new Float32Array(0)).durationSec).toBe(0);
  });
});
