// Niveau 1 (SPEC 9) : WER/CER de Whisper sur de vraies voix humaines (FLEURS, split test, échantillon fixe).
// Langue détectée automatiquement, comme dans l'app (adaptateur @echo/models), toutes langues Whisper candidates.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readJsonl, readJsonIfExists, loadAudio16k, round, writeJson } from "./lib/io.ts";
import { loadavg } from "node:os";
import { FLEURS_DIR, RAW_DIR, RESULTS_DIR } from "./lib/paths.ts";
import { TranscriptCache, loadWhisper, whisperAvailable, type CachedTranscript } from "./lib/asr.ts";
import { errorCounts, rates, sumCounts } from "./lib/wer.ts";

interface FleursRow { key: string; lang: string; fleursId: number; file: string; durationSec: number; transcription: string; rawTranscription: string; gender: string }

export const LEVEL1_LANGS = ["en", "fr", "de", "es", "sw"];

export async function runLevel1(opts: { sizes: string[]; limit?: number; limits?: Record<string, number>; log: (s: string) => void }) {
  const previous = readJsonIfExists<{ models?: Record<string, Record<string, unknown>> }>(join(RESULTS_DIR, "level1.json"));
  const out: Record<string, unknown> = {};
  const perModel: Record<string, Record<string, unknown>> = { ...(previous?.models ?? {}) };
  for (const size of opts.sizes) {
    if (!whisperAvailable(size)) {
      opts.log(`[level1] whisper-${size} absent de models/ : ignoré (pnpm models:download -- --all)`);
      continue;
    }
    const cache = new TranscriptCache(join(RAW_DIR, `level1-whisper-${size}.jsonl`));
    let asr: Awaited<ReturnType<typeof loadWhisper>> | undefined;
    const byLang: Record<string, unknown> = {};
    for (const lang of LEVEL1_LANGS) {
      const man = join(FLEURS_DIR, lang, "manifest.jsonl");
      if (!existsSync(man)) {
        opts.log(`[level1] FLEURS ${lang} absent : lancer .venv/bin/python eval/scripts/fetch_fleurs.py`);
        continue;
      }
      const rows = readJsonl<FleursRow>(man).slice(0, opts.limits?.[size] ?? opts.limit);
      const results: { row: FleursRow; t: CachedTranscript }[] = [];
      for (const [i, row] of rows.entries()) {
        let t = cache.get(row.key);
        if (!t) {
          asr ??= await loadWhisper(size);
          const audio = loadAudio16k(join(FLEURS_DIR, "..", "..", row.file));
          const t0 = performance.now();
          const tr = await asr.transcribe(audio, { withEnglishTranslation: false });
          t = { ...tr, key: row.key, seconds: (performance.now() - t0) / 1000 };
          cache.put(t);
          if (i % 20 === 0) opts.log(`[level1] whisper-${size} ${lang} ${i + 1}/${rows.length} RTF ${(t.seconds / t.durationSec).toFixed(2)}`);
        }
        results.push({ row, t });
      }
      const counts = sumCounts(results.map((r) => errorCounts(r.row.transcription, r.t.text)));
      const audioSec = results.reduce((a, r) => a + r.row.durationSec, 0);
      const compSec = results.reduce((a, r) => a + r.t.seconds, 0);
      const langOk = results.filter((r) => r.t.language === lang).length;
      const r = rates(counts);
      byLang[lang] = {
        n: results.length,
        wer: round(r.wer, 4),
        cer: round(r.cer, 4),
        refWords: counts.refWords,
        languageIdAccuracy: round(langOk / results.length, 4),
        wrongLanguages: Object.fromEntries(
          [...new Set(results.filter((x) => x.t.language !== lang).map((x) => x.t.language))].map((l) => [l, results.filter((x) => x.t.language === l).length]),
        ),
        meanConfidence: round(results.reduce((a, x) => a + x.t.confidence, 0) / results.length, 3),
        audioSeconds: round(audioSec, 1),
        computeSeconds: round(compSec, 1),
        realTimeFactor: round(compSec / audioSec, 3),
        loadAverage1mAtEnd: round(loadavg()[0]!, 1),
      };
      opts.log(`[level1] whisper-${size} ${lang}: WER ${(r.wer * 100).toFixed(1)} % CER ${(r.cer * 100).toFixed(1)} % LID ${langOk}/${results.length} RTF ${(compSec / audioSec).toFixed(3)}`);
    }
    perModel[`whisper-${size}`] = byLang;
  }
  out.dataset = {
    name: "FLEURS (google/fleurs), split test",
    license: "CC BY 4.0",
    source: "https://huggingface.co/datasets/google/fleurs (refs/convert/parquet)",
    configs: { en: "en_us", fr: "fr_fr", de: "de_de", es: "es_419 (Latin American Spanish)", sw: "sw_ke" },
    samplePerLanguage: "see models.<model>.<lang>.n (first N rows of the fixed sample)",
    sampling: "fixed random sample, seed 20261004, one reading per FLEURS sentence id (eval/scripts/fetch_fleurs.py)",
    reference: "FLEURS `transcription` field (normalised), same normaliser applied to Whisper output",
    realVoices: true,
  };
  out.setup = {
    decoding: "greedy, automatic language detection over all Whisper languages (as in the app), task transcribe, q8 ONNX via onnxruntime-node CPU",
    normaliser: "lowercase NFKC, bracketed text removed, punctuation → space; accents kept; numbers not normalised",
    realTimeFactor: "compute seconds / audio seconds on this machine (8 vCPU WSL2 x86-64), all threads; the machine was shared with other jobs (load average recorded), so RTF here is pessimistic: see perf.json for controlled timings",
  };
  out.models = perModel;
  writeJson(join(RESULTS_DIR, "level1.json"), out);
  return out;
}
