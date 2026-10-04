import { describe, expect, it } from "vitest";
import { analyzeMessage } from "./analyze.ts";
import { analyzeAudioMessage, transcribeAudioMessage } from "./audio.ts";
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
