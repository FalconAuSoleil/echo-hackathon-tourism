import { describe, expect, it } from "vitest";
import { analyzeMessage, chunkSegments, isPhantomTranscript, mentionsGuide, type AnalyzeDeps } from "./analyze.ts";
import { analyzeAudioMessage } from "./audio.ts";
import { makeConfig } from "./config.ts";
import { createMatcher } from "./matcher.ts";
import { expireMessageEmbedding, scrubForQueue, toReviewChunks, toStoredMessage } from "./storage.ts";
import { SIMILARITY_TEST_CONFIG, fakeEmbedder, fakeTranscriber, testCatalog } from "./test-fixtures.ts";
import type { MessageInput, Transcript } from "./types.ts";

async function deps(extra: Partial<AnalyzeDeps> = {}): Promise<AnalyzeDeps> {
  const catalog = testCatalog();
  const config = makeConfig(SIMILARITY_TEST_CONFIG);
  return { catalog, config, matcher: await createMatcher(catalog, fakeEmbedder(), config), ...extra };
}

const text = (t: string, lang?: string, id = "m1"): MessageInput => ({
  id,
  receivedAt: "2026-10-03T10:00:00Z",
  source: "text",
  text: t,
  ...(lang ? { declaredLang: lang } : {}),
});

const audio = (tr: Partial<Transcript> & { text: string }, stats = { durationSec: 12, rms: 0.05 }): MessageInput => ({
  id: "a1",
  receivedAt: "2026-10-03T10:00:00Z",
  source: "audio",
  transcript: { language: "en", languageProbability: 0.97, confidence: 0.9, durationSec: stats.durationSec, ...tr },
  audioStats: stats,
});

