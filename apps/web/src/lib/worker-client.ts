// Client du Web Worker d'analyse : une file de requêtes, des événements de progression.
// Mémoire : sur un téléphone de 2 Go, Whisper + le modèle de similarité chargés ensemble (~1,55 Go dans le
// moteur de rendu, mesuré sur émulateur) font tuer la page. En mode « un modèle à la fois », chaque modèle vit
// dans son propre worker, terminé avant que l'autre soit chargé ; l'app transcrit d'abord toute la file, puis
// analyse (host-store.ts), ce qui ne fait qu'un changement de modèle par lot.
import type { KnownMessage, MessageAnalysis, MessageInput } from "@echo/core";
import { modelSourceFor } from "./platform.ts";
import type { InitInfo, ModelRole, Stage, Timings, WorkerEvent, WorkerRequest } from "../worker/protocol.ts";

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
}

export type MemoryPreference = "auto" | "low" | "normal";
export type MemoryMode = "one_model_at_a_time" | "both_models";
const MEMORY_KEY = "echo.memory";

/** Préférence de l'appareil (localStorage, confort par appareil) ; ?memory=low|normal|auto dans l'URL la fixe. */
export function memoryPreference(): MemoryPreference {
  try {
    const q = /[?&]memory=(low|normal|auto)\b/.exec(location.search + location.hash)?.[1] as MemoryPreference | undefined;
    if (q) localStorage.setItem(MEMORY_KEY, q);
    const v = localStorage.getItem(MEMORY_KEY);
    return v === "low" || v === "normal" ? v : "auto";
  } catch {
    return "auto";
  }
}

export function setMemoryPreference(p: MemoryPreference): void {
  try {
    localStorage.setItem(MEMORY_KEY, p);
  } catch {
    /* stockage indisponible : la préférence ne dure que pour cette page */
  }
}

/**
 * Un modèle à la fois si la préférence le demande, ou en automatique si l'appareil annonce 2 Go ou moins
 * (navigator.deviceMemory, arrondi par le navigateur : un téléphone de 3 Go annonce 2). Sans l'information
 * (Firefox, Safari), les deux modèles restent chargés.
 */
export function memoryModeFor(pref: MemoryPreference, deviceMemoryGb: number | undefined): MemoryMode {
  if (pref === "low") return "one_model_at_a_time";
  if (pref === "normal") return "both_models";
  return deviceMemoryGb !== undefined && deviceMemoryGb <= 2 ? "one_model_at_a_time" : "both_models";
}

export class AnalysisClient {
  private worker: Worker | null = null;
  /** Modèles chargés dans le worker courant. */
  private loaded = new Set<ModelRole>();
  private seq = 0;
  private pending = new Map<number, Pending>();
  private listeners = new Set<Listener>();
  /** Toutes les opérations passent l'une après l'autre (un changement de modèle ne coupe jamais une requête). */
  private chain: Promise<unknown> = Promise.resolve();
  progress: ProgressState = { stage: "idle", loaded: 0, total: 0 };
  info: InitInfo | null = null;
  readonly memory: MemoryMode;
  /** Nombre de workers terminés pour libérer un modèle (diagnostic, test e2e). */
  swaps = 0;
  /** Plus grand nombre de modèles chargés ensemble dans un worker depuis le début (diagnostic, test e2e). */
  peakModels = 0;
  private initPromise: Promise<InitInfo> | null = null;

