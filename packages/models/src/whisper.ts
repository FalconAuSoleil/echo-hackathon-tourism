// Adaptateur Transcriber (port de @echo/core) au-dessus de transformers.js.
// transformers.js ne détecte pas la langue (il force l'anglais) : on la détecte nous-mêmes avec une passe
// du décodeur sur <|startoftranscript|>, puis on transcrit dans cette langue. La confiance est
// exp(moyenne des log-probas des tokens choisis), mesurée par un LogitsProcessor enregistreur.
// L'encodeur tourne une fois par fenêtre de 30 s : sa sortie est partagée par la détection de langue, la
// transcription et les passes de la traduction (résultats identiques, vérifié sur 20 énoncés FLEURS).
import {
  AutoProcessor,
  AutoTokenizer,
  LogitsProcessor,
  Tensor,
  WhisperForConditionalGeneration,
  type PreTrainedTokenizer,
  type Processor,
} from "@huggingface/transformers";
import type { Transcriber, TranscribeOptions, Transcript, TranscriptSegment } from "@echo/core";

const SAMPLE_RATE = 16000;
const WINDOW_SAMPLES = 30 * SAMPLE_RATE;

export interface WhisperOptions {
  device?: "cpu" | "wasm" | "webgpu";
  /** Limite le choix de langue à ces codes (ex. ["en","fr","de","es","sw"]). Sinon toutes les langues Whisper. */
  candidateLanguages?: string[];
  maxNewTokens?: number;
  /** Nombre de threads du backend natif (Node). Défaut : celui d'onnxruntime (tous les cœurs). */
  threads?: number;
  /**
   * Arrête le décodage quand Whisper boucle (même bloc de tokens répété 3 fois de suite, ou même token
   * 6 fois) et garde une seule occurrence du bloc. Défaut : true. Sans ce garde-fou, le décodage glouton
   * remplit max_new_tokens de répétitions (WER > 100 % mesuré sur FLEURS), et c'est plus lent.
   */
  stopRepetitionLoops?: boolean;
  /** Marge autour d'un segment quand on le découpe pour le traduire (`translateSegments`, secondes). Défaut : 0,2. */
  segmentPaddingSec?: number;
}

interface GenerationConfigLike {
  decoder_start_token_id: number;
  eos_token_id: number | number[];
  lang_to_id: Record<string, number>;
  no_timestamps_token_id: number;
}

/** Durée d'un pas d'horodatage Whisper (secondes). */
const TIME_PRECISION = 0.02;

/**
 * Découpe les tokens générés (sans le prompt) en segments [début, fin] : `<|t0|> texte <|t1|>`. Un segment non
 * fermé (fin de génération) s'arrête à `windowSec`. Les horodatages consécutifs `<|t1|><|t1|>` séparent deux
 * segments. Exporté pour les tests.
 */
