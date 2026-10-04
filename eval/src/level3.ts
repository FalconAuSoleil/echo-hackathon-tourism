// Niveau 3 (SPEC 9) : bout en bout sur l'audio SYNTHÉTIQUE (voix Piper + bruits ESC-50 à 20/10/5 dB SNR).
// Audio → analyzeAudioMessage de @echo/core (mesures audio, « inaudible », Whisper de @echo/models, effacement
// du tampon, analyse) avec la configuration calibrée au niveau 2. Les transcriptions sont mises en cache
// (eval/results/raw/) pour pouvoir relancer le classement sans retranscrire.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { analyzeAudioMessage, makeConfig, type AnalysisConfig, type MessageAnalysis } from "@echo/core";
import { TranscriptCache, cachingTranscriber, whisperAvailable } from "./lib/asr.ts";
import { loadFeedback, splitCorpus, type Feedback } from "./lib/corpus.ts";
import { loadAudio16k, readJson, readJsonl, round, writeJson } from "./lib/io.ts";
import { evaluateByLang, summary, type SystemOutput } from "./lib/metrics.ts";
import { DATA_DIR, RAW_DIR, RESULTS_DIR, ROOT, abs } from "./lib/paths.ts";
import { execFileSync } from "node:child_process";
import { EMBEDDERS, fromAnalysis, getEmbedder, keywordOutput, loadCatalog } from "./lib/system.ts";
import { KEYWORD_SET_NAMES, loadKeywordSet, primaryKeywordSet } from "./lib/keyword-sets.ts";
import { createMatcher } from "@echo/core";
import { errorCounts, rates, sumCounts } from "./lib/wer.ts";

interface AudioRow {
  id: string;
  lang: string;
  text: string;
  durationSec: number;
  clean: string;
  noisy: Record<string, string>;
  tts: { voice: string; speaker: number | null; speed: number };
}

/**
 * clean : voix de synthèse brute (sans silence autour) ; clean_pad : la même avec 0,4 s de silence avant et
 * après, comme les versions bruitées (et comme un vrai message vocal, où l'on appuie avant de parler) ;
 * snr20/10/5 : bruits ESC-50 (avec ces 0,4 s de bruit seul avant et après).
 */
export const CONDITIONS = ["clean", "clean_pad", "snr20", "snr10", "snr5"] as const;
type Condition = (typeof CONDITIONS)[number];
const pathOf = (r: AudioRow, c: Condition) => (c === "clean" || c === "clean_pad" ? r.clean : r.noisy[c.slice(3)]!);
function loadCondition(r: AudioRow, c: Condition): Float32Array {
  const a = loadAudio16k(abs(pathOf(r, c)));
  if (c !== "clean_pad") return a;
  const pad = Math.round(0.4 * 16000);
  const out = new Float32Array(a.length + 2 * pad);
  out.set(a, pad);
  return out;
}

