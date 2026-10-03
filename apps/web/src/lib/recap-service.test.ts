import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, gsm7Length, validateCatalog, type ReviewChunk } from "@echo/core";
import { addMonths, monthReport, reviewChunksToItems, smsParts, toMonthMessage } from "./recap-service.ts";
import { syntheticCoopFarms, syntheticHistory } from "./synthetic.ts";

const catalog = validateCatalog(JSON.parse(readFileSync(new URL("../../../../catalog/catalog.json", import.meta.url), "utf8")));
const vec = (i: number): Float32Array => {
  const v = new Float32Array(8);
  v[i] = 1;
  return v;
};

describe("recap service", () => {
  it("month arithmetic", () => {
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-10", 3)).toBe("2027-01");
  });

  it("synthetic history makes the path a streak and the recap uses only catalog sentences", () => {
    const month = "2026-10";
    const history = syntheticHistory(month);
    expect(new Set(history.map((m) => m.month))).toEqual(new Set(["2026-07", "2026-08", "2026-09"]));
    const current = [
      toMonthMessage({ id: "a", month, status: "analyzed", findings: [{ id: "N1", confidence: 0.9 }, { id: "P3", confidence: 0.8 }], notSureCount: 0 }),
      toMonthMessage({ id: "b", month, status: "analyzed", findings: [{ id: "P3", confidence: 0.9 }], notSureCount: 1 }),
    ];
    const r = monthReport(month, [...history, ...current], [], catalog, DEFAULT_CONFIG);
    const ids = r.recap.lines.map((l) => l.templateId);
    expect(ids[0]).toBe("volume");
    expect(ids).toContain("fix_streak"); // N1 cité 4 mois de suite
    expect(ids).toContain("not_understood");
    const rwSentences = new Set([...catalog.findings.map((f) => f.kinyarwanda!.rw)]);
    const fix = r.recap.lines.find((l) => l.templateId === "fix_streak")!;
    expect(fix.findingId).toBe("N1");
    expect([...rwSentences].some((s) => fix.rw.endsWith(s))).toBe(true);
    for (const part of r.sms) expect(gsm7Length(part)).toBeLessThanOrEqual(160);
    expect(smsParts(r.recap)).toEqual(r.sms);
  });

  it("an unknown topic from 3 visitors is signalled, never from negation-related not-sure chunks", () => {
    const month = "2026-10";
    const mk = (id: string, msg: string, status: ReviewChunk["status"], reason: string, v: Float32Array): ReviewChunk => ({
      id, messageId: msg, month, status, text: "picking", mentionsGuide: false, reason, embedding: v,
    });
    const chunks = [
      mk("1:0", "1", "off_list", "below_floor", vec(0)),
      mk("2:0", "2", "not_sure", "below_threshold", vec(0)),
      mk("3:0", "3", "not_sure", "negation", vec(0)),
    ];
    const items = reviewChunksToItems(chunks, { unknownTopicSources: "off_list_and_unsure" });
    expect(items.map((i) => i.chunkId)).toEqual(["1:0", "2:0"]);
    const withThird = [...items, { chunkId: "4:0", visitorKey: "4", month, text: "picking", embedding: vec(0) }];
    const msgs = ["1", "2", "4"].map((id) => toMonthMessage({ id, month, status: "analyzed", findings: [], notSureCount: 0 }));
    const r = monthReport(month, msgs, withThird, catalog, DEFAULT_CONFIG);
    expect(r.recurring).toHaveLength(1);
    expect(r.recap.lines.map((l) => l.templateId)).toContain("unknown_topic");
  });

  it("synthetic coop farms are deterministic and all consenting", () => {
    const a = syntheticCoopFarms("2026-10");
    expect(a).toHaveLength(11);
    expect(JSON.stringify(a)).toBe(JSON.stringify(syntheticCoopFarms("2026-10")));
    expect(a.every((f) => f.consent && f.farmId.startsWith("synthetic"))).toBe(true);
  });
});
