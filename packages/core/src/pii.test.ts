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
  it("ne prend pas un mot courant en début de phrase pour un nom", () => {
    expect(s("Great tour. Coffee was amazing")).toBe("Great tour. Coffee was amazing");
    expect(s("Great tour\nCoffee was amazing")).toBe("Great tour\nCoffee was amazing");
  });
  it("retire un prénom du dictionnaire en début de phrase, en allemand et en minuscules", () => {
    expect(s("Eric was a bit hard to follow at times.")).toBe("[nom] was a bit hard to follow at times.");
    expect(s("Anna and I loved it.")).toBe("[nom] and I loved it.");
    expect(s("Marie a trouvé le chemin long.", "fr")).toBe("[nom] a trouvé le chemin long.");
    expect(s("Juan y yo volveremos.", "es")).toBe("[nom] y yo volveremos.");
    expect(s("Unser Guide hieß Jean-Pierre und war super, Thomas fand den Weg lang.", "de")).toBe("Unser Guide hieß [nom] und war super, [nom] fand den Weg lang.");
    expect(s("eric was a bit hard to follow at times")).toBe("[nom] was a bit hard to follow at times");
    expect(s("Uwimana showed us the trees")).toBe("[nom] showed us the trees");
    expect(scrubPii("Eric's explanations were too fast", "en").removed.names).toBe(1);
  });
  it("garde un prénom qui est aussi un mot courant, sauf coordonné à un nom retiré", () => {
    expect(s("Pierre a été super", "fr")).toBe("Pierre a été super");
    expect(s("Will we come back? Yes!")).toBe("Will we come back? Yes!");
    expect(s("Pierre et Valentin ont trouvé ça long.", "fr")).toBe("[nom] et [nom] ont trouvé ça long.");
    expect(s("Grace and I loved it")).toBe("[nom] and I loved it");
    expect(s("Liebe Grüße von Felix", "de")).toBe("Liebe Grüße von [nom]");
    expect(s("Der Kaffee war gut und die Rösterei auch.", "de")).toBe("Der Kaffee war gut und die Rösterei auch.");
  });
  it("retire un numéro dicté en toutes lettres, garde les petits nombres dits", () => {
    expect(s("call me on zero seven eight eight, one two three, four five six")).toBe("call me on [numéro]");
    expect(s("mon numéro c'est zéro sept quatre-vingt-huit douze trente-quatre cinquante-six", "fr")).toBe("mon numéro c'est [numéro]");
    expect(s("Meine Nummer ist null sieben acht acht eins zwei drei vier", "de")).toBe("Meine Nummer ist [numéro]");
    expect(s("plus two five zero double seven eight one two three", "en")).toBe("[numéro]");
    expect(s("We were two or three people, maybe four")).toBe("We were two or three people, maybe four");
    expect(s("the visit lasted three and a half hours")).toBe("the visit lasted three and a half hours");
    expect(s("éramos cuatro o cinco y pagamos diez mil", "es")).toBe("éramos cuatro o cinco y pagamos diez mil");
  });
  it("retire numéros de téléphone, e-mails écrits ou dictés, pseudonymes", () => {
    const r = scrubPii("Call me on +250 788 123 456 or write to anna.smith@mail.com, insta @anna_travels", "en");
    expect(r.text).toBe("Call me on [numéro] or write to [e-mail], insta [pseudo]");
    expect(r.removed).toEqual({ names: 0, phones: 1, emails: 1, handles: 1 });
    expect(s("écrivez à marie point dupont at gmail dot com", "fr")).toBe("écrivez à [nom] point [e-mail]");
    expect(s("mon numéro 07 88 12 34 56", "fr")).toBe("mon numéro [numéro]");
  });
  it("garde les petits nombres (durées, prix)", () => {
    expect(s("We walked 45 minutes and paid 10000 francs")).toBe("We walked 45 minutes and paid 10000 francs");
  });
  it("garde les mots techniques, unités et villes que Whisper écrit avec une majuscule", () => {
    expect(s("Is there any Wi-Fi? I couldn't check my messages all day.")).toBe("Is there any Wi-Fi? I couldn't check my messages all day.");
    expect(s("No WiFi, no GPS, but WhatsApp worked")).toBe("No WiFi, no GPS, but WhatsApp worked");
    expect(s("Pas de WI-FI ni de USB-C", "fr")).toBe("Pas de WI-FI ni de USB-C");
    expect(s("Wir haben sehr gerne bezahlt. Frank Wert.", "de")).toBe("Wir haben sehr gerne bezahlt. [nom] Wert.");
    expect(s("das war jeden Frank wert", "de")).toBe("das war jeden Frank wert");
    expect(s("paid 10 Euro per person, every Franc well spent")).toBe("paid 10 Euro per person, every Franc well spent");
    expect(s("Nous étions cinq amis de Lyon", "fr")).toBe("Nous étions cinq amis de Lyon");
    expect(s("Somos una pareja de Valencia", "es")).toBe("Somos una pareja de Valencia");
    // Une vraie personne nommée Frank reste retirée.
    expect(s("Danke Frank, es war toll", "de")).toBe("Danke [nom], es war toll");
    expect(s("Frank fand den Weg lang", "de")).toBe("[nom] fand den Weg lang");
  });
  it("compte les noms retirés", () => {
    expect(scrubPii("my name is Anna and our guide Eric was great", "en").removed.names).toBe(2);
  });
});