describe("analyzeMessage", () => {
  it("message multi-constats en allemand : torréfaction appréciée et chemin trop long", async () => {
    const a = await analyzeMessage(text("Die Röstung war toll, aber der Weg war zu lang.", "de"), await deps());
    expect(a.status).toBe("analyzed");
    expect(a.month).toBe("2026-10");
    expect(a.chunks.map((c) => c.status)).toEqual(["matched", "matched"]);
    expect(a.findings.map((f) => f.id).sort()).toEqual(["N1", "P3"]);
    expect(a.chunks[0]!.id).toBe("m1:0");
  });
  it("négation : n'est jamais comptée comme N1, et passe en « pas sûr »", async () => {
    const a = await analyzeMessage(text("The path was not too long.", "en"), await deps());
    expect(a.findings).toEqual([]);
    expect(a.notSureCount).toBe(1);
    expect(a.chunks[0]).toMatchObject({ status: "not_sure", reason: "negation" });
  });
  it("hors liste : compté à part, avec son embedding pour le regroupement", async () => {
    const a = await analyzeMessage(text("Picking cherries was the highlight", "en"), await deps());
    expect(a.offListCount).toBe(1);
    expect(a.chunks[0]!.embedding).toBeInstanceOf(Float32Array);
  });
  it("retire les noms AVANT l'analyse et ne renvoie que du texte nettoyé", async () => {
    const a = await analyzeMessage(text("My name is Anna Smith. The meal was delicious, call +250 788 123 456", "en"), await deps());
    const all = JSON.stringify(a);
    expect(all).not.toContain("Anna");
    expect(all).not.toContain("788");
    expect(a.scrubbedText).toContain("[nom]");
  });
  it("détecte la langue d'un message écrit sans langue déclarée", async () => {
    const a = await analyzeMessage(text("Le chemin était trop long mais le repas était délicieux"), await deps());
    expect(a.lang).toBe("fr");
    expect(a.findings.map((f) => f.id).sort()).toEqual(["N1", "P4"]);
  });
  it("langue non prise en charge ou mal reconnue → tout le message « pas sûr », rien de compté", async () => {
    const sw = await analyzeMessage(audio({ text: "Njia ilikuwa ndefu sana", language: "sw" }), await deps());
    expect(sw.status).toBe("not_sure");
    expect(sw.reason).toBe("unsupported_language");
    expect(sw.findings).toEqual([]);
    expect(sw.chunks.every((c) => c.status === "not_sure")).toBe(true);
    const lowProb = await analyzeMessage(audio({ text: "The path was too long", languageProbability: 0.3 }), await deps());
    expect(lowProb).toMatchObject({ status: "not_sure", reason: "low_language_probability", findings: [] });
  });
  it("confiance de transcription faible → « pas sûr » ; très faible → « inaudible » (trop bruité)", async () => {
    const low = await analyzeMessage(audio({ text: "The path was too long", confidence: 0.3 }), await deps());
    expect(low).toMatchObject({ status: "not_sure", reason: "message_low_confidence", findings: [] });
    expect(low.notSureCount).toBe(1);
    const noisy = await analyzeMessage(audio({ text: "The path was too long", confidence: 0.1 }), await deps());
    expect(noisy).toMatchObject({ status: "inaudible", reason: "too_noisy", chunks: [] });
  });
  it("audio court, silencieux ou transcription fantôme → « inaudible », jamais analysé", async () => {
    const d = await deps();
    expect((await analyzeMessage(audio({ text: "The meal was delicious" }, { durationSec: 2, rms: 0.05 }), d)).status).toBe("inaudible");
    expect((await analyzeMessage(audio({ text: "The meal was delicious" }, { durationSec: 10, rms: 0.001 }), d)).reason).toBe("silence");
    expect((await analyzeMessage(audio({ text: " [Music] " }), d)).reason).toBe("empty_transcript");
    expect((await analyzeMessage(audio({ text: "Sous-titres réalisés par la communauté d'Amara.org" }), d)).status).toBe("inaudible");
    expect((await analyzeMessage(text("   "), d)).status).toBe("inaudible");
  });
  it("doublon exact (même texte, ponctuation près) → « duplicate », non compté", async () => {
    const d = await deps();
    const first = await analyzeMessage(text("The meal was delicious!", "en"), d);
    const again = await analyzeMessage(text("the meal was delicious", "en", "m2"), { ...d, knownFingerprints: new Set([first.fingerprint]) });
    expect(again).toMatchObject({ status: "duplicate", findings: [], chunks: [] });
  });
  it("quasi-doublon (embedding presque identique) → « duplicate »", async () => {
    const d = await deps();
    const first = await analyzeMessage(text("The meal was delicious", "en"), d);
    const again = await analyzeMessage(text("The meal was so delicious", "en", "m2"), {
      ...d,
      knownMessages: [{ fingerprint: first.fingerprint, embedding: first.messageEmbedding!, receivedAt: first.receivedAt }],
    });
    expect(again).toMatchObject({ status: "duplicate", reason: "duplicate_embedding" });
  });
  it("même texte des semaines plus tard : pas un doublon (fenêtre de dates)", async () => {
    const d = await deps();
    const first = await analyzeMessage(text("The meal was delicious", "en"), d);
    const later = await analyzeMessage({ ...text("The meal was delicious", "en", "m2"), receivedAt: "2026-11-20T10:00:00Z" }, {
      ...d,
      knownMessages: [{ fingerprint: first.fingerprint, receivedAt: first.receivedAt }],
    });
    expect(later.status).toBe("analyzed");
  });
  it("morceaux sur le guide : visibles par l'hôte, jamais dans coopFindings", async () => {
    const a = await analyzeMessage(text("The path was too long for our guide. The meal was delicious.", "en"), await deps());
    const guideChunk = a.chunks.find((c) => c.mentionsGuide)!;
    expect(guideChunk.findings.map((f) => f.id)).toEqual(["N1"]);
    expect(a.findings.map((f) => f.id).sort()).toEqual(["N1", "P4"]);
    expect(a.coopFindings).toEqual(["P4"]);
  });
  it("chaque constat est compté une fois par message", async () => {
    const a = await analyzeMessage(text("The meal was delicious. Really, the food was delicious.", "en"), await deps());
    expect(a.findings.map((f) => f.id)).toEqual(["P4"]);
  });
});

describe("mentionsGuide / isPhantomTranscript", () => {
  it("repère le guide dans les 4 langues", () => {
    expect(mentionsGuide("notre guide était super", "fr")).toBe(true);
    expect(mentionsGuide("Der Führer sprach gut Englisch", "de")).toBe(true);
    expect(mentionsGuide("la guía fue amable", "es")).toBe(true);
    expect(mentionsGuide("the translator was late", "en")).toBe(true);
    expect(mentionsGuide("the guidelines were clear", "en")).toBe(false);
  });
  it("transcriptions fantômes", () => {
    expect(isPhantomTranscript("♪ ♪")).toBe(true);
    expect(isPhantomTranscript("(applause)")).toBe(true);
    expect(isPhantomTranscript("Thank you for the visit")).toBe(false);
  });
});

