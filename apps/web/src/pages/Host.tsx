import { useEffect, useMemo, useState } from "preact/hooks";
import { DEFAULT_CONFIG } from "@echo/core";
import { findingLabel, langName, type StaticData } from "../lib/assets.ts";
import { addFiles, addText, db, host, processQueue, refresh, removeQueued, updateSettings } from "../lib/host-store.ts";
import { HostLabel, Icon } from "../ui/HostLabel.tsx";
import { currentMonth, monthReport, reviewChunksToItems, toMonthMessage } from "../lib/recap-service.ts";
import { verifyPin } from "../lib/pin.ts";
import { ModelBox } from "../ui/ModelBox.tsx";
import { MessageResult, StatusBadge } from "../ui/MessageResult.tsx";
import { RecapView } from "../ui/RecapView.tsx";
import { ReviewList } from "../ui/ReviewList.tsx";
import { formatMonth, pct, useModelProgress } from "../ui/common.tsx";

export function PinGate({ children }: { children: preact.ComponentChildren }) {
  const st = host.use();
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => void refresh(), []);
  if (!st.loaded) return <p class="muted">Loading…</p>;
  if (st.unlocked || !st.settings.pin) return <>{children}</>;
  const submit = async (e: Event) => {
    e.preventDefault();
    if (st.settings.pin && (await verifyPin(pin, st.settings.pin))) host.set((s) => ({ ...s, unlocked: true }));
    else setErr("Wrong PIN");
    setPin("");
  };
  return (
    <form class="card lock" onSubmit={submit} data-testid="pin-lock">
      <h2>Echo is locked</h2>
      <p class="muted">Enter the PIN to open the host's messages.</p>
      <input type="password" inputMode="numeric" autoComplete="off" value={pin} onInput={(e) => setPin((e.target as HTMLInputElement).value)} />
      <p>
        <button type="submit">Unlock</button>
      </p>
      {err && <p class="error">{err}</p>}
    </form>
  );
}

