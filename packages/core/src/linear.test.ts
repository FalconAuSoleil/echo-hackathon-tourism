import { describe, expect, it } from "vitest";
import { predictProba, trainLinearClassifier } from "./linear.ts";

const v = (...xs: number[]) => Float32Array.from(xs);

describe("trainLinearClassifier", () => {
  it("sépare des classes linéairement séparables et donne des probabilités", () => {
    const X = [v(1, 0, 0), v(0.9, 0.1, 0), v(0, 1, 0), v(0.1, 0.9, 0), v(0, 0, 1), v(0, 0.1, 0.9)];
    const y = [0, 0, 1, 1, 2, 2];
    const clf = trainLinearClassifier(X, y, ["A", "B", "C"], { epochs: 200, learningRate: 0.1 });
    const p = predictProba(clf, v(0.95, 0.05, 0));
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
    expect(p[0]).toBeGreaterThan(0.8);
    expect(predictProba(clf, v(0, 0, 1))[2]).toBeGreaterThan(0.8);
  });
  it("est déterministe", () => {
    const X = [v(1, 0), v(0, 1)];
    const a = trainLinearClassifier(X, [0, 1], ["A", "B"]);
    const b = trainLinearClassifier(X, [0, 1], ["A", "B"]);
    expect([...a.weights]).toEqual([...b.weights]);
  });
});
