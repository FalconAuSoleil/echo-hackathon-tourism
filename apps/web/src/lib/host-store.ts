// État de l'app hôte : base IndexedDB, file d'attente, traitement hors ligne dans le worker.
import { toReviewChunks, toStoredMessage, type MessageAnalysis, type ReviewChunk, type StoredMessage } from "@echo/core";
import { createStore } from "../ui/common.tsx";
import { decodeTo16kMono } from "./audio.ts";
import { enqueue, getSettings, knownMessages, newId, openEchoDB, pruneExpiredEmbeddings, saveAnalysis, saveSettings, type EchoDatabase, type QueueItem, type Settings } from "./db.ts";
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

/** Traite toute la file, un message après l'autre, hors ligne. */
export async function processQueue(): Promise<void> {
  if (host.get().processing) return;
  const d = await db();
  await pruneExpiredEmbeddings(d);
  const items = (await d.getAll("queue")).sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  for (const item of items) {
    host.set((s) => ({ ...s, processing: item.id }));
    try {
      const known = await knownMessages(d);
      const id = newId("m");
      let r: { analysis: MessageAnalysis; timings: Timings };
      if (item.kind === "audio" && item.blob) {
        const t0 = performance.now();
        const audio = await decodeTo16kMono(await item.blob.arrayBuffer());
        const decodeMs = Math.round(performance.now() - t0);
        // L'audio est supprimé de la file dès la fin de la transcription (avant même la fin de l'analyse).
        r = await analysis.analyzeAudio(id, item.receivedAt, audio, known, () => void d.delete("queue", item.id));
        r.timings.decodeMs = decodeMs;
      } else {
        r = await analysis.analyzeText(id, item.receivedAt, item.text ?? "", known);
      }
      await saveAnalysis(d, toStoredMessage(r.analysis), toReviewChunks(r.analysis));
      await d.delete("queue", item.id); // texte : supprimé après analyse (audio : déjà fait)
      host.set((s) => ({ ...s, recent: [r, ...s.recent].slice(0, 20) }));
    } catch (e) {
      host.set((s) => ({ ...s, errors: { ...s.errors, [item.id]: e instanceof Error ? e.message : String(e) } }));
    }
    await refresh();
  }
  host.set((s) => ({ ...s, processing: null }));
}
