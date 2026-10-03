import { describe, expect, it } from "vitest";
import { repetitionLoopCut } from "./whisper.ts";

describe("repetitionLoopCut", () => {
  it("garde une seule occurrence d'un bloc répété 3 fois", () => {
    expect(repetitionLoopCut([1, 2, 7, 8, 9, 7, 8, 9, 7, 8, 9])).toBe(5);
  });
  it("un même token 6 fois", () => {
    expect(repetitionLoopCut([4, 5, 5, 5, 5, 5, 5])).toBe(2);
    expect(repetitionLoopCut([4, 5, 5, 5])).toBe(-1);
  });
  it("pas de boucle dans un texte normal", () => {
    expect(repetitionLoopCut([1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 3])).toBe(-1);
    expect(repetitionLoopCut([1, 2, 1, 2])).toBe(-1);
  });
});
