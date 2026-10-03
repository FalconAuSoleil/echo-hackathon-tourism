import { describe, expect, it } from "vitest";
import catalogJson from "../../../catalog/catalog.json" with { type: "json" };
import { CatalogError, FINDING_IDS, fillSlots, validateCatalog } from "./catalog.ts";

describe("catalog", () => {
  it("le catalogue du dépôt est valide et contient les 21 constats", () => {
    const c = validateCatalog(catalogJson);
    expect(c.findings.map((f) => f.id)).toEqual([...FINDING_IDS]);
    expect(c.findings.filter((f) => f.polarity === "positive")).toHaveLength(11);
  });

  it("refuse un constat manquant ou une polarité fausse", () => {
    const bad = JSON.parse(JSON.stringify(catalogJson)) as { findings: { id: string; polarity: string }[] };
    bad.findings = bad.findings.slice(1);
    bad.findings[0]!.polarity = "negative";
    expect(() => validateCatalog(bad)).toThrow(CatalogError);
  });

  it("remplit uniquement les emplacements connus", () => {
    expect(fillSlots("{k}/{n} — {finding}", { k: 3, n: 7, finding: "X" })).toBe("3/7 — X");
    expect(() => fillSlots("{n}", {})).toThrow(CatalogError);
  });
});
