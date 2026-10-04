import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { toReviewChunks, toStoredMessage, type MessageAnalysis } from "@echo/core";
import { closeFinishedMonths, enqueue, getSettings, knownMessages, openEchoDB, pruneExpiredEmbeddings, queuedMonths, saveAnalysis, saveSettings, wipeAll } from "./db.ts";
import { monthClustersFromReview, DEFAULT_CONFIG, type ReviewChunk } from "@echo/core";

const analysis: MessageAnalysis = {
  id: "m1",
  receivedAt: "2026-10-04T10:00:00.000Z",
  month: "2026-10",
  source: "text",
  lang: "en",
  status: "analyzed",
  scrubbedText: "The tasting was great. We picked cherries.",
  chunks: [
    { id: "m1:0", text: "The tasting was great.", sentenceIndex: 0, clauseIndex: 0, status: "matched", findings: [{ id: "P3", score: 0.9 }], topScores: [], negation: { negated: false, uncertain: false, cues: [] }, mentionsGuide: false },
    { id: "m1:1", text: "We picked cherries.", sentenceIndex: 1, clauseIndex: 0, status: "not_sure", findings: [], topScores: [], negation: { negated: false, uncertain: false, cues: [] }, mentionsGuide: false, reason: "below_threshold", embedding: new Float32Array([1, 0]) },
  ],
  findings: [{ id: "P3", score: 0.9 }],
  coopFindings: ["P3"],
  fingerprint: "abc",
  notSureCount: 1,
  offListCount: 0,
};

describe("IndexedDB storage", () => {
  it("message embeddings are removed once older than the duplicate window (7 days)", async () => {
    const db = await openEchoDB("test-prune");
    const emb = new Float32Array([0.6, 0.8]);
    await saveAnalysis(db, { ...toStoredMessage(analysis), id: "old", receivedAt: "2026-09-20T10:00:00.000Z", embedding: emb }, []);
    await saveAnalysis(db, { ...toStoredMessage(analysis), id: "new", receivedAt: "2026-10-03T10:00:00.000Z", embedding: emb }, []);
    expect(await pruneExpiredEmbeddings(db, new Date("2026-10-04T12:00:00.000Z"))).toBe(1);
    const old = (await db.get("messages", "old"))!;
    expect("embedding" in old).toBe(false);
    expect(old).toMatchObject({ fingerprint: "abc", findings: [{ id: "P3", confidence: 0.9 }] });
    expect((await db.get("messages", "new"))!.embedding).toEqual(emb);
    // Idempotent ; le doublon exact par empreinte reste détectable (fenêtre gérée par le cœur).
    expect(await pruneExpiredEmbeddings(db, new Date("2026-10-04T12:00:00.000Z"))).toBe(0);
    expect((await knownMessages(db)).find((k) => k.receivedAt?.startsWith("2026-09-20"))).toEqual({ fingerprint: "abc", receivedAt: "2026-09-20T10:00:00.000Z" });
  });

  it("stores only the SPEC 6 shapes: no full text in messages", async () => {
    const db = await openEchoDB("test-1");
    await saveAnalysis(db, toStoredMessage(analysis), toReviewChunks(analysis));
    const msgs = await db.getAll("messages");
    expect(JSON.stringify(msgs)).not.toContain("tasting");
    const review = await db.getAll("reviewChunks");
    expect(review.map((r) => r.text)).toEqual(["We picked cherries."]);
    expect(await knownMessages(db)).toEqual([{ fingerprint: "abc", receivedAt: analysis.receivedAt }]);
  });

  it("settings defaults, patch, delete key; wipe clears messages and queue", async () => {
    const db = await openEchoDB("test-2");
    expect((await getSettings(db)).coopConsent).toBe(false);
    await saveSettings(db, { hostPhone: "+250", coopConsent: true });
    expect(await getSettings(db)).toMatchObject({ hostPhone: "+250", coopConsent: true, mode: "B" });
    await saveSettings(db, { pin: { salt: "s", hash: "h", iterations: 1 } });
    await saveSettings(db, { pin: undefined });
    expect((await getSettings(db)).pin).toBeUndefined();
    await enqueue(db, { kind: "text", text: "x", receivedAt: "2026-10-04", via: "paste" });
    await wipeAll(db);
    expect(await db.count("queue")).toBe(0);
    expect((await getSettings(db)).hostPhone).toBe("+250");
  });

  it("a finished month is closed once: unknown-topic groups written on the chunks, every chunk embedding removed", async () => {
    const db = await openEchoDB("test-close");
    const chunk = (id: string, month: string, v: number[]): ReviewChunk => ({
      id, messageId: id.split(":")[0]!, month, status: "off_list", text: `picking ${id}`, mentionsGuide: false, reason: "below_floor", embedding: Float32Array.from(v),
    });
    const sep = [chunk("a:0", "2026-09", [1, 0]), chunk("b:0", "2026-09", [0.99, 0.14]), chunk("c:0", "2026-09", [0.98, 0.2]), chunk("d:0", "2026-09", [0, 1])];
    const oct = [chunk("e:0", "2026-10", [1, 0])];
    const aug = [chunk("f:0", "2026-08", [1, 0])];
    for (const c of [...sep, ...oct, ...aug]) await saveAnalysis(db, { ...toStoredMessage(analysis), id: c.messageId, month: c.month }, [c]);
    const before = monthClustersFromReview("2026-09", await db.getAll("reviewChunks"), DEFAULT_CONFIG);
    expect(before.find((c) => c.recurring)?.distinctVisitors).toBe(3);
    // August still has a message in the queue: it waits for the next run.
    await enqueue(db, { kind: "text", text: "x", receivedAt: "2026-08-31T23:00:00.000Z", via: "paste" });
    expect(await closeFinishedMonths(db, new Date("2026-10-04T12:00:00.000Z"), await queuedMonths(db))).toEqual(["2026-09"]);
    const rows = await db.getAll("reviewChunks");
    const septRows = rows.filter((r) => r.month === "2026-09");
    expect(septRows.every((r) => !("embedding" in r) && r.clusterId)).toBe(true);
    expect(rows.find((r) => r.id === "e:0")!.embedding).toBeDefined(); // current month: kept for clustering
    expect(rows.find((r) => r.id === "f:0")!.embedding).toBeDefined(); // pending in the queue
    // The closed month's recap reads the stored groups: same result as before, without any embedding.
    expect(monthClustersFromReview("2026-09", rows, DEFAULT_CONFIG)).toEqual(before);
    expect(await closeFinishedMonths(db, new Date("2026-10-04T12:00:00.000Z"), await queuedMonths(db))).toEqual([]);
    expect(await closeFinishedMonths(db, new Date("2026-10-04T12:00:00.000Z"))).toEqual(["2026-08"]);
  });
});
