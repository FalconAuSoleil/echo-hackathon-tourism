import { describe, expect, it } from "vitest";
import { hashPin, isValidPin, verifyPin } from "./pin.ts";

describe("PIN", () => {
  it("accepts 4 to 8 digits only", () => {
    expect(isValidPin("1234")).toBe(true);
    expect(isValidPin("12345678")).toBe(true);
    expect(isValidPin("123")).toBe(false);
    expect(isValidPin("12a4")).toBe(false);
  });
  it("stores a salted hash, never the PIN, and verifies it", async () => {
    const h = await hashPin("4821", 1000);
    expect(JSON.stringify(h)).not.toContain("4821");
    expect(await verifyPin("4821", h)).toBe(true);
    expect(await verifyPin("4822", h)).toBe(false);
    const h2 = await hashPin("4821", 1000);
    expect(h2.hash).not.toBe(h.hash); // sel différent
  });
});
