import { describe, expect, it } from "vitest";
import { memoryModeFor } from "./worker-client.ts";

describe("memory mode (one model at a time on 2 GB phones)", () => {
  it("automatic: one model at a time when the browser reports 2 GB or less, both otherwise or when unknown", () => {
    expect(memoryModeFor("auto", 1)).toBe("one_model_at_a_time");
    expect(memoryModeFor("auto", 2)).toBe("one_model_at_a_time");
    expect(memoryModeFor("auto", 4)).toBe("both_models");
    expect(memoryModeFor("auto", undefined)).toBe("both_models");
  });
  it("the device preference wins", () => {
    expect(memoryModeFor("low", 8)).toBe("one_model_at_a_time");
    expect(memoryModeFor("normal", 1)).toBe("both_models");
  });
});