describe("analyzeAudioMessage (faux transcripteur)", () => {
  const tone = (sec: number, amp = 0.2) => {
    const a = new Float32Array(16000 * sec);
    // parole simulée : bouffées d'énergie séparées de silences (dynamique élevée)
    for (let i = 0; i < a.length; i++) a[i] = (Math.floor(i / 4000) % 2 === 0 ? amp : 0.002) * Math.sin(i / 5);
    return a;
  };
  it("transcrit, efface le tampon audio, puis analyse", async () => {
    const tr = fakeTranscriber({ text: "The meal was delicious", durationSec: 5 });
    const buf = tone(5);
    const a = await analyzeAudioMessage({ id: "a1", receivedAt: "2026-10-03T10:00:00Z", audio16k: buf }, { ...(await deps()), transcriber: tr });
    expect(tr.received).toHaveLength(1);
    expect(buf.every((x) => x === 0)).toBe(true);
    expect(a.findings.map((f) => f.id)).toEqual(["P4"]);
  });
  it("audio de moins de 3 s : pas de transcription, « inaudible », tampon effacé quand même", async () => {
    const tr = fakeTranscriber({ text: "The meal was delicious" });
    const buf = tone(2);
    const a = await analyzeAudioMessage({ id: "a1", receivedAt: "2026-10-03T10:00:00Z", audio16k: buf }, { ...(await deps()), transcriber: tr });
    expect(tr.received).toHaveLength(0);
    expect(a).toMatchObject({ status: "inaudible", reason: "too_short" });
    expect(buf.every((x) => x === 0)).toBe(true);
  });
  it("bruit continu sans parole distincte → « inaudible » (trop bruité)", async () => {
    const tr = fakeTranscriber({ text: "whatever" });
    const buf = new Float32Array(16000 * 5);
    let seed = 1;
    for (let i = 0; i < buf.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      buf[i] = ((seed / 0x7fffffff) * 2 - 1) * 0.1;
    }
    const a = await analyzeAudioMessage({ id: "a1", receivedAt: "2026-10-03T10:00:00Z", audio16k: buf }, { ...(await deps()), transcriber: tr });
    expect(a).toMatchObject({ status: "inaudible", reason: "too_noisy" });
    expect(tr.received).toHaveLength(0);
  });
});

