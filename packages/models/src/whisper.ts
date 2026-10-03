// Adaptateur Transcriber (port de @echo/core) au-dessus de transformers.js.
// transformers.js ne détecte pas la langue (il force l'anglais) : on la détecte nous-mêmes avec une passe
// du décodeur sur <|startoftranscript|>, puis on transcrit dans cette langue. La confiance est
// exp(moyenne des log-probas des tokens choisis), mesurée par un LogitsProcessor enregistreur.
import {
  AutoProcessor,
  AutoTokenizer,
  LogitsProcessor,
  Tensor,
  WhisperForConditionalGeneration,
  type PreTrainedTokenizer,
  type Processor,
} from "@huggingface/transformers";
import type { Transcriber, TranscribeOptions, Transcript } from "@echo/core";

const SAMPLE_RATE = 16000;
const WINDOW_SAMPLES = 30 * SAMPLE_RATE;

export interface WhisperOptions {
  device?: "cpu" | "wasm" | "webgpu";
  /** Limite le choix de langue à ces codes (ex. ["en","fr","de","es","sw"]). Sinon toutes les langues Whisper. */
  candidateLanguages?: string[];
  maxNewTokens?: number;
  /**
   * Arrête le décodage quand Whisper boucle (même bloc de tokens répété 3 fois de suite, ou même token
   * 6 fois) et garde une seule occurrence du bloc. Défaut : true. Sans ce garde-fou, le décodage glouton
   * remplit max_new_tokens de répétitions (WER > 100 % mesuré sur FLEURS), et c'est plus lent.
   */
  stopRepetitionLoops?: boolean;
}

interface GenerationConfigLike {
  decoder_start_token_id: number;
  eos_token_id: number | number[];
  lang_to_id: Record<string, number>;
}

/** Enregistre la log-proba du token réellement choisi à chaque pas (lue au pas suivant). */
class LogProbRecorder extends LogitsProcessor {
  logprobs: number[] = [];
  private prev: Float32Array | null = null;
  private prevLen = 0;

  reset(): void {
    this.logprobs = [];
    this.prev = null;
    this.prevLen = 0;
  }

  override _call(input_ids: bigint[][], logits: Tensor): Tensor {
    const ids = input_ids[0] ?? [];
    if (this.prev && ids.length > this.prevLen) {
      const chosen = Number(ids[this.prevLen]);
      const v = this.prev[chosen];
      if (v !== undefined && Number.isFinite(v)) this.logprobs.push(v);
    }
    // logits : [batch, vocab] après les processeurs précédents
    const row = (logits.dims.length === 2 ? (logits.data as Float32Array).subarray(0, logits.dims[1]) : (logits.data as Float32Array));
    this.prev = logSoftmax(row);
    this.prevLen = ids.length;
    return logits;
  }
}

/**
 * Repère une boucle de répétition à la fin des tokens générés : renvoie la longueur à garder
 * (une seule occurrence du bloc répété), ou -1. Exporté pour les tests.
 */
export function repetitionLoopCut(generated: readonly number[], maxPeriod = 32): number {
  const n = generated.length;
  for (let p = 1; p <= maxPeriod; p++) {
    const reps = p === 1 ? 6 : 3;
    if (n < p * reps) break;
    let loop = true;
    for (let k = 1; k < reps && loop; k++) {
      for (let i = 0; i < p; i++) {
        if (generated[n - 1 - i] !== generated[n - 1 - i - k * p]) {
          loop = false;
          break;
        }
      }
    }
    if (loop) return n - (reps - 1) * p;
  }
  return -1;
}

/** Force la fin du décodage quand une boucle de répétition est détectée (voir stopRepetitionLoops). */
class RepetitionLoopStopper extends LogitsProcessor {
  promptLen = -1;
  keep = -1;
  constructor(private eosId: number) {
    super();
  }
  override _call(input_ids: bigint[][], logits: Tensor): Tensor {
    const ids = input_ids[0] ?? [];
    if (this.promptLen < 0) this.promptLen = ids.length;
    if (this.keep < 0) {
      const cut = repetitionLoopCut(ids.slice(this.promptLen).map(Number));
      if (cut >= 0) this.keep = cut;
    }
    if (this.keep >= 0) {
      const data = logits.data as Float32Array;
      const vocab = logits.dims.at(-1) as number;
      for (let i = 0; i < vocab; i++) data[i] = i === this.eosId ? 0 : -Infinity;
    }
    return logits;
  }
}

function logSoftmax(x: Float32Array): Float32Array {
  let max = -Infinity;
  for (const v of x) if (v > max) max = v;
  let sum = 0;
  for (const v of x) sum += Math.exp(v - max);
  const lse = max + Math.log(sum);
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = (x[i] ?? 0) - lse;
  return out;
}

export interface WhisperTranscriber extends Transcriber {
  detectLanguage(audio16k: Float32Array): Promise<{ language: string; probability: number }>;
}

