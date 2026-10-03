import { describe, expect, it } from "vitest";
import { buildMonthlyRecap, recapRwLines } from "./recap.ts";
import { gsm7Length, isGsm7, smsUri, splitSms, toGsm7 } from "./sms.ts";
import { testCatalog } from "./test-fixtures.ts";

describe("GSM-7", () => {
  it("reconnaît l'alphabet GSM 03.38", () => {
    expect(isGsm7("Uku kwezi: ibitekerezo 7.")).toBe(true);
    expect(isGsm7("é è à ü ñ ß {€}")).toBe(true);
    expect(isGsm7("“quote” — ê")).toBe(false);
    expect(gsm7Length("a€{")).toBe(5);
  });
  it("translittère tout caractère hors GSM-7", () => {
    expect(toGsm7("“Murakoze” — c’est très bien… ê î ô û")).toBe('"Murakoze" - c\'est très bien... e i o u');
    expect(toGsm7("Œuvre ½")).toBe("OEuvre 1/2");
    expect(toGsm7("中")).toBe("?");
    for (const s of ["ŝ ĉ ğ ş ž", " x y", "😀"]) expect(isGsm7(toGsm7(s))).toBe(true);
  });
});

describe("splitSms", () => {
  it("garde les lignes entières dans un même SMS quand elles tiennent", () => {
    expect(splitSms(["a".repeat(70), "b".repeat(70)])).toEqual([`${"a".repeat(70)}\n${"b".repeat(70)}`]);
  });
  it("ne coupe jamais une ligne entre deux SMS si elle tient seule", () => {
    const lines = ["a".repeat(100), "b".repeat(100), "c".repeat(50)];
    const parts = splitSms(lines);
    expect(parts).toEqual(["a".repeat(100), `${"b".repeat(100)}\n${"c".repeat(50)}`]);
    for (const p of parts) expect(gsm7Length(p)).toBeLessThanOrEqual(160);
  });
  it("coupe aux espaces une ligne trop longue", () => {
    const long = Array.from({ length: 60 }, (_, i) => `mot${i}`).join(" ");
    const parts = splitSms([long], 160);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(gsm7Length(p)).toBeLessThanOrEqual(160);
    expect(parts.join(" ")).toBe(long);
  });
  it("numérote (i/N) si demandé, sans dépasser la limite", () => {
    const parts = splitSms(["a".repeat(150), "b".repeat(150)], 160, { numbered: true });
    expect(parts).toEqual([`${"a".repeat(150)} (1/2)`, `${"b".repeat(150)} (2/2)`]);
    expect(splitSms(["court"], 160, { numbered: true })).toEqual(["court"]);
  });
  it("un vrai récap tient en SMS GSM-7 autonomes", () => {
    const r = buildMonthlyRecap(
      {
        month: "2026-10",
        messages: [
          { id: "1", month: "2026-10", status: "analyzed", findings: ["P1", "N1"], notSureCount: 1 },
          { id: "2", month: "2026-10", status: "analyzed", findings: ["P1", "N1"], notSureCount: 0 },
        ],
        recurringUnknownVisitors: 3,
      },
      testCatalog(),
    );
    const parts = splitSms(recapRwLines(r));
    for (const p of parts) {
      expect(isGsm7(p)).toBe(true);
      expect(gsm7Length(p)).toBeLessThanOrEqual(160);
    }
    // chaque ligne du récap se retrouve entière dans un SMS
    for (const line of recapRwLines(r)) expect(parts.some((p) => p.split("\n").includes(line))).toBe(true);
  });
  it("smsUri encode le numéro et le corps", () => {
    expect(smsUri("+250 788", "a b\nc")).toBe("sms:%2B250%20788?body=a%20b%0Ac");
  });
});
