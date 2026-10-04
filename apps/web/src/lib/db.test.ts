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
  it("message embeddings and fingerprints are removed once older than the duplicate window (7 days)", async () => {
    const db = await openEchoDB("test-prune");
    const emb = new Float32Array([0.6, 0.8]);
    await saveAnalysis(db, { ...toStoredMessage(analysis), id: "old", receivedAt: "2026-09-20T10:00:00.000Z", embedding: emb }, []);
    await saveAnalysis(db, { ...toStoredMessage(analysis), id: "new", receivedAt: "2026-10-03T10:00:00.000Z", embedding: emb }, []);
    expect(await pruneExpiredEmbeddings(db, new Date(2026, 9, 4, 12))).toBe(1);
    const old = (await db.get("messages", "old"))!;
    expect("embedding" in old).toBe(false);
    expect("fingerprint" in old).toBe(false);
    expect(old).toMatchObject({ findings: [{ id: "P3", confidence: 0.9 }] });
    expect((await db.get("messages", "new"))!).toMatchObject({ embedding: emb, fingerprint: "abc" });
    // Idempotent ; la fiche expirée ne compte plus pour les doublons (hors fenêtre de toute façon).
    expect(await pruneExpiredEmbeddings(db, new Date(2026, 9, 4, 12))).toBe(0);
    expect((await knownMessages(db)).map((k) => k.receivedAt)).toEqual(["2026-10-03T10:00:00.000Z"]);
  });

  it("a record from before this change (fingerprint, no embedding) loses its fingerprint after the window", async () => {
    const db = await openEchoDB("test-prune-fp");
    const { embedding: _e, ...noEmb } = toStoredMessage(analysis);
    await saveAnalysis(db, { ...noEmb, id: "legacy", receivedAt: "2026-09-01T10:00:00.000Z" }, []);
    expect(await pruneExpiredEmbeddings(db, new Date(2026, 9, 4, 12))).toBe(1);
    expect("fingerprint" in (await db.get("messages", "legacy"))!).toBe(false);
    expect(await knownMessages(db)).toEqual([]);
  });

  it("written messages are scrubbed before they enter the queue (names, phone numbers, e-mails)", async () => {
    const db = await openEchoDB("test-queue-scrub");
    const id = await enqueue(db, { kind: "text", text: "My name is Anna, +250 788 000 111. The coffee was great!", receivedAt: "2026-10-04T10:00:00.000Z", via: "paste" });
    const row = (await db.get("queue", id))!;
    expect(row.text).toBe("My name is [nom], [numéro]. The coffee was great!");
    const fr = await enqueue(db, { kind: "text", text: "Merci pour tout, écrivez-moi à marc.dupont@mail.fr. Signé Marc", receivedAt: "2026-10-04T10:00:00.000Z", via: "share" });
    const raw = JSON.stringify(await db.getAll("queue"));
    for (const leak of ["Anna", "788", "marc.dupont", "Marc"]) expect(raw).not.toContain(leak);
    expect((await db.get("queue", fr))!.text).toContain("[e-mail]");
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
    await enqueue(db, { kind: "text", text: "x", receivedAt: new Date(2026, 7, 31, 23).toISOString(), via: "paste" }); // 31 Aug, 23:00 local
    expect(await closeFinishedMonths(db, new Date(2026, 9, 4, 12), await queuedMonths(db))).toEqual(["2026-09"]);
    const rows = await db.getAll("reviewChunks");
    const septRows = rows.filter((r) => r.month === "2026-09");
    expect(septRows.every((r) => !("embedding" in r) && r.clusterId)).toBe(true);
    expect(rows.find((r) => r.id === "e:0")!.embedding).toBeDefined(); // current month: kept for clustering
    expect(rows.find((r) => r.id === "f:0")!.embedding).toBeDefined(); // pending in the queue
    // The closed month's recap reads the stored groups: same result as before, without any embedding.
    expect(monthClustersFromReview("2026-09", rows, DEFAULT_CONFIG)).toEqual(before);
    expect(await closeFinishedMonths(db, new Date(2026, 9, 4, 12), await queuedMonths(db))).toEqual([]);
    expect(await closeFinishedMonths(db, new Date(2026, 9, 4, 12))).toEqual(["2026-08"]);
  });

  it("months use the device's local clock (UTC-5 on the evening of 31 October): October is not closed, the queue month is October", async () => {
    const tz = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      const db = await openEchoDB("test-close-tz");
      const evening = new Date("2026-11-01T02:30:00.000Z"); // 31 Oct, 21:30 local, already November in UTC
      const c: ReviewChunk = { id: "g:0", messageId: "g", month: "2026-10", status: "off_list", text: "picking", mentionsGuide: false, reason: "below_floor", embedding: Float32Array.from([1, 0]) };
      await saveAnalysis(db, { ...toStoredMessage(analysis), id: "g", month: "2026-10" }, [c]);
      await enqueue(db, { kind: "text", text: "x", receivedAt: evening.toISOString(), via: "paste" });
      expect([...(await queuedMonths(db))]).toEqual(["2026-10"]);
      expect(await closeFinishedMonths(db, evening)).toEqual([]);
      expect((await db.get("reviewChunks", "g:0"))!.embedding).toBeDefined();
    } finally {
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    }
  });
});
