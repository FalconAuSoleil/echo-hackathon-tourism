// Stockage sur l'appareil uniquement (IndexedDB), exactement ce que SPEC 6 autorise (docs/ARCHITECTURE.md §7).
// Utilisé par l'interface ET par le service worker (Web Share Target → file d'attente).
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { DEFAULT_CONFIG, closeMonthReviewChunks, expireMessageEmbedding, scrubForQueue, isClosedMonth, localMonth, monthOfReceived, type AnalysisConfig, type KnownMessage, type RecapLine, type ReviewChunk, type StoredMessage } from "@echo/core";

export interface QueueItem {
  id: string;
  receivedAt: string;
  kind: "audio" | "text";
  /** Audio partagé ou importé : supprimé dès la fin de la transcription. */
  blob?: Blob;
  mime?: string;
  name?: string;
  /** Message écrit : supprimé après analyse. */
  text?: string;
  via: "share" | "file" | "paste" | "record";
}

export interface StoredRecap {
  month: string;
  lines: RecapLine[];
  builtAt: string;
  smsOpenedAt?: string;
}

export interface Settings {
  /** Numéro du téléphone (simple) de l'hôte qui reçoit le récap par SMS. */
  hostPhone: string;
  /** Numéro WhatsApp de la ferme imprimé sur la carte visiteur. */
  farmPhone: string;
  farmName: string;
  /** A : l'hôte a un Android ; B : l'hôte a un téléphone simple (récap par SMS). */
  mode: "A" | "B";
  pin?: { salt: string; hash: string; iterations: number };
  coopConsent: boolean;
  /**
   * Messages vocaux partagés ou importés (depuis WhatsApp) déjà analysés, dont l'original est encore dans
   * WhatsApp : la carte promet que le son est effacé, l'app le rappelle jusqu'à ce que l'hôte confirme.
   * Un simple compteur (aucun identifiant de message ni d'expéditeur).
   */
  whatsappToDelete?: number;
}

export const DEFAULT_SETTINGS: Settings = { hostPhone: "", farmPhone: "", farmName: "", mode: "B", coopConsent: false };

interface EchoDB extends DBSchema {
  queue: { key: string; value: QueueItem };
  messages: { key: string; value: StoredMessage; indexes: { month: string; fingerprint: string } };
  reviewChunks: { key: string; value: ReviewChunk; indexes: { month: string; messageId: string } };
  recaps: { key: string; value: StoredRecap };
  settings: { key: string; value: { key: string; value: unknown } };
}

export type EchoDatabase = IDBPDatabase<EchoDB>;

export const DB_NAME = "echo";

export function openEchoDB(name = DB_NAME): Promise<EchoDatabase> {
  return openDB<EchoDB>(name, 1, {
    upgrade(db) {
      db.createObjectStore("queue", { keyPath: "id" });
      const m = db.createObjectStore("messages", { keyPath: "id" });
      m.createIndex("month", "month");
      m.createIndex("fingerprint", "fingerprint");
      const r = db.createObjectStore("reviewChunks", { keyPath: "id" });
      r.createIndex("month", "month");
      r.createIndex("messageId", "messageId");
      db.createObjectStore("recaps", { keyPath: "month" });
      db.createObjectStore("settings", { keyPath: "key" });
    },
  });
}

export function newId(prefix = "m"): string {
  const rnd = crypto.getRandomValues(new Uint32Array(2));
  return `${prefix}-${Date.now().toString(36)}-${rnd[0]!.toString(36)}${rnd[1]!.toString(36)}`;
}

/**
 * Met un message dans la file. Un message écrit est nettoyé (noms, numéros, e-mails) avant d'être écrit : il
 * peut attendre des jours que l'hôte lance l'analyse. Un message vocal ne peut l'être qu'après transcription ;
 * son fichier est supprimé dès la fin de celle-ci.
 */
export async function enqueue(db: EchoDatabase, item: Omit<QueueItem, "id"> & { id?: string }): Promise<string> {
  const id = item.id ?? newId("q");
  const safe = item.kind === "text" && typeof item.text === "string" ? { ...item, text: scrubForQueue(item.text) } : item;
  await db.put("queue", { ...safe, id });
  return id;
}

export async function getSettings(db: EchoDatabase): Promise<Settings> {
  const rows = await db.getAll("settings");
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return out as unknown as Settings;
}

export async function saveSettings(db: EchoDatabase, patch: Partial<Settings>): Promise<void> {
  const tx = db.transaction("settings", "readwrite");
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) await tx.store.delete(key);
    else await tx.store.put({ key, value });
  }
  await tx.done;
}

/** Ajoute `k` au compteur des messages vocaux à effacer dans WhatsApp (dans une seule transaction). */
export async function addWhatsappToDelete(db: EchoDatabase, k: number): Promise<number> {
  const tx = db.transaction("settings", "readwrite");
  const row = await tx.store.get("whatsappToDelete");
  const next = (typeof row?.value === "number" ? row.value : 0) + k;
  await tx.store.put({ key: "whatsappToDelete", value: next });
  await tx.done;
  return next;
}

