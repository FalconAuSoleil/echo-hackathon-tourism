import { describe, expect, it } from "vitest";
import { modelSourceFor } from "./platform.ts";

describe("modelSourceFor", () => {
  it("reads the models from the APK assets inside the Capacitor shell", () => {
    expect(modelSourceFor({ Capacitor: { isNativePlatform: () => true } })).toBe("bundled");
  });
  it("downloads and caches them in a browser (PWA)", () => {
    expect(modelSourceFor({})).toBe("download");
    // Le pont Capacitor peut exister dans un navigateur (paquet web) : seule la plateforme native compte.
    expect(modelSourceFor({ Capacitor: { isNativePlatform: () => false } })).toBe("download");
    expect(modelSourceFor({ Capacitor: {} })).toBe("download");
  });
  it("falls back to download if the bridge throws", () => {
    expect(modelSourceFor({ Capacitor: { isNativePlatform: () => { throw new Error("x"); } } })).toBe("download");
  });
});
