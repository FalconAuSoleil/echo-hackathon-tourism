import { describe, expect, it } from "vitest";
import { mergeShortSegments, repetitionLoopCut, splitTimestampSegments } from "./whisper.ts";

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

describe("splitTimestampSegments", () => {
  const T = 1000; // premier token d'horodatage ; <|t|> = T + t / 0,02
  const ts = (sec: number) => T + Math.round(sec / 0.02);
  it("découpe <|0.00|> texte <|2.40|><|2.40|> texte <|5.00|>", () => {
    expect(splitTimestampSegments([ts(0), 1, 2, ts(2.4), ts(2.4), 3, ts(5)], T, 30)).toEqual([
      { start: 0, end: 2.4, tokens: [1, 2] },
      { start: 2.4, end: 5, tokens: [3] },
    ]);
  });
  it("segment non fermé : jusqu'à la fin de la fenêtre ; segments vides ignorés", () => {
    expect(splitTimestampSegments([ts(0), ts(1), ts(1), 7, 8], T, 6.5)).toEqual([{ start: 1, end: 6.5, tokens: [7, 8] }]);
  });
});

describe("mergeShortSegments", () => {
  it("rattache un segment de moins d'1 s ou de moins de 3 mots au précédent", () => {
    expect(mergeShortSegments([
      { start: 0, end: 3.8, text: "Das Rösten hat Spaß gemacht." },
      { start: 3.8, end: 12.26, text: "Wir hätten gern geholfen und vom Strauch" },
      { start: 12.26, end: 12.76, text: "gepflegt." },
    ])).toEqual([
      { start: 0, end: 3.8, text: "Das Rösten hat Spaß gemacht." },
      { start: 3.8, end: 12.76, text: "Wir hätten gern geholfen und vom Strauch gepflegt." },
    ]);
  });
});

