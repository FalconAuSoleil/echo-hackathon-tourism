import { describe, expect, it } from "vitest";
import catalogJson from "../../../catalog/catalog.json" with { type: "json" };
import { CatalogError, FINDING_IDS, UI_LABEL_IDS, fillSlots, uiLabel, validateCatalog } from "./catalog.ts";

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

  it("libellés figés de l'app hôte : tous présents, {n} rempli en chiffres, emplacement faux refusé", () => {
    const c = validateCatalog(catalogJson);
    expect(c.ui?.map((u) => u.id)).toEqual([...UI_LABEL_IDS]);
    for (const u of c.ui ?? []) expect(u.kinyarwanda.status).toBe("machine_translated_unvalidated");
    const del = uiLabel(c, "delete_whatsapp", 3)!;
    expect(del).toContain("3");
    expect(del).not.toMatch(/\{/);
    expect(uiLabel({ ...c, ui: [] }, "listen")).toBeNull();
    const bad = JSON.parse(JSON.stringify(catalogJson)) as { ui: { slots: string[] }[] };
    bad.ui[0]!.slots = ["n"];
    expect(() => validateCatalog(bad)).toThrow(CatalogError);
  });
});
