import { describe, expect, it } from "vitest";
import { keywordClassify } from "@echo/core";
import { readJson } from "./io.ts";
import { CATALOG_PATH } from "./paths.ts";
import { KEYWORD_SET_NAMES, loadKeywordSet, primaryKeywordSet } from "./keyword-sets.ts";

const ids = readJson<{ findings: { id: string }[] }>(CATALOG_PATH).findings.map((f) => f.id);

describe("jeux de mots-clés", () => {
  it("jeu principal : blind par défaut, original sur demande, erreur sinon", () => {
    expect(primaryKeywordSet({})).toBe("blind");
    expect(primaryKeywordSet({ ECHO_KEYWORDS: "original" })).toBe("original");
    expect(primaryKeywordSet({ ECHO_KEYWORDS: "blind" })).toBe("blind");
    expect(() => primaryKeywordSet({ ECHO_KEYWORDS: "other" })).toThrow();
  });
  it("les deux jeux se chargent", () => {
    for (const name of KEYWORD_SET_NAMES) expect(Object.keys(loadKeywordSet(name)).length).toBeGreaterThan(0);
  });
  it("le jeu aveugle couvre chaque constat du catalogue dans les quatre langues", () => {
    const blind = loadKeywordSet("blind");
    expect(Object.keys(blind).sort()).toEqual([...ids].sort());
    for (const id of ids) for (const l of ["en", "fr", "de", "es"]) expect(blind[id as keyof typeof blind]?.[l]?.length ?? 0).toBeGreaterThan(4);
  });
  it("le jeu aveugle trouve les formulations évidentes", () => {
    const blind = loadKeywordSet("blind");
    expect(keywordClassify("The view over the hills", "en", blind)).toContain("P7");
    expect(keywordClassify("Il n'y avait pas de toilettes", "fr", blind)).toContain("N7");
    expect(keywordClassify("Wir mussten lange warten", "de", blind)).toContain("N9");
    expect(keywordClassify("Volveremos seguro", "es", blind)).toContain("P10");
  });
});
