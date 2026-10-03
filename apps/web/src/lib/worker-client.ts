// Client du Web Worker d'analyse : une file de requêtes, des événements de progression.
import type { KnownMessage, MessageAnalysis } from "@echo/core";
import type { InitInfo, Stage, Timings, WorkerEvent, WorkerRequest } from "../worker/protocol.ts";

export interface ProgressState {
  stage: Stage | "idle" | "error";
  loaded: number;
  total: number;
  file?: string;
  error?: string;
}

type Listener = (p: ProgressState) => void;
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

interface Pending {
  resolve: (e: Extract<WorkerEvent, { kind: "result" }>) => void;
  reject: (err: Error) => void;
  onTranscribed?: () => void;
}

export class AnalysisClient {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private listeners = new Set<Listener>();
  progress: ProgressState = { stage: "idle", loaded: 0, total: 0 };
  info: InitInfo | null = null;
  private initPromise: Promise<InitInfo> | null = null;

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL("../worker/analysis.worker.ts", import.meta.url), { type: "module", name: "echo-analysis" });
    w.onmessage = (ev: MessageEvent<WorkerEvent>) => this.onEvent(ev.data);
    w.onerror = (ev) => this.setProgress({ ...this.progress, stage: "error", error: ev.message || "worker error" });
    this.worker = w;
    return w;
  }

  private onEvent(e: WorkerEvent): void {
    if (e.kind === "progress") {
      this.setProgress({ stage: e.stage, loaded: e.loaded, total: e.total, file: e.file });
      return;
    }
    const p = this.pending.get(e.reqId);
    if (!p) return;
    if (e.kind === "transcribed") {
      p.onTranscribed?.();
      return;
    }
    this.pending.delete(e.reqId);
    if (e.kind === "error") p.reject(new Error(e.message));
    else p.resolve(e);
  }

  private setProgress(p: ProgressState): void {
    this.progress = p;
    for (const l of this.listeners) l(p);
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    l(this.progress);
    return () => this.listeners.delete(l);
  }

  private request(req: DistributiveOmit<WorkerRequest, "reqId">, transfer: Transferable[] = [], onTranscribed?: () => void) {
    const reqId = ++this.seq;
    const w = this.ensureWorker();
    return new Promise<Extract<WorkerEvent, { kind: "result" }>>((resolve, reject) => {
      this.pending.set(reqId, { resolve, reject, onTranscribed });
      w.postMessage({ ...req, reqId } as WorkerRequest, transfer);
    });
  }

  /** Télécharge (une fois) et charge les modèles. Idempotent. */
  init(): Promise<InitInfo> {
    if (!this.initPromise) {
      this.initPromise = this.request({ kind: "init" }).then((r) => {
        this.info = r.info!;
        return r.info!;
      });
      this.initPromise.catch((err: Error) => {
        this.initPromise = null;
        this.setProgress({ ...this.progress, stage: "error", error: err.message });
      });
    }
    return this.initPromise;
  }

  /** Analyse un audio mono 16 kHz. Le tampon est transféré au worker (plus accessible ici) puis effacé là-bas. */
  async analyzeAudio(
    id: string,
    receivedAt: string,
    audio: Float32Array,
    knownMessages: KnownMessage[],
    onTranscribed?: () => void,
  ): Promise<{ analysis: MessageAnalysis; timings: Timings }> {
    await this.init();
    const r = await this.request({ kind: "analyzeAudio", id, receivedAt, audio, knownMessages }, [audio.buffer], onTranscribed);
    return { analysis: r.analysis!, timings: r.timings! };
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    await this.init();
    return (await this.request({ kind: "embed", texts })).vectors!;
  }

  async analyzeText(id: string, receivedAt: string, text: string, knownMessages: KnownMessage[]): Promise<{ analysis: MessageAnalysis; timings: Timings }> {
    await this.init();
    const r = await this.request({ kind: "analyzeText", id, receivedAt, text, knownMessages });
    return { analysis: r.analysis!, timings: r.timings! };
  }
}

export const analysis = new AnalysisClient();
// Accès de diagnostic pour le test e2e (aucune donnée ne sort du navigateur).
(globalThis as unknown as { __echoAnalysis?: AnalysisClient }).__echoAnalysis = analysis;
