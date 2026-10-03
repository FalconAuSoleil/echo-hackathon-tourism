import { describe, expect, it } from "vitest";
import { scrubPii } from "./pii.ts";

const s = (t: string, lang = "en") => scrubPii(t, lang).text;

describe("scrubPii", () => {
  it("retire les noms après une présentation, dans les 4 langues", () => {
    expect(s("Hi, my name is Anna Smith and we loved it")).toBe("Hi, my name is [nom] and we loved it");
    expect(s("Bonjour, je m'appelle Marie, c'était super", "fr")).toBe("Bonjour, je m'appelle [nom], c'était super");
    expect(s("Hallo, ich heiße Jürgen, es war toll", "de")).toBe("Hallo, ich heiße [nom], es war toll");
    expect(s("Hola, me llamo José Luis y todo fue genial", "es")).toBe("Hola, me llamo [nom] y todo fue genial");
  });
  it("retire un prénom dicté en minuscules après une présentation explicite", () => {
    expect(s("my name is anna, the coffee was great")).toBe("my name is [nom], the coffee was great");
  });
  it("ne prend pas un adjectif pour un nom", () => {
    expect(s("I am happy with the visit")).toBe("I am happy with the visit");
    expect(s("Je suis ravie de la visite", "fr")).toBe("Je suis ravie de la visite");
    expect(s("I am German and loved it")).toBe("I am German and loved it");
  });
  it("retire les noms après civilité, rôle ou remerciement", () => {
    expect(s("Our guide Eric was great")).toBe("Our guide [nom] was great");
    expect(s("Unser Guide Jean-Paul war super und Frau Müller auch", "de")).toBe("Unser Guide [nom] war super und Frau [nom] auch");
    expect(s("Thank you Noor for everything")).toBe("Thank you [nom] for everything");
    expect(s("Gracias, Marta, por todo", "es")).toBe("Gracias, [nom], por todo");
  });
  it("retire les mots à majuscule en milieu de phrase (en/fr/es) mais garde lieux, langues, jours", () => {
    expect(s("We visited with Claire and Tom last Sunday in Rwanda")).toBe("We visited with [nom] and [nom] last Sunday in Rwanda");
    expect(s("La visite avec Jacqueline était top", "fr")).toBe("La visite avec [nom] était top");
    expect(s("I'm sure we'll come back")).toBe("I'm sure we'll come back");
  });
  it("ne touche pas aux noms communs allemands (majuscules)", () => {
    expect(s("Der Weg war lang aber der Kaffee war gut", "de")).toBe("Der Weg war lang aber der Kaffee war gut");
  });
  it("ne prend pas le début de phrase pour un nom", () => {
    expect(s("Great tour. Coffee was amazing")).toBe("Great tour. Coffee was amazing");
    expect(s("Great tour\nCoffee was amazing")).toBe("Great tour\nCoffee was amazing");
  });
  it("retire numéros de téléphone, e-mails écrits ou dictés, pseudonymes", () => {
    const r = scrubPii("Call me on +250 788 123 456 or write to anna.smith@mail.com, insta @anna_travels", "en");
    expect(r.text).toBe("Call me on [numéro] or write to [e-mail], insta [pseudo]");
    expect(r.removed).toEqual({ names: 0, phones: 1, emails: 1, handles: 1 });
    expect(s("écrivez à marie point dupont at gmail dot com", "fr")).toBe("écrivez à marie point [e-mail]");
    expect(s("mon numéro 07 88 12 34 56", "fr")).toBe("mon numéro [numéro]");
  });
  it("garde les petits nombres (durées, prix)", () => {
    expect(s("We walked 45 minutes and paid 10000 francs")).toBe("We walked 45 minutes and paid 10000 francs");
  });
  it("compte les noms retirés", () => {
    expect(scrubPii("my name is Anna and our guide Eric was great", "en").removed.names).toBe(2);
  });
});
