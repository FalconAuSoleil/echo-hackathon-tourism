import { describe, expect, it } from "vitest";
import { segment, splitClauses, splitSentences } from "./segment.ts";

const texts = (t: string, lang: string) => segment(t, lang).map((s) => s.text);

describe("splitSentences", () => {
  it("coupe sur . ! ? et retours à la ligne, sans couper les décimales ni les abréviations", () => {
    expect(splitSentences("Great visit! The walk took 2.5 hours. Mr. Smith agreed?\nThanks")).toEqual([
      "Great visit!",
      "The walk took 2.5 hours.",
      "Mr. Smith agreed?",
      "Thanks",
    ]);
  });
  it("ignore les morceaux sans lettre", () => {
    expect(splitSentences("... !! Merci.")).toEqual(["Merci."]);
  });
});

describe("splitClauses", () => {
  it("coupe sur les adversatifs dans les 4 langues et retire le connecteur", () => {
    expect(splitClauses("The roasting was great but the path was too long", "en")).toEqual(["The roasting was great", "the path was too long"]);
    expect(splitClauses("L'accueil était super, mais le repas était froid", "fr")).toEqual(["L'accueil était super", "le repas était froid"]);
    expect(splitClauses("Die Röstung war toll, aber der Weg war zu lang", "de")).toEqual(["Die Röstung war toll", "der Weg war zu lang"]);
    expect(splitClauses("La visita fue bonita, sin embargo demasiado larga", "es")).toEqual(["La visita fue bonita", "demasiado larga"]);
  });
  it("coupe sur les coordinations seulement entre deux propositions assez longues", () => {
    expect(splitClauses("The welcome was warm and the meal was delicious", "en")).toEqual(["The welcome was warm", "the meal was delicious"]);
    expect(splitClauses("Clear explanations about coffee and the farm", "en")).toEqual(["Clear explanations about coffee and the farm"]);
    expect(splitClauses("Accueil chaleureux et repas délicieux", "fr")).toEqual(["Accueil chaleureux et repas délicieux"]);
    expect(splitClauses("Das Essen war lecker und der Kaffee war wunderbar", "de")).toEqual(["Das Essen war lecker", "der Kaffee war wunderbar"]);
    expect(splitClauses("La comida estaba rica y el café era excelente", "es")).toEqual(["La comida estaba rica", "el café era excelente"]);
  });
  it("coupe un subordonnant concessif en tête à la première virgule", () => {
    expect(splitClauses("Although the path was long, we loved the visit", "en")).toEqual(["the path was long", "we loved the visit"]);
    expect(splitClauses("Obwohl der Weg lang war, hat es uns gefallen", "de")).toEqual(["der Weg lang war", "hat es uns gefallen"]);
  });
  it("garde « not X but Y » lisible : chaque partie garde sa négation", () => {
    expect(splitClauses("nicht zu lang, sondern zu kurz", "de")).toEqual(["nicht zu lang", "zu kurz"]);
  });
  it("utilise tous les connecteurs quand la langue est inconnue", () => {
    expect(splitClauses("muy bonito pero caro", "unknown")).toEqual(["muy bonito", "caro"]);
  });
});

describe("segment", () => {
  it("numérote phrases et propositions", () => {
    expect(segment("Great welcome. Tasty food but no shade.", "en")).toEqual([
      { text: "Great welcome.", sentenceIndex: 0, clauseIndex: 0 },
      { text: "Tasty food", sentenceIndex: 1, clauseIndex: 0 },
      { text: "no shade.", sentenceIndex: 1, clauseIndex: 1 },
    ]);
  });
  it("texte vide → aucun morceau", () => {
    expect(segment("   ", "en")).toEqual([]);
  });
  it("ne coupe pas à l'intérieur d'un mot qui contient un connecteur", () => {
    expect(texts("Butter and bread were tasty", "en")).toEqual(["Butter and bread were tasty"]);
    expect(texts("Le maïs était bon", "fr")).toEqual(["Le maïs était bon"]);
  });
});

describe("options de découpage (echo-recall, désactivées par défaut)", () => {
  const legacy = (t: string, lang: string) => segment(t, lang).map((s) => s.text);
  const withOpts = (t: string, lang: string, o: { commaMinWords: number; causal: boolean }) => segment(t, lang, o).map((s) => s.text);
  it("virgule seule : coupure si chaque côté a au moins N mots, jamais dans une énumération courte", () => {
    const t = "The plantation was really lovely, we learned how the coffee grows";
    expect(legacy(t, "en")).toEqual([t]);
    expect(withOpts(t, "en", { commaMinWords: 3, causal: false })).toEqual(["The plantation was really lovely", "we learned how the coffee grows"]);
    expect(withOpts("Great coffee, the food was good", "en", { commaMinWords: 3, causal: false })).toEqual(["Great coffee, the food was good"]);
  });
  it("connecteurs de cause : coupure et connecteur retiré, y compris « parce qu'on »", () => {
    expect(withOpts("The visit was too long because we waited an hour", "en", { commaMinWords: 0, causal: true })).toEqual(["The visit was too long", "we waited an hour"]);
    expect(withOpts("C'était trop long parce qu'on a attendu", "fr", { commaMinWords: 0, causal: true })).toEqual(["C'était trop long", "on a attendu"]);
    expect(legacy("The visit was too long because we waited an hour", "en")).toEqual(["The visit was too long because we waited an hour"]);
  });
});
