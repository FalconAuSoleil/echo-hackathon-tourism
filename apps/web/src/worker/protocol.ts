// Messages échangés entre l'interface et le Web Worker d'analyse (le fil principal reste libre).
import type { KnownMessage, MessageAnalysis, MessageInput } from "@echo/core";

export interface AssetsManifest {
  builtAt: string;
  asrModel: { id: string; license: string; source: string };
  embeddingModel: { id: string; license: string; source: string };
  modelFiles: { url: string; bytes: number; model: string }[];
  ortFiles: { url: string; bytes: number }[];
  precomputed: { file: string; meta: string } | null;
  catalog: { version: string; findings: number };
  keywords: string[];
  thresholds: {
    source: string;
    calibratedAt: string;
    scoring: string;
    acceptProbability: number;
    acceptThreshold: number;
    offListThreshold: number;
    calibratedEmbeddingModel: string;
  };
}

/** "bundled" : modèles dans les assets de l'APK (lus sur place) ; "download" : PWA, copiés une fois dans Cache Storage. */
export type ModelSource = "bundled" | "download";

/**
 * Les deux modèles : Whisper ("asr") et le modèle de similarité + catalogue ("nlp"). Sur un téléphone à peu de
 * mémoire, le client n'en garde qu'un à la fois (un worker par modèle, terminé avant de charger l'autre).
 */
export type ModelRole = "asr" | "nlp";

export type Stage = "download" | "load-asr" | "load-embedder" | "prepare-catalog" | "ready";

export interface InitInfo {
  asrModel: string;
  embeddingModel: string;
  /** Embeddings des exemples : pré-calculés au build et vérifiés ici, ou recalculés sur l'appareil (absent tant que le modèle de similarité n'est pas chargé). */
  examples?: { count: number; source: "precomputed" | "computed_on_device"; check?: number };
  backend: { threads: number; crossOriginIsolated: boolean };
  /** Où les modèles sont lus : assets de l'APK (aucune copie) ou Cache Storage du navigateur. */
  modelStorage: "apk-assets" | "browser-cache";
  loadMs: number;
}

export interface Timings {
  decodeMs?: number;
  transcribeMs?: number;
  /** Traduction anglaise des segments à relire (Whisper), après l'analyse. */
  translateMs?: number;
  analyzeMs: number;
  totalMs: number;
}

export type WorkerRequest =
  | { kind: "init"; reqId: number; modelSource: ModelSource; load: ModelRole[] }
  /** Étape 1 d'un message vocal : Whisper seul ; l'audio est remis à zéro dans le worker. */
  | { kind: "transcribeAudio"; reqId: number; id: string; receivedAt: string; audio: Float32Array }
  /** Étape 2 : modèle de similarité seul, sur l'entrée produite par transcribeAudio. */
  | { kind: "analyzeInput"; reqId: number; input: MessageInput; knownMessages: KnownMessage[] }
  | { kind: "analyzeText"; reqId: number; id: string; receivedAt: string; text: string; knownMessages: KnownMessage[] }
  | { kind: "embed"; reqId: number; texts: string[] }
  /**
   * Étape 3 : Whisper traduit les seuls segments à relire (aucun morceau compté), chacun seul ; l'audio (copie
   * gardée en mémoire depuis l'étape 1, jamais stockée) est remis à zéro dans le worker.
   */
  | { kind: "translateSegments"; reqId: number; audio: Float32Array; segments: { start: number; end: number }[]; language: string };

export type WorkerEvent =
  | { kind: "progress"; stage: Stage; loaded: number; total: number; file?: string }
  | { kind: "result"; reqId: number; analysis?: MessageAnalysis; input?: MessageInput; info?: InitInfo; timings?: Timings; vectors?: Float32Array[]; english?: string[] }
  | { kind: "error"; reqId: number; message: string };
