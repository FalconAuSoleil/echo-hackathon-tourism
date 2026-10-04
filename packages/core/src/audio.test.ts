import { describe, expect, it } from "vitest";
import { analyzeMessage, segmentsNeedingEnglish } from "./analyze.ts";
import { analyzeAudioMessage, transcribeAudioMessage, translateReviewSegments } from "./audio.ts";
import { makeConfig } from "./config.ts";
import { createMatcher } from "./matcher.ts";
import { SIMILARITY_TEST_CONFIG, fakeEmbedder, fakeTranscriber, testCatalog } from "./test-fixtures.ts";

const speech = (sec: number) => {
  const a = new Float32Array(16000 * sec);
  for (let i = 0; i < a.length; i++) a[i] = (Math.floor(i / 4000) % 2 === 0 ? 0.2 : 0.002) * Math.sin(i / 5);
  return a;
};

describe("transcribeAudioMessage (two steps: Whisper for the whole queue, then the similarity model)", () => {
  it("transcribes and wipes the audio without any matcher, and analyzeMessage on its output equals analyzeAudioMessage", async () => {
    const config = makeConfig(SIMILARITY_TEST_CONFIG);
    const tr = fakeTranscriber({ text: "The meal was delicious", durationSec: 5 });
    const buf = speech(5);
    const input = await transcribeAudioMessage({ id: "a1", receivedAt: "2026-10-03T10:00:00Z", audio16k: buf }, { transcriber: tr, config });
    expect(buf.every((x) => x === 0)).toBe(true);
    expect(input).toMatchObject({ id: "a1", source: "audio", transcript: { text: "The meal was delicious" } });
    expect(input.audioStats?.durationSec).toBe(5);

    const catalog = testCatalog();
    const deps = { catalog, matcher: await createMatcher(catalog, fakeEmbedder(), config), config };
    const twoSteps = await analyzeMessage(input, deps);
    const oneStep = await analyzeAudioMessage({ id: "a1", receivedAt: "2026-10-03T10:00:00Z", audio16k: speech(5) }, { ...deps, transcriber: tr });
    expect(twoSteps).toEqual(oneStep);
    expect(twoSteps.findings.map((f) => f.id)).toEqual(["P4"]);
  });

  it("inaudible audio is not transcribed and has no transcript", async () => {
    const tr = fakeTranscriber({ text: "x" });
    const input = await transcribeAudioMessage({ id: "a2", receivedAt: "2026-10-03T10:00:00Z", audio16k: speech(2) }, { transcriber: tr, config: makeConfig({}) });
    expect(tr.received).toHaveLength(0);
    expect(input.transcript).toBeUndefined();
  });
});

describe("English for review chunks: only the segments to be read are translated, after the analysis", () => {
  const segments = [
    { start: 0, end: 2.5, text: "Die Mahlzeit war lecker." },
    { start: 2.5, end: 5, text: "Der Weg war nicht zu lang, sagt Thomas." },
  ];
  const translator = () => {
    const calls: { start: number; end: number }[][] = [];
    const seen: Float32Array[] = [];
    const tr = {
      calls,
      seen,
      async transcribe(audio: Float32Array, opts?: { withSegments?: boolean; withEnglishTranslation?: boolean }) {
        expect(opts).toEqual({ withSegments: true, withEnglishTranslation: false });
        return { text: segments.map((s) => s.text).join(" "), language: "de", languageProbability: 0.98, confidence: 0.9, durationSec: audio.length / 16000, segments };
      },
      async translateSegments(audio: Float32Array, segs: readonly { start: number; end: number }[]) {
        seen.push(Float32Array.from(audio));
        calls.push([...segs]);
        return segs.map(() => "The path was not too long, says Thomas.");
      },
    };
    return tr;
  };

  it("translates the not-sure segment only, scrubs it, and wipes the audio at the end", async () => {
    const config = makeConfig(SIMILARITY_TEST_CONFIG);
    const catalog = testCatalog();
    const deps = { catalog, matcher: await createMatcher(catalog, fakeEmbedder(), config), config };
    const tr = translator();
    const buf = speech(5);
    const a = await analyzeAudioMessage({ id: "a3", receivedAt: "2026-10-03T10:00:00Z", audio16k: buf }, { ...deps, transcriber: tr });
    expect(a.chunks.map((c) => c.status)).toEqual(["matched", "not_sure"]);
    expect(tr.calls).toEqual([[segments[1]]]);
    expect(tr.seen[0]!.some((x) => x !== 0)).toBe(true); // the audio was still there for the translation
    expect(buf.every((x) => x === 0)).toBe(true);
    expect(a.chunks[1]!.englishMT).toBe("The path was not too long, says [nom].");
    expect(a.chunks[0]!.englishMT).toBeUndefined();
    expect(segmentsNeedingEnglish(a, segments)).toEqual([1]);
  });

  it("nothing to translate when every chunk is counted, or for English", async () => {
    const config = makeConfig(SIMILARITY_TEST_CONFIG);
    const catalog = testCatalog();
    const deps = { catalog, matcher: await createMatcher(catalog, fakeEmbedder(), config), config };
    const tr = translator();
    const counted = await analyzeMessage(
      { id: "a4", receivedAt: "2026-10-03T10:00:00Z", source: "audio", transcript: { text: "Die Mahlzeit war lecker.", language: "de", confidence: 0.9, durationSec: 5, segments: [segments[0]!] }, audioStats: { durationSec: 5, rms: 0.05 } },
      deps,
    );
    expect(await translateReviewSegments(counted, [segments[0]!], speech(5), tr)).toBe(counted);
    expect(tr.calls).toHaveLength(0);
    expect(segmentsNeedingEnglish({ ...counted, lang: "en" }, segments)).toEqual([]);
  });
});
