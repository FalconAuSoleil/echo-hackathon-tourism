import { useState } from "preact/hooks";
import { keywordAnalyze, type Catalog, type ChunkResult, type KeywordLists, type MessageAnalysis } from "@echo/core";
import { findingLabel, findingPolarity, langName } from "../lib/assets.ts";
import type { Timings } from "../worker/protocol.ts";
import { pct } from "./common.tsx";

const REASONS: Record<string, string> = {
  below_threshold: "below the calibrated threshold",
  below_floor: "resembles no finding",
  negation: "negation inverts the meaning",
  negation_uncertain: "unclear negation",
  unsupported_language: "language not supported",
  low_language_probability: "language poorly recognised",
  message_low_confidence: "low transcription confidence",
  too_short: "shorter than 3 seconds",
  silence: "silence",
  steady_noise: "noise without speech",
  too_noisy: "too noisy",
  empty_transcript: "nothing intelligible",
  no_transcript: "no transcript",
  empty_text: "empty text",
  duplicate_fingerprint: "same message already received",
  duplicate_embedding: "near-identical message already received",
};
export const reasonText = (r?: string): string => (r ? (REASONS[r] ?? r.replaceAll("_", " ")) : "");

export function StatusBadge({ status }: { status: MessageAnalysis["status"] }) {
  const map: Record<string, [string, string]> = {
    analyzed: ["ok", "analysed"],
    not_sure: ["unsure", "not sure: ask a person"],
    inaudible: ["plain", "inaudible: not counted"],
    duplicate: ["plain", "duplicate: counted once"],
  };
  const [cls, label] = map[status] ?? ["plain", status];
  return <span class={`badge ${cls}`}>{label}</span>;
}

function FindingChip({ catalog, id, score }: { catalog: Catalog; id: string; score?: number }) {
  const neg = findingPolarity(catalog, id) === "negative";
  return (
    <span class={`badge ${neg ? "neg" : "ok"}`} title={id}>
      {id} {findingLabel(catalog, id)}
      {score !== undefined && ` · ${pct(score)}`}
    </span>
  );
}

function ChunkItem({ c, catalog }: { c: ChunkResult; catalog: Catalog }) {
  const neg = c.findings.some((f) => findingPolarity(catalog, f.id) === "negative");
  return (
    <li class={`chunk ${c.status} ${neg ? "negative" : ""}`} data-status={c.status}>
      <div class="text">“{c.text}”</div>
      <div class="meta">
        {c.status === "matched" && c.findings.map((f) => <FindingChip key={f.id} catalog={catalog} id={f.id} score={f.score} />)}
        {c.status === "not_sure" && (
          <>
            <span class="ask">Not sure: ask a person</span>
            <span class="muted">({reasonText(c.reason)})</span>
          </>
        )}
        {c.status === "off_list" && <span class="muted">Off-list: not a catalog finding</span>}
        {c.mentionsGuide && <span class="badge plain" title="Visible to the host only, never shared with the cooperative">about the guide: host only</span>}
        {c.status !== "matched" && c.topScores[0] && (
          <span class="muted" style={{ fontSize: "0.76rem" }}>
            closest: {c.topScores[0].id} {pct(c.topScores[0].score)}
          </span>
        )}
      </div>
    </li>
  );
}

export function MessageResult({
  analysis: a,
  catalog,
  keywords,
  timings,
  title,
  extra,
}: {
  analysis: MessageAnalysis;
  catalog: Catalog;
  keywords?: KeywordLists;
  timings?: Timings;
  title?: string;
  extra?: preact.ComponentChildren;
}) {
  const [compare, setCompare] = useState(false);
  const inList = a.chunks.filter((c) => c.status !== "off_list");
  const off = a.chunks.filter((c) => c.status === "off_list");
  const kw = compare && keywords && a.scrubbedText ? keywordAnalyze(a.scrubbedText, a.lang, keywords) : null;
  return (
    <article class="card" data-testid="message-result" data-message-id={a.id} data-status={a.status}>
      <div class="row" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>{title ?? "Message"}</h3>
        <StatusBadge status={a.status} />
      </div>
      <dl class="kv" style={{ marginTop: "0.5rem" }}>
        <dt>Language</dt>
        <dd data-testid="lang">
          {a.status === "inaudible" && a.lang === "unknown" ? (
            <span class="muted">not transcribed</span>
          ) : (
            <>
              {langName(a.lang)} <span class="muted">({a.source === "audio" ? "detected by Whisper" : "detected from the text"})</span>
            </>
          )}
        </dd>
        {a.transcriptConfidence !== undefined && (
          <>
            <dt>Transcription confidence</dt>
            <dd>{pct(a.transcriptConfidence)}</dd>
          </>
        )}
        {timings && (
          <>
            <dt>On-device time</dt>
            <dd>
              {(timings.totalMs / 1000).toFixed(1)} s{timings.transcribeMs ? ` (Whisper ${(timings.transcribeMs / 1000).toFixed(1)} s)` : ""}
            </dd>
          </>
        )}
        {a.reason && (
          <>
            <dt>Why</dt>
            <dd>{reasonText(a.reason)}</dd>
          </>
        )}
      </dl>
      {extra}
      {a.scrubbedText && (
        <p>
          <span class="muted">{a.source === "audio" ? "Transcript" : "Text"} (names, numbers and e-mails removed): </span>
          <span data-testid="transcript">{a.scrubbedText}</span>
        </p>
      )}
      {a.status === "inaudible" && <p class="muted">Nothing is guessed: the message is not counted. The audio has been deleted.</p>}
      {inList.length > 0 && (
        <>
          <h3 style={{ marginTop: "0.6rem" }}>Chunks and findings</h3>
          <ul class="chunks">
            {inList.map((c) => (
              <ChunkItem key={c.id} c={c} catalog={catalog} />
            ))}
          </ul>
        </>
      )}
      {off.length > 0 && (
        <>
          <h3 style={{ marginTop: "0.6rem" }}>Off-list (kept apart, never counted)</h3>
          <ul class="chunks">
            {off.map((c) => (
              <ChunkItem key={c.id} c={c} catalog={catalog} />
            ))}
          </ul>
        </>
      )}
      {a.status === "analyzed" || a.status === "not_sure" ? (
        <p>
          <span class="muted">Counted for this message: </span>
          {a.findings.length ? a.findings.map((f) => <FindingChip key={f.id} catalog={catalog} id={f.id} />) : <span class="muted">nothing</span>}
        </p>
      ) : null}
      {keywords && a.scrubbedText && (
        <div class="no-print">
          <button class="ghost" onClick={() => setCompare(!compare)} data-testid="compare-toggle">
            {compare ? "Hide comparison" : "Compare with keyword matching"}
          </button>
          {kw && (
            <div class="compare" style={{ marginTop: "0.5rem" }} data-testid="compare">
              <div>
                <strong>Keyword matching (no AI)</strong>
                <ul class="chunks">
                  {kw.chunks.map((c, i) => (
                    <li key={i} class="chunk">
                      <div class="text">“{c.text}”</div>
                      <div class="meta">
                        {c.findings.length ? c.findings.map((id) => <FindingChip key={id} catalog={catalog} id={id} />) : <span class="muted">no keyword</span>}
                      </div>
                    </li>
                  ))}
                </ul>
                <small>Counts every keyword hit: no negation handling, no "not sure".</small>
              </div>
              <div>
                <strong>Echo</strong>
                <ul class="chunks">
                  {a.chunks.map((c) => (
                    <ChunkItem key={c.id} c={c} catalog={catalog} />
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
