import { describe, expect, it } from "vitest";
import { clusterOffList, recurringUnknownVisitors, unknownTopicItems } from "./offlist.ts";
import { closeMonthReviewChunks, clustersFromStoredChunks, isClosedMonth, monthClustersFromReview, reviewChunkCandidates, type ReviewChunk } from "./storage.ts";
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

describe("fermeture d'un mois : groupes écrits, embeddings retirés (SPEC 6)", () => {
  const cfg = { offListClusterThreshold: 0.8, offListMinVisitors: 3, unknownTopicSources: "off_list_and_unsure" as const };
  const rc = (id: string, messageId: string, v: number[], status: ReviewChunk["status"] = "off_list", reason = "below_floor"): ReviewChunk => ({
    id, messageId, month: "2026-09", status, text: id, mentionsGuide: false, reason, embedding: Float32Array.from(v),
  });
  const chunks = [
    rc("a:0", "a", [1, 0]),
    rc("b:0", "b", [0.99, 0.14]),
    rc("c:1", "c", [0.98, 0.2], "not_sure", "below_threshold"),
    rc("d:0", "d", [0, 1]),
    rc("e:0", "e", [1, 0], "not_sure", "negation_uncertain"),
  ];
  it("même groupes que le regroupement sur embeddings, puis plus aucun embedding", () => {
    const closed = closeMonthReviewChunks(chunks, cfg);
    expect(closed).toHaveLength(5);
    expect(closed.every((c) => !("embedding" in c))).toBe(true);
    const live = clusterOffList(reviewChunkCandidates(chunks, cfg), cfg);
    expect(clustersFromStoredChunks(closed)).toEqual(live);
    expect(closed.find((c) => c.id === "a:0")).toMatchObject({ clusterId: "offlist:a:0", clusterRecurring: true });
    expect(closed.find((c) => c.id === "d:0")).toMatchObject({ clusterRecurring: false });
    // « Pas sûr » à cause d'une négation : jamais candidat, mais son embedding est retiré aussi.
    expect(closed.find((c) => c.id === "e:0")!.clusterId).toBeUndefined();
    expect(recurringUnknownVisitors(clustersFromStoredChunks(closed))).toBe(3);
  });
  it("idempotent ; un retardataire est regroupé seul, sans rejoindre un groupe fermé", () => {
    const closed = closeMonthReviewChunks(chunks, cfg);
    expect(closeMonthReviewChunks(closed, cfg)).toEqual([]);
    const late = rc("f:0", "f", [1, 0]);
    const again = closeMonthReviewChunks([...closed, late], cfg);
    const { embedding: _e, ...lateText } = late;
    expect(again).toEqual([{ ...lateText, clusterId: "offlist:f:0", clusterRecurring: false }]);
    const all = monthClustersFromReview("2026-09", [...closed, ...again], cfg);
    expect(all.map((c) => c.distinctVisitors)).toEqual([3, 1, 1]);
  });
  it("mois en cours : groupes calculés sur les embeddings encore là", () => {
    expect(monthClustersFromReview("2026-09", chunks, cfg)).toEqual(clusterOffList(reviewChunkCandidates(chunks, cfg), cfg));
    expect(isClosedMonth("2026-09", "2026-10")).toBe(true);
    expect(isClosedMonth("2026-10", "2026-10")).toBe(false);
  });
});