describe("storage : seulement ce que SPEC 6 autorise", () => {
  it("la fiche message ne contient aucun texte ; seuls les morceaux pas sûr / hors liste gardent leur texte nettoyé", async () => {
    const a = await analyzeMessage(
      { ...audio({ text: "My name is Anna. The meal was delicious. The path was not too long. Picking cherries was fun.", englishTranslation: "My name is Anna." }) },
      await deps(),
    );
    const stored = toStoredMessage(a);
    expect(Object.keys(stored).sort()).toEqual(
      ["coopFindings", "embedding", "findings", "fingerprint", "id", "lang", "month", "notSureCount", "offListCount", "receivedAt", "source", "status"].sort(),
    );
    expect(JSON.stringify(stored)).not.toMatch(/meal|Anna|delicious/);
    const review = toReviewChunks(a);
    // « My name is [nom]. » et « Picking cherries... » : hors liste ; la négation : pas sûr.
    expect(review.map((r) => r.status).sort()).toEqual(["not_sure", "off_list", "off_list"]);
    expect(JSON.stringify(review)).not.toContain("Anna");
    // Le message contient un morceau compté (« The meal was delicious. ») : sa traduction anglaise entière n'est pas stockée.
    expect(review.every((r) => r.englishMT === undefined)).toBe(true);
  });

  it("traduction anglaise stockée seulement si tout le message est à relire, et nettoyée", async () => {
    const mixed = await analyzeMessage(
      { ...audio({ text: "Die Mahlzeit war lecker. Der Weg war nicht zu lang.", language: "de", englishTranslation: "The meal was delicious. The path was not too long." }) },
      await deps(),
    );
    expect(mixed.chunks.some((c) => c.status === "matched")).toBe(true);
    expect(mixed.englishTranslation).toContain("The meal was delicious");
    const mixedReview = toReviewChunks(mixed);
    expect(mixedReview.length).toBeGreaterThan(0);
    expect(JSON.stringify(mixedReview)).not.toContain("meal");

    const allReview = await analyzeMessage(
      { ...audio({ text: "Der Weg war nicht zu lang.", language: "de", englishTranslation: "The path was not too long, call Anna on +44 7700 900123." }) },
      await deps(),
    );
    expect(allReview.chunks.every((c) => c.status === "not_sure" || c.status === "off_list")).toBe(true);
    const r = toReviewChunks(allReview);
    expect(r[0]!.englishMT).toMatch(/^The path was not too long/);
    expect(r[0]!.englishMT).not.toMatch(/Anna|7700/);
  });

  it("message mixte : la traduction du SEGMENT d'un morceau à relire est stockée, jamais celle d'un morceau compté", async () => {
    const segs = [
      { start: 0, end: 2.4, text: "Die Mahlzeit war lecker.", english: "The meal was delicious." },
      { start: 2.4, end: 5, text: "Der Weg war nicht zu lang, sagt Thomas.", english: "The path was not too long, says Thomas." },
    ];
    const a = await analyzeMessage(
      audio({ text: segs.map((sg) => sg.text).join(" "), language: "de", segments: segs, englishTranslation: segs.map((sg) => sg.english).join(" ") }),
      await deps(),
    );
    expect(a.chunks.map((c) => c.status)).toEqual(["matched", "not_sure"]);
    const review = toReviewChunks(a);
    expect(review).toHaveLength(1);
    expect(review[0]!.text).toBe("Der Weg war nicht zu lang, sagt [nom].");
    expect(review[0]!.englishMT).toBe("The path was not too long, says [nom].");
    expect(JSON.stringify(review)).not.toMatch(/meal|Mahlzeit|Thomas/);
  });

  it("segment qui contient aussi un morceau compté : pas de traduction pour le morceau à relire", async () => {
    const segs = [{ start: 0, end: 5, text: "Die Mahlzeit war lecker. Der Weg war nicht zu lang.", english: "The meal was delicious. The path was not too long." }];
    const a = await analyzeMessage(audio({ text: segs[0]!.text, language: "de", segments: segs }), await deps());
    expect(a.chunks.map((c) => c.status)).toEqual(["matched", "not_sure"]);
    expect(toReviewChunks(a)[0]!.englishMT).toBeUndefined();
  });

  it("segment sans traduction isolable (undefined) : pas de traduction pour son morceau", async () => {
    const segs = [
      { start: 0, end: 2.4, text: "Die Mahlzeit war lecker.", english: "The meal was delicious." },
      { start: 2.4, end: 5, text: "Der Weg war nicht zu lang." },
    ];
    const a = await analyzeMessage(audio({ text: segs.map((sg) => sg.text).join(" "), language: "de", segments: segs }), await deps());
    expect(a.chunks.map((c) => c.status)).toEqual(["matched", "not_sure"]);
    expect(toReviewChunks(a)[0]!.englishMT).toBeUndefined();
  });

  it("chunkSegments : alignement des morceaux nettoyés sur les segments bruts", () => {
    const segs = [
      { start: 0, end: 2, text: "My name is Anna Smith." },
      { start: 2, end: 4, text: "The meal was great, but" },
      { start: 4, end: 6, text: "the walk was long." },
    ];
    expect(chunkSegments(segs, "My name is [nom]. The meal was great, but the walk was long.", ["My name is [nom].", "The meal was great,", "but the walk was long."])).toEqual([[0], [1], [1, 2]]);
  });

  it("message écrit : aucune traduction anglaise", async () => {
    const a = await analyzeMessage(text("Der Weg war nicht zu lang.", "de"), await deps());
    expect(toReviewChunks(a).every((r) => r.englishMT === undefined)).toBe(true);
  });

  it("l'embedding et l'empreinte du message sont retirés de la fiche après la fenêtre des doublons", async () => {
    const stored = toStoredMessage(await analyzeMessage(text("The meal was delicious.", "en"), await deps()));
    expect(stored.embedding).toBeInstanceOf(Float32Array);
    expect(expireMessageEmbedding(stored, new Date("2026-10-09T10:00:00Z"), 7)).toBeNull();
    const expired = expireMessageEmbedding(stored, new Date("2026-10-10T10:00:01Z"), 7);
    expect(expired).not.toBeNull();
    expect("embedding" in expired!).toBe(false);
    expect("fingerprint" in expired!).toBe(false);
    expect(expired).toMatchObject({ id: stored.id, findings: stored.findings, lang: "en" });
    expect(expireMessageEmbedding(expired!, new Date("2027-01-01T00:00:00Z"), 7)).toBeNull();
  });

  it("message écrit nettoyé avant la file (scrubForQueue), et l'analyse donne le même résultat ensuite", async () => {
    const raw = "My name is Anna, +250 788 000 111. The meal was delicious.";
    const queued = scrubForQueue(raw);
    expect(queued).toBe("My name is [nom], [numéro]. The meal was delicious.");
    const d = await deps();
    const fromRaw = await analyzeMessage(text(raw, "en"), d);
    const fromQueued = await analyzeMessage(text(queued, "en"), d);
    expect(fromQueued.scrubbedText).toBe(fromRaw.scrubbedText);
    expect(fromQueued.findings).toEqual(fromRaw.findings);
  });
});