export async function createWhisperTranscriber(modelId: string, options: WhisperOptions = {}): Promise<WhisperTranscriber> {
  const processor: Processor = await AutoProcessor.from_pretrained(modelId);
  const tokenizer: PreTrainedTokenizer = await AutoTokenizer.from_pretrained(modelId);
  const model = await WhisperForConditionalGeneration.from_pretrained(modelId, {
    dtype: { encoder_model: "q8", decoder_model_merged: "q8" },
    ...(options.device ? { device: options.device } : {}),
  });
  const gen = model.generation_config as unknown as GenerationConfigLike;
  const langTokens = Object.entries(gen.lang_to_id)
    .map(([tok, id]) => ({ code: tok.slice(2, -2), id }))
    .filter((l) => !options.candidateLanguages || options.candidateLanguages.includes(l.code));
  const maxNewTokens = options.maxNewTokens ?? 220;
  const stopLoops = options.stopRepetitionLoops ?? true;
  const eosId = Array.isArray(gen.eos_token_id) ? gen.eos_token_id[0]! : gen.eos_token_id;

  async function features(audio: Float32Array): Promise<Tensor> {
    const out = (await processor(audio)) as { input_features: Tensor };
    return out.input_features;
  }

  async function detect(input_features: Tensor): Promise<{ language: string; probability: number }> {
    const decoder_input_ids = new Tensor("int64", BigInt64Array.from([BigInt(gen.decoder_start_token_id)]), [1, 1]);
    const out = (await model({ input_features, decoder_input_ids })) as { logits: Tensor };
    const vocab = out.logits.dims.at(-1) as number;
    const logits = (out.logits.data as Float32Array).subarray(0, vocab);
    let max = -Infinity;
    for (const l of langTokens) max = Math.max(max, logits[l.id] ?? -Infinity);
    let sum = 0;
    let best = langTokens[0]!;
    let bestV = -Infinity;
    for (const l of langTokens) {
      const v = logits[l.id] ?? -Infinity;
      sum += Math.exp(v - max);
      if (v > bestV) { bestV = v; best = l; }
    }
    return { language: best.code, probability: Math.exp(bestV - max) / sum };
  }

  async function decode(input_features: Tensor, language: string, task: "transcribe" | "translate") {
    const recorder = new LogProbRecorder();
    const stopper = stopLoops ? new RepetitionLoopStopper(eosId) : null;
    const ids = (await model.generate({
      inputs: input_features,
      language,
      task,
      max_new_tokens: maxNewTokens,
      logits_processor: stopper ? [stopper, recorder] : [recorder],
    } as Record<string, unknown>)) as Tensor;
    if (stopper && stopper.keep >= 0) {
      // Boucle : on ne garde que la première occurrence du bloc répété (et les log-probas correspondantes).
      const all = Array.from(ids.data as BigInt64Array, Number);
      const kept = all.slice(0, stopper.promptLen + stopper.keep);
      const text = tokenizer.decode(kept, { skip_special_tokens: true });
      return { text: text.trim(), logprobs: recorder.logprobs.slice(0, stopper.keep) };
    }
    const text = tokenizer.batch_decode(ids, { skip_special_tokens: true })[0] ?? "";
    return { text: text.trim(), logprobs: recorder.logprobs };
  }

  return {
    async detectLanguage(audio16k) {
      return detect(await features(audio16k.subarray(0, WINDOW_SAMPLES)));
    },
    async transcribe(audio16k: Float32Array, opts: TranscribeOptions = {}): Promise<Transcript> {
      const durationSec = audio16k.length / SAMPLE_RATE;
      const windows: Float32Array[] = [];
      for (let i = 0; i < Math.max(audio16k.length, 1); i += WINDOW_SAMPLES) windows.push(audio16k.subarray(i, i + WINDOW_SAMPLES));
      const firstFeatures = await features(windows[0]!);
      const lang = opts.language ? { language: opts.language, probability: 1 } : await detect(firstFeatures);
      const texts: string[] = [];
      const translations: string[] = [];
      const logprobs: number[] = [];
      for (let w = 0; w < windows.length; w++) {
        const f = w === 0 ? firstFeatures : await features(windows[w]!);
        const r = await decode(f, lang.language, "transcribe");
        texts.push(r.text);
        logprobs.push(...r.logprobs);
        if (opts.withEnglishTranslation && lang.language !== "en") translations.push((await decode(f, lang.language, "translate")).text);
      }
      const mean = logprobs.length ? logprobs.reduce((a, b) => a + b, 0) / logprobs.length : -Infinity;
      const text = texts.join(" ").trim();
      return {
        text,
        language: lang.language,
        languageProbability: lang.probability,
        confidence: Number.isFinite(mean) ? Math.exp(mean) : 0,
        durationSec,
        ...(opts.withEnglishTranslation ? { englishTranslation: lang.language === "en" ? text : translations.join(" ").trim() } : {}),
      };
    },
  };
}
