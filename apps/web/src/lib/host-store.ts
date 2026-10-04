// État de l'app hôte : base IndexedDB, file d'attente, traitement hors ligne dans le worker.
import { toReviewChunks, toStoredMessage, type MessageAnalysis, type MessageInput, type ReviewChunk, type StoredMessage } from "@echo/core";
import { createStore } from "../ui/common.tsx";
import { decodeTo16kMono } from "./audio.ts";
import {
  addWhatsappToDelete,
  enqueue,
  getSettings,
  knownMessages,
  newId,
  openEchoDB,
  originalStaysInWhatsapp,
  pruneExpiredEmbeddings,
  saveAnalysis,
  saveSettings,
  type EchoDatabase,
  type QueueItem,
  type Settings,
} from "./db.ts";
import { analysis } from "./worker-client.ts";
import type { Timings } from "../worker/protocol.ts";

export interface HostState {
  loaded: boolean;
  settings: Settings;
  queue: Omit<QueueItem, "blob">[];
  messages: StoredMessage[];
  review: ReviewChunk[];
  /** Résultats détaillés de la session (en mémoire seulement : le texte complet n'est jamais stocké). */
  recent: { analysis: MessageAnalysis; timings: Timings }[];
  processing: string | null;
  /** Étape en cours, affichée sur le bouton (transcription puis analyse). */
  processingLabel: string | null;
  /** Messages vocaux transcrits (audio déjà supprimé) en attente de l'étape d'analyse. */
  transcribed: number;
  errors: Record<string, string>;
  unlocked: boolean;
}

export const host = createStore<HostState>({
  loaded: false,
  settings: { hostPhone: "", farmPhone: "", farmName: "", mode: "B", coopConsent: false },
  queue: [],
  messages: [],
  review: [],
  recent: [],
  processing: null,
  processingLabel: null,
  transcribed: 0,
  errors: {},
  unlocked: false,
});

let dbPromise: Promise<EchoDatabase> | null = null;
// À l'ouverture : les embeddings sortis de la fenêtre des doublons sont retirés des fiches.
export const db = (): Promise<EchoDatabase> =>
  (dbPromise ??= openEchoDB().then(async (d) => {
    await pruneExpiredEmbeddings(d);
    return d;
  }));

export async function refresh(): Promise<void> {
  const d = await db();
  const [settings, queue, messages, review] = await Promise.all([getSettings(d), d.getAll("queue"), d.getAll("messages"), d.getAll("reviewChunks")]);
  host.set((s) => ({
    ...s,
    loaded: true,
    settings,
    unlocked: s.unlocked || !settings.pin,
    queue: queue.map(({ blob: _b, ...rest }) => rest).sort((a, b) => a.receivedAt.localeCompare(b.receivedAt)),
    messages: messages.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)),
    review: review.sort((a, b) => b.id.localeCompare(a.id)),
  }));
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  await saveSettings(await db(), patch);
  await refresh();
}

export async function addFiles(files: FileList | File[], via: QueueItem["via"]): Promise<void> {
  const d = await db();
  for (const f of Array.from(files)) {
    if (f.type.startsWith("text/")) await enqueue(d, { kind: "text", text: await f.text(), receivedAt: new Date().toISOString(), via });
    else await enqueue(d, { kind: "audio", blob: f, mime: f.type, name: f.name, receivedAt: new Date().toISOString(), via });
  }
  await refresh();
}

export async function addText(text: string): Promise<void> {
  await enqueue(await db(), { kind: "text", text, receivedAt: new Date().toISOString(), via: "paste" });
  await refresh();
}

export async function removeQueued(id: string): Promise<void> {
  await (await db()).delete("queue", id);
  await refresh();
}

/**
 * Traite toute la file hors ligne, en deux étapes pour ne garder qu'un modèle en mémoire à la fois sur un petit
 * téléphone : 1) Whisper transcrit tous les messages vocaux (chaque fichier audio est supprimé de la file dès sa
 * transcription) ; 2) le modèle de similarité analyse les transcriptions et les messages écrits. Entre les deux,
 * les transcriptions ne vivent qu'en mémoire (jamais stockées). Si l'app est tuée entre les deux étapes, ces
 * messages sont perdus pour Echo, mais leur original est encore dans WhatsApp : le rappel d'effacement n'est
 * compté qu'après l'enregistrement de l'analyse, l'hôte peut donc les repartager.
 */
export async function processQueue(): Promise<void> {
  if (host.get().processing) return;
  const d = await db();
  await pruneExpiredEmbeddings(d);
  const items = (await d.getAll("queue")).sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  const fail = (id: string, e: unknown) => host.set((s) => ({ ...s, errors: { ...s.errors, [id]: e instanceof Error ? e.message : String(e) } }));
  const audioItems = items.filter((i) => i.kind === "audio" && i.blob);
  const ready = new Map<string, { input: MessageInput; timings: Timings }>();

  // Étape 1 : Whisper seul.
  let n = 0;
  for (const item of audioItems) {
    n++;
    host.set((s) => ({ ...s, processing: item.id, processingLabel: `Transcribing voice message ${n}/${audioItems.length} on this device…` }));
    try {
      const t0 = performance.now();
      const audio = await decodeTo16kMono(await item.blob!.arrayBuffer());
      const decodeMs = Math.round(performance.now() - t0);
      const t = await analysis.transcribeAudio(newId("m"), item.receivedAt, audio);
      // Le fichier audio est supprimé de la file dès la fin de la transcription (le tampon est déjà à zéro).
      await d.delete("queue", item.id);
      ready.set(item.id, { input: t.input, timings: { ...t.timings, decodeMs } });
      host.set((s) => ({ ...s, transcribed: ready.size }));
    } catch (e) {
      fail(item.id, e);
    }
    await refresh();
  }

  // Étape 2 : modèle de similarité seul (en mode un modèle à la fois, Whisper a été libéré).
  const toAnalyse = items.filter((i) => (i.kind === "audio" ? ready.has(i.id) : true));
  n = 0;
  for (const item of toAnalyse) {
    n++;
    host.set((s) => ({ ...s, processing: item.id, processingLabel: `Analysing message ${n}/${toAnalyse.length} on this device…` }));
    try {
      const known = await knownMessages(d);
      let r: { analysis: MessageAnalysis; timings: Timings };
      const t = ready.get(item.id);
      if (t) {
        const a = await analysis.analyzeInput(t.input, known);
        ready.delete(item.id);
        r = { analysis: a.analysis, timings: { ...t.timings, analyzeMs: a.timings.analyzeMs, totalMs: t.timings.totalMs + a.timings.totalMs } };
      } else {
        r = await analysis.analyzeText(newId("m"), item.receivedAt, item.text ?? "", known);
      }
      await saveAnalysis(d, toStoredMessage(r.analysis), toReviewChunks(r.analysis));
      if (!t) await d.delete("queue", item.id); // texte : supprimé après analyse (audio : déjà fait)
      // L'original reste dans WhatsApp : la carte promet que le son est effacé, l'hôte doit l'y effacer.
      if (originalStaysInWhatsapp(item)) await addWhatsappToDelete(d, 1);
      host.set((s) => ({ ...s, recent: [r, ...s.recent].slice(0, 20), transcribed: ready.size }));
    } catch (e) {
      fail(item.id, e);
    }
    await refresh();
  }
  host.set((s) => ({ ...s, processing: null, processingLabel: null, transcribed: ready.size }));
}