export async function runLevel3(opts: { sizes: string[]; log: (s: string) => void; config?: AnalysisConfig }) {
  const log = opts.log;
  const l2 = readJson<{ config: AnalysisConfig; calibration: { embeddingModel: string; variant: { embedder: string } } }>(join(RESULTS_DIR, "level2.json"));
  const config = opts.config ?? makeConfig(l2.config);
  const embedderKey = l2.calibration.variant.embedder;
  const catalog = loadCatalog();
  const keywordSet = primaryKeywordSet();
  const lists = loadKeywordSet(keywordSet);
  log(`[level3] keyword set: ${keywordSet}`);
  // Les deux jeux sont aussi rapportés (résumé), comme au niveau 2 : le principal reste dans `keywords`.
  const listsBySet = Object.fromEntries(KEYWORD_SET_NAMES.map((n) => [n, n === keywordSet ? lists : loadKeywordSet(n)]));
  const matcher = await createMatcher(catalog, await getEmbedder(embedderKey), config);
  const rows = readJsonl<AudioRow>(join(DATA_DIR, "audio_manifest.jsonl"));
  const fbById = new Map(loadFeedback().map((f) => [f.id, f]));
  const feedbacks: Feedback[] = rows.map((r) => fbById.get(r.id)!);
  const testIds = new Set(splitCorpus([...fbById.values()]).test.map((f) => f.id));
  const testSubset = feedbacks.filter((f) => testIds.has(f.id));
  if (rows.some((r) => !existsSync(abs(r.clean)) || Object.values(r.noisy).some((p) => !existsSync(abs(p))))) {
    log("[level3] synthetic audio missing: running bash tools/tts/make_eval_audio.sh (corpus agent's TTS + noise pipeline)");
    try {
      execFileSync("bash", [join(ROOT, "tools", "tts", "make_eval_audio.sh")], { stdio: "inherit", cwd: ROOT });
    } catch (e) {
      throw new Error(`level 3 audio could not be generated (${String(e).slice(0, 200)}): see eval/data/README.md`);
    }
  }

  // Référence niveau 2 sur les MÊMES 80 textes (pour la perte de qualité).
  const textOut = new Map<string, SystemOutput>();
  const { analyzeMessage } = await import("@echo/core");
  for (const f of feedbacks) textOut.set(f.id, fromAnalysis(await analyzeMessage({ id: f.id, receivedAt: "2026-09-15T10:00:00Z", source: "text", text: f.text }, { catalog, matcher, config })));
  const textKw = new Map(feedbacks.map((f) => [f.id, keywordOutput(f.id, f.text, f.lang, lists)]));
  const level2Same = {
    echo: evaluateByLang(feedbacks, textOut),
    keywords: evaluateByLang(feedbacks, textKw),
    keywordSets: Object.fromEntries(
      KEYWORD_SET_NAMES.map((n) => [n, summary(evaluateByLang(feedbacks, new Map(feedbacks.map((f) => [f.id, keywordOutput(f.id, f.text, f.lang, listsBySet[n]!)]))).all)]),
    ),
  };

  const models: Record<string, unknown> = {};
  for (const size of opts.sizes) {
    if (!whisperAvailable(size)) {
      log(`[level3] whisper-${size} absent : ignoré`);
      continue;
    }
    const cache = new TranscriptCache(join(RAW_DIR, `level3-whisper-${size}.jsonl`));
    let currentKey = "";
    const transcriber = cachingTranscriber(cache, size, () => currentKey);
    const perCond: Record<string, unknown> = {};
    for (const cond of CONDITIONS) {
      const analyses: MessageAnalysis[] = [];
      for (const [i, r] of rows.entries()) {
        currentKey = `${cond}/${r.id}`;
        const audio = loadCondition(r, cond);
        const a = await analyzeAudioMessage(
          { id: r.id, receivedAt: "2026-09-15T10:00:00Z", audio16k: audio },
          { catalog, matcher, config, transcriber, withEnglishTranslation: false },
        );
        analyses.push(a);
        if (i % 20 === 19) log(`[level3] whisper-${size} ${cond} ${i + 1}/${rows.length}`);
      }
      const outs = new Map(analyses.map((a) => [a.id, fromAnalysis(a)]));
      // Mots-clés sur la transcription Whisper (langue détectée par Whisper).
      const kwOuts = new Map(
        rows.map((r) => {
          const t = cache.get(`${cond}/${r.id}`);
          return [r.id, keywordOutput(r.id, t?.text ?? "", t?.language ?? r.lang, lists)];
        }),
      );
      const transcripts = rows.map((r) => ({ r, t: cache.get(`${cond}/${r.id}`) }));
      const transcribed = transcripts.filter((x) => x.t);
      const werAll = rates(sumCounts(transcribed.map((x) => errorCounts(x.r.text, x.t!.text))));
      const werByLang = Object.fromEntries(
        ["en", "fr", "de", "es"].map((l) => {
          const xs = transcribed.filter((x) => x.r.lang === l);
          const rr = rates(sumCounts(xs.map((x) => errorCounts(x.r.text, x.t!.text))));
          return [l, { wer: round(rr.wer, 4), cer: round(rr.cer, 4), n: xs.length }];
        }),
      );
      const statusCount: Record<string, number> = {};
      for (const a of analyses) statusCount[a.status] = (statusCount[a.status] ?? 0) + 1;
      const inaudible = analyses.filter((a) => a.status === "inaudible").map((a) => ({ id: a.id, reason: a.reason, durationSec: rows.find((r) => r.id === a.id)!.durationSec }));
      // par langue : résumé seulement (le JSON complet par langue × condition × modèle serait trop gros)
      const compact = (x: ReturnType<typeof evaluateByLang>) => ({ all: x.all, byLang: Object.fromEntries(Object.entries(x.byLang).map(([l, m]) => [l, summary(m)])) });
      const echoFull = evaluateByLang(feedbacks, outs);
      const kwFull = evaluateByLang(feedbacks, kwOuts);
      const echo = compact(echoFull);
      const kw = compact(kwFull);
      const compSec = transcribed.reduce((s, x) => s + x.t!.seconds, 0);
      const audioSec = transcribed.reduce((s, x) => s + x.t!.durationSec, 0);
      perCond[cond] = {
        wer: round(werAll.wer, 4),
        cer: round(werAll.cer, 4),
        werByLang,
        languageIdAccuracy: round(transcribed.filter((x) => x.t!.language === x.r.lang).length / Math.max(1, transcribed.length), 4),
        transcribed: transcribed.length,
        messageStatus: statusCount,
        inaudible,
        realTimeFactor: round(compSec / Math.max(1e-9, audioSec), 3),
        echo,
        keywords: kw,
        echoTestSubset: summary(evaluateByLang(testSubset, outs).all),
        keywordsTestSubset: summary(evaluateByLang(testSubset, kwOuts).all),
        keywordSets: Object.fromEntries(
          KEYWORD_SET_NAMES.map((n) => {
            const o = new Map(
              rows.map((r) => {
                const t = cache.get(`${cond}/${r.id}`);
                return [r.id, keywordOutput(r.id, t?.text ?? "", t?.language ?? r.lang, listsBySet[n]!)];
              }),
            );
            return [n, summary(evaluateByLang(feedbacks, o).all)];
          }),
        ),
        perMessage: analyses.map((a) => ({
          id: a.id,
          status: a.status,
          reason: a.reason,
          lang: a.lang,
          transcript: cache.get(`${cond}/${a.id}`)?.text,
          expected: fbById.get(a.id)!.expectedFindings,
          echo: a.findings.map((f) => f.id),
          keywords: kwOuts.get(a.id)!.findings,
        })),
      };
      log(
        `[level3] whisper-${size} ${cond}: WER ${(werAll.wer * 100).toFixed(1)} % | Echo capture ${(echo.all.remarks.captureRate * 100).toFixed(1)} % err ${(echo.all.answers.acceptedErrorRate * 100).toFixed(1)} % F1 ${echo.all.micro.f1} | kw capture ${(kw.all.remarks.captureRate * 100).toFixed(1)} % err ${(kw.all.answers.acceptedErrorRate * 100).toFixed(1)} %`,
      );
    }
    models[`whisper-${size}`] = perCond;
  }
  const out = {
    synthetic: true,
    note: "Level-3 audio is SYNTHETIC: Piper TTS voices (13 voices en/fr/de/es) + ESC-50 outdoor noise at 20/10/5 dB SNR (eval/data/README.md). References for WER contain the corpus' deliberate typos, which inflates WER slightly.",
    clips: rows.length,
    clipsInTestHalf: testSubset.length,
    byLang: Object.fromEntries(["en", "fr", "de", "es"].map((l) => [l, rows.filter((r) => r.lang === l).length])),
    config,
    embeddingModel: EMBEDDERS[embedderKey],
    englishTranslation: "disabled in this run (only used for the 'to be read by a person' list, not for classification)",
    keywordSet,
    level2SameMessages: level2Same,
    models,
  };
  writeJson(join(RESULTS_DIR, "level3.json"), out);
  return out;
}
