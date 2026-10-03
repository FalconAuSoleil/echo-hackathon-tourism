import { describe, expect, it } from "vitest";
import { editDistance, errorCounts, normalizeForWer, rates, sumCounts } from "./wer.ts";

describe("wer", () => {
  it("normalise comme Whisper (ponctuation, casse, balises) en gardant les accents", () => {
    expect(normalizeForWer("Hello, World! [Music] C'était (rires) TRÈS bien.")).toBe("hello world c était très bien");
  });
  it("distance d'édition", () => {
    expect(editDistance(["a", "b", "c"], ["a", "x", "c", "d"])).toBe(2);
    expect(editDistance([], ["a"])).toBe(1);
  });
  it("WER et CER de corpus", () => {
    const c = sumCounts([errorCounts("the path was long", "the path is long"), errorCounts("ok", "ok")]);
    expect(c.refWords).toBe(5);
    expect(rates(c).wer).toBeCloseTo(1 / 5);
    expect(errorCounts("abc", "abd").charErrors).toBe(1);
  });
});
