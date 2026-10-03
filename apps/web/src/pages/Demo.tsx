import { useEffect, useMemo, useState } from "preact/hooks";
import { DEFAULT_CONFIG, toReviewChunks, type MessageAnalysis } from "@echo/core";
import { decodeTo16kMono, startRecording, type Recording } from "../lib/audio.ts";
import { langName, type DemoSample, type StaticData } from "../lib/assets.ts";
import { addMonths, analysisToMonthMessage, currentMonth, demoReport, monthReport } from "../lib/recap-service.ts";
import { syntheticHistory } from "../lib/synthetic.ts";
import { analysis } from "../lib/worker-client.ts";
import type { Timings } from "../worker/protocol.ts";
import { ModelBox } from "../ui/ModelBox.tsx";
import { MessageResult } from "../ui/MessageResult.tsx";
import { RecapView } from "../ui/RecapView.tsx";
import { ReviewList } from "../ui/ReviewList.tsx";
import { Trends } from "../ui/Trends.tsx";
import { Synthetic, createStore, formatMonth, useModelProgress } from "../ui/common.tsx";

interface Run {
  analysis: MessageAnalysis;
  timings: Timings;
  title: string;
  sample?: DemoSample;
}

interface DemoState {
  runs: Run[];
  busy: string | null;
  error: string;
}

const store = createStore<DemoState>({ runs: [], busy: null, error: "" });
let seq = 0;

const SAMPLE_TITLES: Record<string, string> = {
  "de-roasting-path": "German: roasting + long path",
  "en-prices-buy": "English: prices + buy coffee",
  "fr-welcome-meal": "French: welcome + meal",
  "es-visit-too-long": "Spanish: visit too long",
  "en-negation": "English: a negation",
  "fr-ambiguous": "French: ambiguous",
  "en-picking": "English: cherry picking",
  "de-picking": "German: cherry picking",
  "fr-picking": "French: cherry picking",
  "inaudible-noise": "Inaudible noise",
};

async function runJob(label: string, job: () => Promise<Omit<Run, "title">>): Promise<void> {
  store.set((s) => ({ ...s, busy: label, error: "" }));
  try {
    const r = await job();
    store.set((s) => ({ ...s, runs: [{ ...r, title: label }, ...s.runs] }));
  } catch (e) {
    store.set((s) => ({ ...s, error: e instanceof Error ? e.message : String(e) }));
  } finally {
    store.set((s) => ({ ...s, busy: null }));
  }
}

const known = () =>
  store.get().runs.map((r) => ({ fingerprint: r.analysis.fingerprint, receivedAt: r.analysis.receivedAt, ...(r.analysis.messageEmbedding ? { embedding: r.analysis.messageEmbedding } : {}) }));

export async function runSample(s: DemoSample): Promise<void> {
  await runJob(SAMPLE_TITLES[s.id] ?? s.id, async () => {
    const buf = await (await fetch(`/samples/${s.file}`)).arrayBuffer();
    const audio = await decodeTo16kMono(buf);
    const r = await analysis.analyzeAudio(`demo-${++seq}`, new Date().toISOString(), audio, known());
    return { ...r, sample: s };
  });
}

async function runBlob(blob: Blob, label: string): Promise<void> {
  await runJob(label, async () => {
    const audio = await decodeTo16kMono(await blob.arrayBuffer());
    return analysis.analyzeAudio(`demo-${++seq}`, new Date().toISOString(), audio, known());
  });
}

async function runText(text: string): Promise<void> {
  await runJob("Written message", () => analysis.analyzeText(`demo-${++seq}`, new Date().toISOString(), text, known()));
}