/** Message de la file dont l'original reste dans WhatsApp : audio reçu par partage ou import de fichier. */
export function originalStaysInWhatsapp(item: Pick<QueueItem, "kind" | "via">): boolean {
  return item.kind === "audio" && (item.via === "share" || item.via === "file");
}

/**
 * Enregistre le résultat d'une analyse : la fiche du message (sans texte) et les morceaux « pas sûr » /
 * « hors liste » nettoyés. Rien d'autre n'est persisté (ni audio, ni texte complet, ni expéditeur).
 */
export async function saveAnalysis(db: EchoDatabase, message: StoredMessage, review: ReviewChunk[]): Promise<void> {
  const tx = db.transaction(["messages", "reviewChunks"], "readwrite");
  await tx.objectStore("messages").put(message);
  for (const c of review) await tx.objectStore("reviewChunks").put(c);
  await tx.done;
}

export async function knownMessages(db: EchoDatabase): Promise<KnownMessage[]> {
  const all = await db.getAll("messages");
  // Une fiche sortie de la fenêtre des doublons n'a plus ni empreinte ni embedding : elle ne compte plus.
  return all.flatMap((m) => (m.fingerprint === undefined ? [] : [{ fingerprint: m.fingerprint, receivedAt: m.receivedAt, ...(m.embedding ? { embedding: m.embedding } : {}) }]));
}

/**
 * Retire l'embedding et l'empreinte des fiches plus vieilles que la fenêtre des doublons (SPEC 6 : ils ne servent
 * qu'à repérer un doublon dans cette fenêtre). Appelé à l'ouverture de l'app et avant chaque traitement de la file.
 * Renvoie le nombre de fiches modifiées.
 */
export async function pruneExpiredEmbeddings(db: EchoDatabase, now = new Date(), duplicateWindowDays = DEFAULT_CONFIG.duplicateWindowDays): Promise<number> {
  const tx = db.transaction("messages", "readwrite");
  let n = 0;
  for (const m of await tx.store.getAll()) {
    const pruned = expireMessageEmbedding(m, now, duplicateWindowDays);
    if (pruned) {
      await tx.store.put(pruned);
      n++;
    }
  }
  await tx.done;
  return n;
}

/**
 * Ferme les mois terminés (SPEC 6) : pour chaque mois avant le mois courant dont des morceaux « À faire lire »
 * ont encore leur embedding, les sujets inconnus sont regroupés une fois (`clusterId`, `clusterRecurring`
 * écrits sur les morceaux) puis tous les embeddings du mois sont retirés (`closeMonthReviewChunks`). Les mois
 * qui ont encore des messages dans la file (`pendingMonths`) attendent le prochain passage. Appelé à
 * l'ouverture de l'app, avant et après chaque traitement de la file. Renvoie les mois fermés.
 */
export async function closeFinishedMonths(
  db: EchoDatabase,
  now = new Date(),
  pendingMonths: ReadonlySet<string> = new Set(),
  config: Pick<AnalysisConfig, "offListClusterThreshold" | "offListMinVisitors" | "unknownTopicSources"> = DEFAULT_CONFIG,
): Promise<string[]> {
  const current = localMonth(now); // même horloge que `month` des fiches (heure locale)
  const tx = db.transaction("reviewChunks", "readwrite");
  const byMonth = new Map<string, ReviewChunk[]>();
  for (const c of await tx.store.getAll()) {
    if (!c.embedding || !isClosedMonth(c.month, current) || pendingMonths.has(c.month)) continue;
    byMonth.set(c.month, [...(byMonth.get(c.month) ?? []), c]);
  }
  const closed: string[] = [];
  for (const [month] of byMonth) {
    const all = await tx.store.index("month").getAll(month);
    for (const c of closeMonthReviewChunks(all, config)) await tx.store.put(c);
    closed.push(month);
  }
  await tx.done;
  return closed.sort();
}

/** Mois des messages encore dans la file (date de réception). */
export async function queuedMonths(db: EchoDatabase): Promise<Set<string>> {
  return new Set((await db.getAll("queue")).map((q) => monthOfReceived(q.receivedAt)));
}

/** Efface toutes les données Echo de l'appareil (réglages compris si `includeSettings`). */
export async function wipeAll(db: EchoDatabase, includeSettings = false): Promise<void> {
  type Store = "queue" | "messages" | "reviewChunks" | "recaps" | "settings";
  const stores: Store[] = ["queue", "messages", "reviewChunks", "recaps", ...(includeSettings ? (["settings"] as const) : [])];
  const tx = db.transaction(stores, "readwrite");
  for (const s of stores) await tx.objectStore(s).clear();
  await tx.done;
}
