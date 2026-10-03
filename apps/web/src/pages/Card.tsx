import { useEffect, useState } from "preact/hooks";
import { getSettings } from "../lib/db.ts";
import { db } from "../lib/host-store.ts";

// Texte de la carte (SPEC 4.1), rédigé par l'équipe dans les 4 langues visiteur. La phrase de consentement
// est explicite : envoyer le message vaut accord.
export const CARD_TEXT = [
  {
    lang: "en",
    name: "English",
    title: "How was your visit?",
    body: "Tell us in 30 seconds what you liked and what was missing. Send a WhatsApp voice message to this number.",
    privacy: "The sound is deleted after analysis, and your name is not kept.",
    consent: "By sending this message, you agree that it is analysed in this way.",
  },
  {
    lang: "fr",
    name: "Français",
    title: "Comment s'est passée votre visite ?",
    body: "Dites-nous en 30 secondes ce que vous avez aimé et ce qui a manqué. Envoyez un message vocal WhatsApp à ce numéro.",
    privacy: "Le son est effacé après analyse, et votre nom n'est pas conservé.",
    consent: "En envoyant ce message, vous acceptez qu'il soit analysé de cette façon.",
  },
  {
    lang: "de",
    name: "Deutsch",
    title: "Wie war Ihr Besuch?",
    body: "Sagen Sie uns in 30 Sekunden, was Ihnen gefallen hat und was gefehlt hat. Schicken Sie eine WhatsApp-Sprachnachricht an diese Nummer.",
    privacy: "Die Aufnahme wird nach der Auswertung gelöscht, und Ihr Name wird nicht gespeichert.",
    consent: "Mit dem Senden dieser Nachricht stimmen Sie dieser Auswertung zu.",
  },
  {
    lang: "es",
    name: "Español",
    title: "¿Qué tal su visita?",
    body: "Cuéntenos en 30 segundos qué le gustó y qué faltó. Envíe un mensaje de voz de WhatsApp a este número.",
    privacy: "El audio se borra después del análisis y su nombre no se guarda.",
    consent: "Al enviar este mensaje, acepta que se analice de esta manera.",
  },
] as const;

export function Card() {
  const [phone, setPhone] = useState("");
  const [farm, setFarm] = useState("");
  useEffect(() => {
    void db()
      .then(getSettings)
      .then((s) => {
        setPhone(s.farmPhone);
        setFarm(s.farmName);
      });
  }, []);
  return (
    <>
      <section class="card no-print">
        <h1 style={{ fontSize: "1.3rem" }}>Printable visitor card</h1>
        <p class="muted" style={{ fontSize: "0.88rem" }}>
          Handed to visitors at the end of the visit. The number and farm name come from Settings; you can also edit them here for this print.
        </p>
        <div class="grid2">
          <label class="field">
            <span>Farm name</span>
            <input type="text" value={farm} onInput={(e) => setFarm((e.target as HTMLInputElement).value)} />
          </label>
          <label class="field">
            <span>WhatsApp number</span>
            <input type="tel" value={phone} onInput={(e) => setPhone((e.target as HTMLInputElement).value)} />
          </label>
        </div>
        <button onClick={() => window.print()}>Print</button>
      </section>
      <div class="visitor-card" data-testid="visitor-card">
        {farm && <h2 style={{ textAlign: "center" }}>{farm}</h2>}
        <div class="phone">WhatsApp: {phone || "+250 ___ ___ ___"}</div>
        <div class="langs">
          {CARD_TEXT.map((t) => (
            <div class="lang" lang={t.lang} key={t.lang}>
              <h3>{t.name}</h3>
              <p>
                <strong>{t.title}</strong> {t.body}
              </p>
              <p style={{ fontSize: "0.9rem" }}>
                {t.privacy} <strong>{t.consent}</strong>
              </p>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
