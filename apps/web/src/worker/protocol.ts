// Messages échangés entre l'interface et le Web Worker d'analyse (le fil principal reste libre).
import type { KnownMessage, MessageAnalysis } from "@echo/core";

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

export type Stage = "download" | "load-asr" | "load-embedder" | "prepare-catalog" | "ready";

export interface InitInfo {
  asrModel: string;
  embeddingModel: string;
  /** Embeddings des exemples : pré-calculés au build et vérifiés ici, ou recalculés sur l'appareil. */
  examples: { count: number; source: "precomputed" | "computed_on_device"; check?: number };
  backend: { threads: number; crossOriginIsolated: boolean };
  loadMs: number;
}

export interface Timings {
  decodeMs?: number;
  transcribeMs?: number;
  analyzeMs: number;
  totalMs: number;
}

export type WorkerRequest =
  | { kind: "init"; reqId: number }
  | { kind: "analyzeAudio"; reqId: number; id: string; receivedAt: string; audio: Float32Array; knownMessages: KnownMessage[] }
  | { kind: "analyzeText"; reqId: number; id: string; receivedAt: string; text: string; knownMessages: KnownMessage[] }
  | { kind: "embed"; reqId: number; texts: string[] };

export type WorkerEvent =
  | { kind: "progress"; stage: Stage; loaded: number; total: number; file?: string }
  | { kind: "transcribed"; reqId: number; id: string }
  | { kind: "result"; reqId: number; analysis?: MessageAnalysis; info?: InitInfo; timings?: Timings; vectors?: Float32Array[] }
  | { kind: "error"; reqId: number; message: string };
