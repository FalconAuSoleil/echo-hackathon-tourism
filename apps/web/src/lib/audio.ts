// Audio côté interface : décodage en mono 16 kHz (AudioContext n'existe pas dans un worker),
// enregistrement de 30 s maximum, et lecture du récap en enchaînant les clips du catalogue.

export const SAMPLE_RATE = 16000;

/** Décode un fichier audio (wav, ogg/opus WhatsApp, m4a, webm…) en Float32 mono 16 kHz, dans un tampon propre. */
export async function decodeTo16kMono(data: ArrayBuffer): Promise<Float32Array> {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(data.slice(0));
  } finally {
    void ctx.close();
  }
  const length = Math.max(1, Math.ceil(decoded.duration * SAMPLE_RATE));
  const off = new OfflineAudioContext(1, length, SAMPLE_RATE);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination); // le mixage vers 1 canal fait la moyenne des canaux
  src.start();
  const rendered = await off.startRendering();
  return new Float32Array(rendered.getChannelData(0)); // copie : tampon transférable entier
}

export interface Recording {
  stop(): void;
  done: Promise<Blob>;
}

/** Enregistre le micro, 30 s au plus (SPEC 8). `onTick` reçoit les secondes écoulées. */
export async function startRecording(maxSec: number, onTick: (sec: number) => void): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const rec = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const t0 = performance.now();
  const timer = setInterval(() => {
    const s = (performance.now() - t0) / 1000;
    onTick(Math.min(maxSec, s));
    if (s >= maxSec && rec.state === "recording") rec.stop();
  }, 200);
  const done = new Promise<Blob>((resolve) => {
    rec.onstop = () => {
      clearInterval(timer);
      stream.getTracks().forEach((t) => t.stop());
      resolve(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
    };
  });
  rec.start(250);
  return { stop: () => rec.state === "recording" && rec.stop(), done };
}

let current: { ctx: AudioContext; src: AudioBufferSourceNode } | null = null;

export function stopPlayback(): void {
  if (current) {
    try {
      current.src.stop();
    } catch {
      /* déjà arrêté */
    }
    void current.ctx.close();
    current = null;
  }
}

/**
 * Lit une suite de clips pré-générés en un seul tampon (aucune synthèse à l'exécution).
 * `groups` = une liste de clips par ligne ; un court silence sépare les lignes.
 */
export async function playClips(groups: string[][], base = "/catalog/", onEnd?: () => void): Promise<number> {
  stopPlayback();
  const ctx = new AudioContext();
  const decodeOne = async (path: string): Promise<AudioBuffer> => {
    const res = await fetch(base + path);
    if (!res.ok) throw new Error(`missing clip ${path}`);
    return ctx.decodeAudioData(await res.arrayBuffer());
  };
  const decoded = await Promise.all(groups.map((g) => Promise.all(g.map(decodeOne))));
  const rate = ctx.sampleRate;
  const gapLine = Math.round(rate * 0.45);
  const gapClip = Math.round(rate * 0.06);
  let length = 0;
  decoded.forEach((g, i) => {
    g.forEach((b, j) => (length += b.length + (j < g.length - 1 ? gapClip : 0)));
    if (i < decoded.length - 1) length += gapLine;
  });
  const out = ctx.createBuffer(1, Math.max(1, length), rate);
  const data = out.getChannelData(0);
  let pos = 0;
  decoded.forEach((g, i) => {
    g.forEach((b, j) => {
      data.set(b.getChannelData(0), pos);
      pos += b.length + (j < g.length - 1 ? gapClip : 0);
    });
    pos += i < decoded.length - 1 ? gapLine : 0;
  });
  const src = ctx.createBufferSource();
  src.buffer = out;
  src.connect(ctx.destination);
  src.onended = () => {
    if (current?.src === src) stopPlayback();
    onEnd?.();
  };
  current = { ctx, src };
  src.start();
  return out.duration;
}
