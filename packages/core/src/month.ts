// Une seule horloge pour les mois (SPEC 4.6) : le mois local de l'appareil. Le mois d'un message (date de
// réception), le mois courant du récap et la fermeture des mois terminés utilisent tous ces fonctions, pour qu'un
// message reçu le soir du dernier jour du mois (ou juste après minuit le 1er) tombe dans le mois que voit l'hôte.

/** Mois local "YYYY-MM" d'un instant (fuseau horaire de l'appareil). */
export function localMonth(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Mois local de la date de réception d'un message (ISO 8601). Date illisible : les 7 premiers caractères. */
export function monthOfReceived(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso.slice(0, 7) : localMonth(new Date(t));
}