export function Host({ data }: { data: StaticData }) {
  const st = host.use();
  const progress = useModelProgress();
  const [text, setText] = useState("");
  const shared = /[?&]shared=(\d+)/.exec(location.hash)?.[1];
  const months = useMemo(() => [...new Set([currentMonth(), ...st.messages.map((m) => m.month)])].sort().reverse(), [st.messages]);
  const [month, setMonth] = useState(currentMonth());
  const [glosses, setGlosses] = useState(false);
  const report = useMemo(
    () => monthReport(month, st.messages.map(toMonthMessage), reviewChunksToItems(st.review, DEFAULT_CONFIG), data.catalog, DEFAULT_CONFIG),
    [st.messages, st.review, month],
  );
  const monthMsgs = st.messages.filter((m) => m.month === month);
  const modeA = st.settings.mode === "A";
  const toDelete = st.settings.whatsappToDelete ?? 0;
  const monthReview = st.review.filter((c) => c.month === month);

  return (
    <>
      <section class="card">
        <h1 style={{ fontSize: "1.3rem" }}>Host app {st.settings.farmName && <span class="muted">· {st.settings.farmName}</span>}</h1>
        <p class="muted" style={{ fontSize: "0.88rem" }}>
          {st.settings.mode === "A"
            ? "Mode A: this Android phone is the host's own phone. The host listens to the recap here."
            : "Mode B: this is the household smartphone. The host has a basic phone and receives the recap by SMS (and can listen to it here)."}{" "}
          Change it in <a href="#/settings">Settings</a>.
        </p>
      </section>

      {toDelete > 0 && (
        <section class="whatsapp-reminder" data-testid="whatsapp-reminder" role="status">
          {modeA && (
            <p style={{ margin: "0 0 0.4rem", fontSize: "1.1rem" }}>
              <HostLabel catalog={data.catalog} id="delete_whatsapp" rw n={toDelete} en="" />
            </p>
          )}
          <p style={{ margin: 0 }}>
            <Icon id="delete_whatsapp" size={18} /> <strong class="count" data-testid="whatsapp-count">{toDelete}</strong> voice note{toDelete === 1 ? "" : "s"} still
            to delete. <strong>Delete the original voice note{toDelete === 1 ? "" : "s"} in WhatsApp now:</strong> the visitor card promised that the sound is
            deleted after analysis. Echo has already deleted its own copy, but it cannot delete the one in WhatsApp (long-press the voice note in the chat →
            Delete → Delete for me).
          </p>
          <p style={{ margin: "0.5rem 0 0" }}>
            <button class="secondary" onClick={() => void updateSettings({ whatsappToDelete: 0 })} data-testid="whatsapp-done">
              {modeA ? <HostLabel catalog={data.catalog} id="deleted" rw en="Done, I deleted them in WhatsApp" gloss /> : "Done, I deleted them in WhatsApp"}
            </button>
          </p>
        </section>
      )}

      {shared && (
        <p class="notice info" data-testid="shared-notice">
          {shared} shared item{shared === "1" ? "" : "s"} added to the queue.
        </p>
      )}

      <section class="card" data-testid="inbox">
        <h2>1. Receive messages</h2>
        <p class="muted" style={{ fontSize: "0.88rem" }}>
          In WhatsApp, long-press a voice message, tap Share and choose Echo (once Echo is installed on the home screen). Or import a file,
          or paste a written message. From here on, nothing needs the internet.
        </p>
        <div class="row">
          <label class="btn secondary">
            Import voice message(s)
            <input
              type="file"
              accept="audio/*,.opus,.ogg,.m4a,.mp3,.wav,.aac,.amr,text/plain"
              multiple
              hidden
              onChange={(e) => {
                // Copie avant de vider le champ : FileList est vivante.
                const f = Array.from((e.target as HTMLInputElement).files ?? []);
                if (f.length) void addFiles(f, "file");
                (e.target as HTMLInputElement).value = "";
              }}
              data-testid="host-file"
            />
          </label>
        </div>
        <label class="field">
          <span>Paste a written message</span>
          <textarea value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} data-testid="host-text" />
        </label>
        <button class="secondary" disabled={!text.trim()} onClick={() => void addText(text).then(() => setText(""))} data-testid="host-add-text">
          Add to queue
        </button>

        <h3 style={{ marginTop: "0.8rem" }}>Queue: {st.queue.length} waiting</h3>
        {st.transcribed > 0 && (
          <p class="muted" data-testid="transcribed-waiting">
            {st.transcribed} voice message{st.transcribed === 1 ? "" : "s"} transcribed (audio already deleted), waiting for the analysis step.
          </p>
        )}
        {st.queue.length > 0 && (
          <ul class="chunks">
            {st.queue.map((q) => (
              <li class="chunk" key={q.id}>
                <div class="row" style={{ justifyContent: "space-between" }}>
                  <span>
                    {q.kind === "audio" ? `Voice message${q.name ? ` (${q.name})` : ""}` : "Written message"} ·{" "}
                    <span class="muted">{new Date(q.receivedAt).toLocaleString()}</span>
                    {st.processing === q.id && <strong> · analysing…</strong>}
                  </span>
                  {st.processing !== q.id && (
                    <button class="ghost" onClick={() => void removeQueued(q.id)}>
                      Remove
                    </button>
                  )}
                </div>
                {st.errors[q.id] && <div class="error">{st.errors[q.id]}</div>}
              </li>
            ))}
          </ul>
        )}
        <button
          disabled={!st.queue.length || !!st.processing || progress.stage === "error"}
          onClick={() => void processQueue()}
          data-testid="host-process"
        >
          {st.processing ? (
            (st.processingLabel ?? "Analysing on this device…")
          ) : (
            <HostLabel
              catalog={data.catalog}
              id="analyse"
              rw={modeA}
              gloss={glosses}
              en={`Analyse ${st.queue.length} message${st.queue.length === 1 ? "" : "s"} offline`}
            />
          )}
          {!st.processing && modeA && ` (${st.queue.length})`}
        </button>
        <p class="muted" style={{ fontSize: "0.82rem" }}>
          Voice files are deleted from Echo as soon as they are transcribed. Names, phone numbers and e-mails are removed before anything is stored.
          Voice messages are transcribed first, then analysed, so only one model is in memory at a time on a phone with 2 GB.
        </p>
      </section>

      {progress.stage !== "ready" && <ModelBox manifest={data.manifest} compact />}

      {st.recent.map((r) => (
        <MessageResult key={r.analysis.id} analysis={r.analysis} catalog={data.catalog} timings={r.timings} title="Just analysed (shown once, full text not stored)" />
      ))}

      <section class="card">
        <div class="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>
            2. <HostLabel catalog={data.catalog} id="recap_month" rw={modeA} en="Monthly recap" gloss={glosses} />
          </h2>
          <select value={month} onChange={(e) => setMonth((e.target as HTMLSelectElement).value)} style={{ width: "auto" }}>
            {months.map((m) => (
              <option key={m} value={m}>
                {formatMonth(m)}
              </option>
            ))}
          </select>
        </div>
        <label class="row" style={{ marginTop: "0.4rem", fontSize: "0.88rem" }}>
          <input type="checkbox" checked={glosses} onChange={(e) => setGlosses((e.target as HTMLInputElement).checked)} />
          Show the French / English source of each frozen sentence (for a helper)
        </label>
      </section>
      <RecapView
        report={report}
        glosses={glosses}
        {...(modeA ? { hostLabels: { catalog: data.catalog, gloss: glosses } } : {})}
        phone={st.settings.hostPhone}
        onPhoneChange={(p) => void updateSettings({ hostPhone: p })}
        onSmsOpened={() => void db().then((d) => d.put("recaps", { month, lines: report.recap.lines, builtAt: new Date().toISOString(), smsOpenedAt: new Date().toISOString() }))}
      />

      <ReviewList chunks={monthReview} recurring={report.recurring} />

      <section class="card" data-testid="stored-messages">
        <h2>What is stored for {formatMonth(month)}</h2>
        <p class="muted" style={{ fontSize: "0.85rem" }}>
          Per message: date, language, findings with confidence, status. No audio, no full text, no name, no phone number.
        </p>
        {monthMsgs.length === 0 && <p class="muted">No message this month.</p>}
        <div class="scroll-x">
          <table>
            <tbody>
              {monthMsgs.map((m) => (
                <tr key={m.id}>
                  <td>{new Date(m.receivedAt).toLocaleDateString()}</td>
                  <td>{langName(m.lang)}</td>
                  <td>
                    <StatusBadge status={m.status} />
                  </td>
                  <td>
                    {m.findings.map((f) => `${f.id} ${findingLabel(data.catalog, f.id)} (${pct(f.confidence)})`).join(", ") || <span class="muted">none</span>}
                    {m.notSureCount > 0 && <span class="ask"> · {m.notSureCount} not sure</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
