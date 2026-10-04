import { describe, expect, it } from "vitest";
import { detectNegation } from "./negation.ts";

const neg = (t: string, lang: string) => detectNegation(t, lang);

describe("detectNegation", () => {
  it("repère les négations simples dans les 4 langues", () => {
    expect(neg("The path was not too long", "en").negated).toBe(true);
    expect(neg("We didn't wait at all", "en")).toMatchObject({ negated: true, uncertain: false });
    expect(neg("There was never any shade", "en").negated).toBe(true);
    expect(neg("Le chemin n'était pas trop long", "fr")).toMatchObject({ negated: true, uncertain: false });
    expect(neg("on n'a jamais attendu", "fr").negated).toBe(true);
    expect(neg("le chemin pas trop long", "fr").negated).toBe(true); // « ne » omis à l'oral
    expect(neg("Der Weg war nicht zu lang", "de").negated).toBe(true);
    expect(neg("Es gab keinen Schatten", "de").negated).toBe(true);
    expect(neg("El camino no era largo", "es").negated).toBe(true);
    expect(neg("Nunca esperamos", "es").negated).toBe(true);
    expect(neg("yo tampoco", "es").negated).toBe(true);
  });
  it("ne voit pas de négation dans une phrase affirmative", () => {
    expect(neg("The path was far too long", "en")).toEqual({ negated: false, uncertain: false, cues: [] });
    expect(neg("Le repas était délicieux", "fr").negated).toBe(false);
    expect(neg("Die Röstung war toll", "de").negated).toBe(false);
    expect(neg("La comida estaba deliciosa", "es").negated).toBe(false);
    expect(neg("Notable views and a nobel host", "en").negated).toBe(false); // pas de faux positif sur « not- » dans un mot
  });
  it("« ne ... plus » est une négation, « plus » seul non", () => {
    expect(neg("il n'y avait plus d'eau", "fr").negated).toBe(true);
    expect(neg("j'aurais aimé plus d'ombre", "fr").negated).toBe(false);
  });
  it("ignore les tournures qui n'inversent pas le sens", () => {
    expect(neg("not only the coffee", "en").negated).toBe(false);
    expect(neg("I will never forget this visit", "en").negated).toBe(false);
    expect(neg("sans doute la meilleure visite", "fr").negated).toBe(false);
    expect(neg("nicht nur der Kaffee", "de").negated).toBe(false);
    expect(neg("sin duda volveremos", "es").negated).toBe(false);
  });
  it("marque incertaines les litotes et atténuations", () => {
    expect(neg("the food was not bad", "en")).toMatchObject({ negated: true, uncertain: true });
    expect(neg("c'était pas mal", "fr")).toMatchObject({ negated: true, uncertain: true });
    expect(neg("nicht wirklich lang", "de")).toMatchObject({ negated: true, uncertain: true });
    expect(neg("no estuvo mal", "es")).toMatchObject({ negated: true, uncertain: true });
  });
  it("double négation incertaine en anglais / allemand, concordance négative normale en français / espagnol", () => {
    expect(neg("it was not without charm", "en").uncertain).toBe(true);
    expect(neg("no había nada para comer", "es")).toMatchObject({ negated: true, uncertain: false });
    expect(neg("il n'y avait jamais rien à boire", "fr")).toMatchObject({ negated: true, uncertain: false });
  });
  it("renvoie les marqueurs repérés", () => {
    expect(neg("We couldn't buy coffee", "en").cues).toEqual(["n't"]);
  });
  it("« sans hésiter » et ses équivalents ne sont pas des négations (echo-recall)", () => {
    expect(detectNegation("Je recommande sans hésiter", "fr").negated).toBe(false);
    expect(detectNegation("I would recommend it without hesitation", "en").negated).toBe(false);
    expect(detectNegation("Wir würden ohne zu zögern wiederkommen", "de").negated).toBe(false);
    expect(detectNegation("Lo recomiendo sin dudarlo", "es").negated).toBe(false);
    // une vraie négation dans la même phrase reste détectée
    expect(detectNegation("Sans hésiter, mais le repas n'était pas bon", "fr").negated).toBe(true);
    expect(detectNegation("sans eau ni ombre", "fr").negated).toBe(true);
  });
});
