import { useEffect, useState } from "preact/hooks";
import { modelSourceFor } from "../lib/platform.ts";
import { analysis } from "../lib/worker-client.ts";
import type { AssetsManifest, InitInfo } from "../worker/protocol.ts";
import { Progress, mb, useModelProgress } from "./common.tsx";

const STAGE_LABEL: Record<string, string> = {
  idle: "Models not loaded yet",
  download: "Downloading models once (kept on this device)",
  "load-asr": "Loading Whisper (speech recognition)",
  "load-embedder": "Loading the sentence-similarity model",
  "prepare-catalog": "Preparing the findings catalog",
  ready: "Ready: works offline",
  error: "Error",
};

/** Démarre le chargement sauf si l'utilisateur a demandé d'économiser les données (on attend alors un clic). */
export function shouldAutoStart(): boolean {
  const c = (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return !(c?.saveData || c?.effectiveType === "slow-2g" || c?.effectiveType === "2g");
}

export function ModelBox({ manifest, compact = false }: { manifest: AssetsManifest; compact?: boolean }) {
  const p = useModelProgress();
  const [info, setInfo] = useState<InitInfo | null>(analysis.info);
  useEffect(() => {
    if (p.stage === "ready" && !info) analysis.init().then(setInfo).catch(() => undefined);
  }, [p.stage]);
  const files = manifest.modelFiles;
  const size = (id: string) => files.filter((f) => f.model === id).reduce((s, f) => s + f.bytes, 0);
  const asr = size(manifest.asrModel.id);
  const emb = size(manifest.embeddingModel.id);
  const ort = manifest.ortFiles.reduce((s, f) => s + f.bytes, 0);
  // APK : modèles inclus dans l'application, lus sur place (rien à télécharger ni à copier).
  const bundled = modelSourceFor() === "bundled";
  const busy = p.stage !== "idle" && p.stage !== "ready" && p.stage !== "error";
  return (
    <section class="card" data-testid="model-box">
      <h2>Everything runs on this device</h2>
      <p class="muted">
        No server analyses anything and there is no account.{" "}
        {bundled
          ? "The models are part of the app and are read in place (not copied), so it works in airplane mode from the start."
          : "After the first load the app, the models and the catalog are stored in this browser, so it keeps working in airplane mode."}
      </p>
      {!compact && (
        <table>
          <tbody>
            <tr>
              <td>Speech recognition</td>
              <td>
                <code>{manifest.asrModel.id.split("/")[1]}</code> int8
              </td>
              <td>{mb(asr)}</td>
            </tr>
            <tr>
              <td>Sentence similarity</td>
              <td>
                <code>{manifest.embeddingModel.id.split("/")[1]}</code> int8
              </td>
              <td>{mb(emb)}</td>
            </tr>
            <tr>
              <td>Runtime (onnxruntime-web, WASM)</td>
              <td />
              <td>{mb(ort)}</td>
            </tr>
            <tr>
              <th>{bundled ? "Total, bundled in the app (no download)" : "Total download, once"}</th>
              <th />
              <th>{mb(asr + emb + ort)}</th>
            </tr>
          </tbody>
        </table>
      )}
      <p style={{ marginTop: "0.6rem" }}>
        <strong data-testid="model-stage">{STAGE_LABEL[p.stage] ?? p.stage}</strong>
        {p.stage === "download" && p.total > 0 && (
          <span class="muted">
            {" "}
            {mb(p.loaded)} / {mb(p.total)}
          </span>
        )}
      </p>
      {busy && <Progress value={p.stage === "download" ? p.loaded : ["load-asr", "load-embedder", "prepare-catalog"].indexOf(p.stage) + 1} max={p.stage === "download" ? p.total : 3} />}
      {p.stage === "error" && <p class="error">{p.error}</p>}
      {(p.stage === "idle" || p.stage === "error") && (
        <button onClick={() => void analysis.init()} data-testid="load-models">
          {p.stage === "error" ? "Retry" : bundled ? "Load the models bundled in the app" : `Download models (${mb(asr + emb + ort)}) and prepare offline use`}
        </button>
      )}
      {info && !compact && (
        <p class="muted" style={{ fontSize: "0.82rem" }}>
          Loaded in {(info.loadMs / 1000).toFixed(1)} s{info.modelStorage === "apk-assets" ? " from the app's own files (not copied)" : ""}, {info.backend.threads} thread{info.backend.threads > 1 ? "s" : ""}. Catalog examples:{" "}
          {info.examples ? (
            <>
              {info.examples.count},{" "}
              {info.examples.source === "precomputed" ? `embeddings precomputed at build time with the same model and checked on this device (cosine ${info.examples.check})` : "embedded on this device"}.
            </>
          ) : (
            "not loaded yet."
          )}{" "}
          Memory:{" "}
          <span data-testid="memory-mode">
            {analysis.memory === "one_model_at_a_time"
              ? "one model at a time (low-memory phone: Whisper and the similarity model are never loaded together)"
              : "both models kept loaded"}
          </span>
          .
          Decision threshold:{" "}
          {manifest.thresholds.scoring === "linear"
            ? `classifier probability ≥ ${manifest.thresholds.acceptProbability}`
            : `similarity ≥ ${manifest.thresholds.acceptThreshold}`}
          , from{" "}
          {manifest.thresholds.source.startsWith("default") ? "default values (no evaluation found)" : `the evaluation (${manifest.thresholds.calibratedAt}, synthetic data)`}.
        </p>
      )}
    </section>
  );
}
