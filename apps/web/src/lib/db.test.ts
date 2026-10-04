import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { toReviewChunks, toStoredMessage, type MessageAnalysis } from "@echo/core";
import { enqueue, getSettings, knownMessages, openEchoDB, pruneExpiredEmbeddings, saveAnalysis, saveSettings, wipeAll } from "./db.ts";

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
});
