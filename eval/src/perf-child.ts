// Mesure isolée (processus à part, pour une mémoire de pointe propre) : charge un Whisper + l'embedder,
// prépare le matcher, puis traite un message de 30 s comme l'app (analyzeAudioMessage, traduction anglaise
// pour la liste « à faire lire »). Sortie : une ligne JSON. Lancé par perf.ts.
import { readFileSync } from "node:fs";
import { analyzeAudioMessage, createMatcher, exportExampleEmbeddings, makeConfig, validateCatalog, type AnalysisConfig } from "@echo/core";
import { createEmbedder, createWhisperTranscriber, useLocalModels } from "@echo/models";

const [asrId, embId, audioPath, configPath, threadsArg] = process.argv.slice(2) as [string, string, string, string, string | undefined];
const ROOT = new URL("../../", import.meta.url).pathname;
useLocalModels(`${ROOT}models`);
const hwm = () => {
  const m = /VmHWM:\s+(\d+) kB/.exec(readFileSync("/proc/self/status", "utf8"));
  return m ? Number(m[1]) / 1024 : NaN;
};
const rss = () => process.memoryUsage().rss / 1e6;
const t = () => performance.now() / 1000;
// Nombre de threads d'onnxruntime (taskset ne suffit pas : onnxruntime fixe lui-même l'affinité de ses threads).
const threads = threadsArg && threadsArg !== "all" ? Number(threadsArg) : undefined;
const dev = threads ? { threads } : {};

const config = makeConfig(JSON.parse(readFileSync(configPath, "utf8")) as Partial<AnalysisConfig>);
const catalog = validateCatalog(JSON.parse(readFileSync(`${ROOT}catalog/catalog.json`, "utf8")));
const pcm = readFileSync(audioPath);
const audio = new Float32Array(pcm.byteLength / 4);
new Uint8Array(audio.buffer).set(pcm);
const durationSec = audio.length / 16000;

const t0 = t();
const embed = await createEmbedder(embId, dev);
const t1 = t();
const asr = await createWhisperTranscriber(asrId, dev);
const t2 = t();
const matcher = await createMatcher(catalog, embed, config); // 1er lancement : plonge les exemples + entraîne
const t3 = t();
const cached = await createMatcher(catalog, embed, config, { precomputed: exportExampleEmbeddings(matcher), classifier: matcher.classifier });
const t4 = t();
const rssLoaded = rss();
// Message de 30 s, comme dans l'app (traduction anglaise incluse pour une langue autre que l'anglais).
const a = await analyzeAudioMessage({ id: "perf", receivedAt: "2026-09-15T10:00:00Z", audio16k: audio.slice() }, { catalog, matcher: cached, config, transcriber: asr, withEnglishTranslation: true });
const t5 = t();
const b = await analyzeAudioMessage({ id: "perf2", receivedAt: "2026-09-15T10:00:00Z", audio16k: audio.slice() }, { catalog, matcher: cached, config, transcriber: asr, withEnglishTranslation: false });
const t6 = t();
console.log(
  JSON.stringify({
    asrId,
    embId,
    threads: threads ?? "all",
    audioSec: durationSec,
    loadEmbedderSec: t1 - t0,
    loadAsrSec: t2 - t1,
    firstRunMatcherSec: t3 - t2,
    cachedMatcherSec: t4 - t3,
    message30sWithTranslationSec: t5 - t4,
    message30sNoTranslationSec: t6 - t5,
    rssAfterLoadMB: rssLoaded,
    peakRssMB: hwm(),
    status: a.status,
    lang: a.lang,
    findings: a.findings.map((f) => f.id),
    transcriptPreview: a.scrubbedText.slice(0, 120),
    statusNoTranslation: b.status,
  }),
);