  constructor(memory?: MemoryMode) {
    const dm = typeof navigator === "undefined" ? undefined : (navigator as { deviceMemory?: number }).deviceMemory;
    this.memory = memory ?? memoryModeFor(typeof location === "undefined" ? "auto" : memoryPreference(), dm);
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL("../worker/analysis.worker.ts", import.meta.url), { type: "module", name: "echo-analysis" });
    w.onmessage = (ev: MessageEvent<WorkerEvent>) => this.onEvent(ev.data);
    w.onerror = (ev) => this.setProgress({ ...this.progress, stage: "error", error: ev.message || "worker error" });
    this.worker = w;
    this.loaded.clear();
    return w;
  }

  private terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    this.loaded.clear();
    for (const p of this.pending.values()) p.reject(new Error("analysis worker stopped"));
    this.pending.clear();
    this.swaps++;
  }

  private onEvent(e: WorkerEvent): void {
    if (e.kind === "progress") {
      this.setProgress({ stage: e.stage, loaded: e.loaded, total: e.total, file: e.file });
      return;
    }
    const p = this.pending.get(e.reqId);
    if (!p) return;
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

  private request(req: DistributiveOmit<WorkerRequest, "reqId">, transfer: Transferable[] = []) {
    const reqId = ++this.seq;
    const w = this.ensureWorker();
    return new Promise<Extract<WorkerEvent, { kind: "result" }>>((resolve, reject) => {
      this.pending.set(reqId, { resolve, reject });
      w.postMessage({ ...req, reqId } as WorkerRequest, transfer);
    });
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  /**
   * Garantit que `role` est chargé dans le worker courant. En mode un modèle à la fois, termine d'abord le
   * worker s'il tient l'autre modèle (toute sa mémoire est rendue), puis charge `role` dans un nouveau worker.
   */
  private async ensure(role: ModelRole): Promise<void> {
    if (this.loaded.has(role)) return;
    if (this.memory === "one_model_at_a_time" && this.worker && this.loaded.size > 0) this.terminate();
    const load: ModelRole[] = this.memory === "both_models" ? (["nlp", "asr"] as const).filter((r) => !this.loaded.has(r)) : [role];
    const r = await this.request({ kind: "init", modelSource: modelSourceFor(), load });
    for (const l of load) this.loaded.add(l);
    this.peakModels = Math.max(this.peakModels, this.loaded.size);
    // Garde ce qui a été appris d'un worker précédent (ex. vérification des vecteurs pré-calculés).
    this.info = { ...this.info, ...r.info! };
  }

  /**
   * Télécharge (une fois) et charge les modèles. Idempotent. Les deux modèles, ou seulement le modèle de
   * similarité (texte, vérification du catalogue) en mode un modèle à la fois : Whisper vient à la demande.
   */
  init(): Promise<InitInfo> {
    if (!this.initPromise) {
      this.initPromise = this.serial(async () => {
        await this.ensure("nlp");
        return this.info!;
      });
      this.initPromise.catch((err: Error) => {
        this.initPromise = null;
        this.setProgress({ ...this.progress, stage: "error", error: err.message });
      });
    }
    return this.initPromise;
  }

  /**
   * Étape 1 d'un message vocal (Whisper seul). Le tampon est transféré au worker (plus accessible ici) puis
   * remis à zéro là-bas dès la fin de la transcription. Renvoie l'entrée à passer à analyzeInput.
   */
  async transcribeAudio(id: string, receivedAt: string, audio: Float32Array): Promise<{ input: MessageInput; timings: Timings }> {
    // Un modèle à la fois : inutile de charger le modèle de similarité pour le libérer aussitôt.
    if (this.memory === "both_models") await this.init();
    return this.serial(async () => {
      await this.ensure("asr");
      const r = await this.request({ kind: "transcribeAudio", id, receivedAt, audio }, [audio.buffer]);
      return { input: r.input!, timings: r.timings! };
    });
  }

  /** Étape 2 (modèle de similarité seul). */
  async analyzeInput(input: MessageInput, knownMessages: KnownMessage[]): Promise<{ analysis: MessageAnalysis; timings: Timings }> {
    await this.init();
    return this.serial(async () => {
      await this.ensure("nlp");
      const r = await this.request({ kind: "analyzeInput", input, knownMessages });
      return { analysis: r.analysis!, timings: r.timings! };
    });
  }

  /** Message vocal en une fois (démo) : transcription puis analyse ; `onTranscribed` dès que l'audio est effacé. */
  async analyzeAudio(
    id: string,
    receivedAt: string,
    audio: Float32Array,
    knownMessages: KnownMessage[],
    onTranscribed?: () => void,
  ): Promise<{ analysis: MessageAnalysis; timings: Timings }> {
    const t = await this.transcribeAudio(id, receivedAt, audio);
    onTranscribed?.();
    const a = await this.analyzeInput(t.input, knownMessages);
    const transcribeMs = t.timings.transcribeMs ?? 0;
    return { analysis: a.analysis, timings: { transcribeMs, analyzeMs: a.timings.analyzeMs, totalMs: t.timings.totalMs + a.timings.totalMs } };
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    await this.init();
    return this.serial(async () => {
      await this.ensure("nlp");
      return (await this.request({ kind: "embed", texts })).vectors!;
    });
  }

  async analyzeText(id: string, receivedAt: string, text: string, knownMessages: KnownMessage[]): Promise<{ analysis: MessageAnalysis; timings: Timings }> {
    await this.init();
    return this.serial(async () => {
      await this.ensure("nlp");
      const r = await this.request({ kind: "analyzeText", id, receivedAt, text, knownMessages });
      return { analysis: r.analysis!, timings: r.timings! };
    });
  }
}

export const analysis = new AnalysisClient();
// Accès de diagnostic pour le test e2e (aucune donnée ne sort du navigateur).
(globalThis as unknown as { __echoAnalysis?: AnalysisClient }).__echoAnalysis = analysis;