export function splitTimestampSegments(
  generated: readonly number[],
  timestampBegin: number,
  windowSec: number,
): { start: number; end: number; tokens: number[] }[] {
  const out: { start: number; end: number; tokens: number[] }[] = [];
  let start: number | null = null;
  let tokens: number[] = [];
  for (const id of generated) {
    if (id >= timestampBegin) {
      const t = (id - timestampBegin) * TIME_PRECISION;
      if (start === null) start = t;
      else {
        if (tokens.length) out.push({ start, end: t, tokens });
        start = null;
        tokens = [];
      }
    } else {
      if (start === null) start = out.at(-1)?.end ?? 0;
      tokens.push(id);
    }
  }
  if (start !== null && tokens.length) out.push({ start, end: windowSec, tokens });
  return out;
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

const round2 = (x: number): number => Math.round(x * 100) / 100;


/**
 * Un segment très court (< 1 s ou < 3 mots, souvent la fin d'une phrase coupée) est rattaché au précédent : traduit
 * seul, il ne veut rien dire (« gepflegt. » → « also reflected. »). Exporté pour les tests.
 */
export function mergeShortSegments<T extends { start: number; end: number; text: string }>(segments: readonly T[]): T[] {
  const out: T[] = [];
  for (const sg of segments) {
    const prev = out.at(-1);
    const short = sg.end - sg.start < 1 || sg.text.split(/\s+/).filter(Boolean).length < 3;
    if (prev && short) out[out.length - 1] = { ...prev, end: sg.end, text: `${prev.text} ${sg.text}` };
    else out.push({ ...sg });
  }
  return out;
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
  translateSegments(audio16k: Float32Array, segments: readonly { start: number; end: number }[], language: string): Promise<string[]>;
}

export async function createWhisperTranscriber(modelId: string, options: WhisperOptions = {}): Promise<WhisperTranscriber> {
  const processor: Processor = await AutoProcessor.from_pretrained(modelId);
  const tokenizer: PreTrainedTokenizer = await AutoTokenizer.from_pretrained(modelId);
  const model = await WhisperForConditionalGeneration.from_pretrained(modelId, {
    dtype: { encoder_model: "q8", decoder_model_merged: "q8" },
    ...(options.device ? { device: options.device } : {}),
    ...(options.threads ? { session_options: { intraOpNumThreads: options.threads, interOpNumThreads: 1 } } : {}),
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

  /** Caractéristiques + sortie de l'encodeur d'une fenêtre, calculées une fois et partagées par toutes les passes. */
  interface Encoded {
    input_features: Tensor;
    encoder_outputs: Tensor;
  }
  const prepare = model as unknown as {
    _prepare_encoder_decoder_kwargs_for_generation(a: {
      inputs_tensor: Tensor;
      model_inputs: Record<string, unknown>;
      model_input_name: string;
      generation_config: unknown;
    }): Promise<{ encoder_outputs: Tensor }>;
  };
  async function encode(audio: Float32Array): Promise<Encoded> {
    const input_features = await features(audio);
    const { encoder_outputs } = await prepare._prepare_encoder_decoder_kwargs_for_generation({
      inputs_tensor: input_features,
      model_inputs: { input_features },
      model_input_name: "input_features",
      generation_config: model.generation_config,
    });
    return { input_features, encoder_outputs };
  }

  async function detect(e: Encoded): Promise<{ language: string; probability: number }> {
    const decoder_input_ids = new Tensor("int64", BigInt64Array.from([BigInt(gen.decoder_start_token_id)]), [1, 1]);
    const out = (await model({ ...e, decoder_input_ids })) as { logits: Tensor };
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

  const timestampBegin = gen.no_timestamps_token_id + 1;
  const padSec = options.segmentPaddingSec ?? 0.2;

  /**
   * Un passage du décodeur sur une fenêtre déjà encodée. Avec `timestamps`, renvoie aussi les segments horodatés
   * (relatifs à la fenêtre) ; le texte et les log-probas ne gardent que les tokens de texte.
   */
  async function decode(e: Encoded, language: string, task: "transcribe" | "translate", timestamps = false, windowSec = 30) {
    const recorder = new LogProbRecorder();
    const stopper = stopLoops ? new RepetitionLoopStopper(eosId) : null;
    const ids = (await model.generate({
      inputs: e.input_features,
      encoder_outputs: e.encoder_outputs,
      language,
      task,
      max_new_tokens: maxNewTokens,
      ...(timestamps ? { return_timestamps: true } : {}),
      logits_processor: stopper ? [stopper, recorder] : [recorder],
    } as Record<string, unknown>)) as Tensor;
    const all = Array.from(ids.data as BigInt64Array, Number);
    const promptLen = stopper && stopper.promptLen >= 0 ? stopper.promptLen : all.length - recorder.logprobs.length - 1;
    // Boucle : on ne garde que la première occurrence du bloc répété (et les log-probas correspondantes).
    const keep = stopper && stopper.keep >= 0 ? stopper.keep : all.length - promptLen;
    const generated = all.slice(promptLen, promptLen + keep);
    const logprobs = recorder.logprobs.slice(0, keep).filter((_, i) => (generated[i] ?? 0) < timestampBegin);
    const textIds = generated.filter((id) => id < timestampBegin);
    const text = tokenizer.decode(textIds, { skip_special_tokens: true }).trim();
    const segments = timestamps
      ? splitTimestampSegments(generated.filter((id) => id !== eosId), timestampBegin, windowSec)
          .map((sg) => ({ start: sg.start, end: sg.end, text: tokenizer.decode(sg.tokens, { skip_special_tokens: true }).trim() }))
          .filter((sg) => sg.text.length > 0)
      : [];
    return { text, logprobs, segments };
  }

  return {
    async detectLanguage(audio16k) {
      return detect(await encode(audio16k.subarray(0, WINDOW_SAMPLES)));
    },
    /**
     * Traduit chaque segment SEUL : découpé dans l'audio (avec une petite marge), encodé, traduit (task=translate).
     * Sa traduction ne contient que lui. Appelé après l'analyse, pour les seuls segments à relire, tant que l'audio
     * est en mémoire.
     */
    async translateSegments(audio16k, segs, language) {
      const out: string[] = [];
      for (const sg of segs) {
        const a = Math.max(0, Math.floor((sg.start - padSec) * SAMPLE_RATE));
        const b = Math.min(audio16k.length, Math.ceil((sg.end + padSec) * SAMPLE_RATE), a + WINDOW_SAMPLES);
        out.push(b > a ? (await decode(await encode(audio16k.subarray(a, b)), language, "translate")).text : "");
      }
      return out;
    },
    async transcribe(audio16k: Float32Array, opts: TranscribeOptions = {}): Promise<Transcript> {
      const durationSec = audio16k.length / SAMPLE_RATE;
      const windows: Float32Array[] = [];
      for (let i = 0; i < Math.max(audio16k.length, 1); i += WINDOW_SAMPLES) windows.push(audio16k.subarray(i, i + WINDOW_SAMPLES));
      const first = await encode(windows[0]!);
      const lang = opts.language ? { language: opts.language, probability: 1 } : await detect(first);
      const translate = !!opts.withEnglishTranslation && lang.language !== "en";
      const texts: string[] = [];
      const translations: string[] = [];
      const logprobs: number[] = [];
      const segments: TranscriptSegment[] = [];
      for (let w = 0; w < windows.length; w++) {
        const e = w === 0 ? first : await encode(windows[w]!);
        const offset = (w * WINDOW_SAMPLES) / SAMPLE_RATE;
        const windowSec = windows[w]!.length / SAMPLE_RATE;
        const r = await decode(e, lang.language, "transcribe");
        texts.push(r.text);
        logprobs.push(...r.logprobs);
        // (inutile en anglais : le texte d'un morceau à relire est déjà en anglais)
        if (opts.withSegments && lang.language !== "en") {
          // Passe horodatée à part, pour situer les morceaux seulement : le texte et la confiance viennent de la passe
          // sans horodatages (avec horodatages, le WER mesuré sur 20 énoncés FLEURS par langue passait de 26,9 à
          // 30,7 % en français et de 17,8 à 19,8 % en allemand). Un seul segment : la fenêtre entière.
          const src = mergeShortSegments((await decode(e, lang.language, "transcribe", true, windowSec)).segments);
          if (src.length <= 1) segments.push({ start: round2(offset), end: round2(offset + windowSec), text: r.text });
          else
            for (const sg of src)
              segments.push({
                start: round2(offset + Math.min(sg.start, windowSec)),
                end: round2(offset + Math.min(Math.max(sg.end, sg.start), windowSec)),
                text: sg.text,
              });
        }
        if (translate) translations.push((await decode(e, lang.language, "translate")).text);
      }
      const mean = logprobs.length ? logprobs.reduce((a, b) => a + b, 0) / logprobs.length : -Infinity;
      const text = texts.join(" ").trim();
      const englishTranslation = !opts.withEnglishTranslation ? undefined : lang.language === "en" ? text : translations.join(" ").trim();
      return {
        text,
        language: lang.language,
        languageProbability: lang.probability,
        confidence: Number.isFinite(mean) ? Math.exp(mean) : 0,
        durationSec,
        ...(segments.length ? { segments } : {}),
        ...(englishTranslation !== undefined ? { englishTranslation } : {}),
      };
    },
  };
}