export function Demo({ data }: { data: StaticData }) {
  const st = store.use();
  const progress = useModelProgress();
  const ready = progress.stage === "ready";
  const [text, setText] = useState("");
  const [phone, setPhone] = useState("");
  const [rec, setRec] = useState<Recording | null>(null);
  const [recSec, setRecSec] = useState(0);
  const [recErr, setRecErr] = useState("");
  const month = currentMonth();
  const history = useMemo(() => syntheticHistory(month), [month]);
  const months = [addMonths(month, -3), addMonths(month, -2), addMonths(month, -1), month];
  const [viewMonth, setViewMonth] = useState(month);
  const session = st.runs.map((r) => r.analysis).slice().reverse();
  const report = useMemo(
    () =>
      viewMonth === month
        ? demoReport(month, session, history, data.catalog, DEFAULT_CONFIG)
        : monthReport(viewMonth, history, [], data.catalog, DEFAULT_CONFIG),
    [st.runs, viewMonth],
  );
  const reviewChunks = session.flatMap((a) => toReviewChunks(a));
  const doneIds = new Set(st.runs.map((r) => r.sample?.id).filter(Boolean));

  useEffect(() => {
    if (!rec) return;
    rec.done.then((blob) => {
      setRec(null);
      void runBlob(blob, "Your recording");
    });
  }, [rec]);

  const record = async () => {
    setRecErr("");
    if (rec) return rec.stop();
    try {
      setRecSec(0);
      setRec(await startRecording(30, setRecSec));
    } catch (e) {
      setRecErr(`Microphone not available: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const runAll = async () => {
    for (const s of data.samples) if (!doneIds.has(s.id)) await runSample(s);
  };

  return (
    <>
      <section class="card">
        <h1 style={{ fontSize: "1.35rem" }}>Try Echo</h1>
        <p>
          Visitors leave a short voice message in their language after a farm visit. Echo keeps the messages, compares them month after
          month and tells the host, in Kinyarwanda, what visitors liked, what to fix first and what keeps coming back. Echo is not a
          translator: it never shows the host a free translation and never generates free text.
        </p>
        <p class="muted" style={{ fontSize: "0.85rem" }}>
          No account. Messages you run here stay in this browser tab's memory and are gone when you close it.
        </p>
      </section>

      <ModelBox manifest={data.manifest} />

      <section class="card" data-testid="samples">
        <h2>
          Sample messages <Synthetic>synthetic voices</Synthetic>
        </h2>
        <p class="muted" style={{ fontSize: "0.85rem" }}>
          Written by the team and read by open-source synthetic voices (Piper TTS), not real visitors. One click runs the whole pipeline
          on this device: Whisper, name removal, chunking, matching, "not sure".
        </p>
        <div class="samples">
          {data.samples.map((s) => (
            <button
              key={s.id}
              class={`sample ${doneIds.has(s.id) ? "done" : ""}`}
              disabled={!!st.busy || !ready}
              onClick={() => void runSample(s)}
              data-testid={`sample-${s.id}`}
            >
              <strong>{SAMPLE_TITLES[s.id] ?? s.id}</strong>
              <small class="muted">
                {langName(s.lang)} · {s.durationSec.toFixed(1)} s
              </small>
            </button>
          ))}
        </div>
        <div class="row" style={{ marginTop: "0.6rem" }}>
          <button class="secondary" disabled={!!st.busy || !ready} onClick={() => void runAll()} data-testid="run-all">
            Run all samples
          </button>
          <button class={rec ? "danger" : "secondary"} disabled={(!!st.busy && !rec) || !ready} onClick={() => void record()} data-testid="record">
            {rec ? `Stop recording (${Math.floor(recSec)} / 30 s)` : "Record your own voice (30 s max)"}
          </button>
          {st.runs.length > 0 && (
            <button class="ghost" disabled={!!st.busy} onClick={() => store.set({ runs: [], busy: null, error: "" })}>
              Clear results
            </button>
          )}
        </div>
        {recErr && <p class="error">{recErr}</p>}
        <label class="field">
          <span>Or type a written message (any of English, French, German, Spanish)</span>
          <textarea value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} placeholder="The coffee tasting was wonderful but the walk was far too long." />
        </label>
        <button disabled={!!st.busy || !ready || !text.trim()} onClick={() => void runText(text).then(() => setText(""))} data-testid="run-text">
          Analyse text
        </button>
        {!ready && <p class="muted">The buttons unlock once the models are ready (see above).</p>}
        {st.busy && (
          <p data-testid="busy">
            <strong>Analysing on this device:</strong> {st.busy}…
          </p>
        )}
        {st.error && <p class="error">{st.error}</p>}
      </section>

      {st.runs.map((r) => (
        <MessageResult
          key={r.analysis.id}
          analysis={r.analysis}
          catalog={data.catalog}
          keywords={data.keywords}
          timings={r.timings}
          title={r.title}
          extra={
            r.sample && (
              <p class="muted" style={{ fontSize: "0.82rem" }}>
                {r.sample.transcript ? `Script read by the synthetic voice: “${r.sample.transcript}” ` : "Generated noise, no speech. "}
                <Synthetic /> Expected: {r.sample.expected.note}
              </p>
            )
          }
        />
      ))}

      <section class="card">
        <div class="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>The host's monthly recap</h2>
          <select value={viewMonth} onChange={(e) => setViewMonth((e.target as HTMLSelectElement).value)} style={{ width: "auto" }} data-testid="recap-month">
            {months.map((m) => (
              <option key={m} value={m}>
                {formatMonth(m)} {m === month ? "(messages you ran + synthetic history)" : "(synthetic)"}
              </option>
            ))}
          </select>
        </div>
        <p class="muted" style={{ fontSize: "0.85rem" }}>
          {viewMonth === month
            ? `This month = the messages you ran above. The three previous months are a synthetic history, so "for x months" streaks can show.`
            : "A month of the synthetic history (finding lists written by hand, not produced by the models)."}
        </p>
      </section>
      <RecapView report={report} glosses phone={phone} onPhoneChange={setPhone} />

      <ReviewList chunks={viewMonth === month ? reviewChunks : []} recurring={viewMonth === month ? report.recurring : []} />

      <section class="card">
        <h2>
          Trends over 4 months <Synthetic>3 synthetic months</Synthetic>
        </h2>
        <p class="muted" style={{ fontSize: "0.85rem" }}>
          k/n = messages citing the finding / messages counted that month. The first three months are synthetic; the last one is what you
          ran in this demo.
        </p>
        <Trends catalog={data.catalog} months={months} messages={[...history, ...session.map(analysisToMonthMessage)]} liveMonth={month} />
      </section>
    </>
  );
}
