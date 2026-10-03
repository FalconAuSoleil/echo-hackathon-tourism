import { describe, expect, it } from "vitest";
import { unknownTopicItems } from "./offlist.ts";
import type { ChunkResult, MessageAnalysis } from "./types.ts";

const chunk = (id: string, status: ChunkResult["status"], reason: string): ChunkResult => ({
  id,
  text: id,
  sentenceIndex: 0,
  clauseIndex: 0,
  status,
  findings: [],
  topScores: [],
  negation: { negated: false, uncertain: false, cues: [] },
  mentionsGuide: false,
  reason,
  embedding: Float32Array.from([1, 0]),
});
const msg = (id: string, status: MessageAnalysis["status"], chunks: ChunkResult[]): MessageAnalysis => ({
  id, receivedAt: "2026-10-01T00:00:00Z", month: "2026-10", source: "text", lang: "en", status, scrubbedText: "", chunks,
  findings: [], coopFindings: [], fingerprint: id, notSureCount: 0, offListCount: 0,
});

describe("unknownTopicItems", () => {
  const as = [
    msg("a", "analyzed", [chunk("a:0", "off_list", "below_floor"), chunk("a:1", "not_sure", "below_threshold"), chunk("a:2", "not_sure", "negation")]),
    msg("b", "duplicate", [chunk("b:0", "off_list", "below_floor")]),
  ];
  it("off_list : seulement les morceaux hors liste des messages analysés", () => {
    expect(unknownTopicItems(as, "off_list").map((i) => i.chunkId)).toEqual(["a:0"]);
  });
  it("off_list_and_unsure : ajoute les « pas sûr » sous le seuil, jamais ceux dus à une négation", () => {
    expect(unknownTopicItems(as, "off_list_and_unsure").map((i) => i.chunkId)).toEqual(["a:0", "a:1"]);
  });
});
