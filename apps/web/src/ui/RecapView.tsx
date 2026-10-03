import { useState } from "preact/hooks";
import { gsm7Length, smsUri } from "@echo/core";
import type { MonthReport } from "../lib/recap-service.ts";
import { playClips, stopPlayback } from "../lib/audio.ts";
import { formatMonth } from "./common.tsx";

export function RecapView({
  report,
  glosses,
  phone,
  onPhoneChange,
  onSmsOpened,
  title,
}: {
  report: MonthReport;
  /** Afficher les gloses FR/EN (phrases sources figées) à côté du kinyarwanda. */
  glosses: boolean;
  phone: string;
  onPhoneChange?: (p: string) => void;
  onSmsOpened?: () => void;
  title?: string;
}) {
  const [playing, setPlaying] = useState(false);
  const [err, setErr] = useState("");
  const { recap, sms } = report;
  const missing = recap.lines.flatMap((l) => l.missingAudio);
  const listen = async () => {
    setErr("");
    if (playing) {
      stopPlayback();
      setPlaying(false);
      return;
    }
    try {
      setPlaying(true);
      await playClips(
        recap.lines.map((l) => l.audio),
        "/catalog/",
        () => setPlaying(false),
      );
    } catch (e) {
      setPlaying(false);
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <section class="card" data-testid="recap">
      <h2>{title ?? `Monthly recap, ${formatMonth(recap.month)}`}</h2>
      <p class="muted" style={{ fontSize: "0.85rem" }}>
        Built only from frozen Kinyarwanda sentences of the catalog, with numbers in the slots. Nothing is translated or generated on
        the phone. Kinyarwanda: machine translation (NLLB-200), checked by back-translation, <strong>not yet validated by a speaker</strong>.
      </p>
      <div class="recap">
        {recap.lines.map((l, i) => (
          <div class="recap-line" key={i} data-testid="recap-line" data-template={l.templateId}>
            <div class="rw" lang="rw">
              {l.rw}
            </div>
            {glosses && (
              <>
                <div class="gloss" lang="fr">
                  <b>FR</b>
                  {l.fr}
                </div>
                <div class="gloss" lang="en">
                  <b>EN</b>
                  {l.en}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
      <div class="row" style={{ marginTop: "0.6rem" }}>
        <button onClick={listen} data-testid="listen">
          {playing ? "Stop" : "Listen (Kinyarwanda)"}
        </button>
        <small class="muted">Pre-recorded clips (MMS-TTS synthetic voice) played one after the other.</small>
      </div>
      {missing.length > 0 && <p class="muted">Audio incomplete for: {missing.join(", ")} (the digits are still shown).</p>}
      {err && <p class="error">{err}</p>}

      <h3 style={{ marginTop: "0.9rem" }}>Send by SMS to the host's basic phone</h3>
      <p class="muted" style={{ fontSize: "0.85rem" }}>
        Opens this phone's SMS app with the recap already written. A person checks it and presses Send: it goes through the SIM card,
        no internet needed. {sms.length > 1 ? `${sms.length} SMS of at most 160 characters.` : "One SMS of at most 160 characters."}
      </p>
      {onPhoneChange && (
        <label class="field">
          <span>Host's phone number</span>
          <input type="tel" value={phone} placeholder="+250 7xx xxx xxx" onInput={(e) => onPhoneChange((e.target as HTMLInputElement).value)} />
        </label>
      )}
      {sms.map((part, i) => (
        <div key={i} style={{ marginBottom: "0.5rem" }} data-testid="sms-part">
          <div class="sms">{part}</div>
          <div class="row" style={{ marginTop: "0.3rem" }}>
            <a
              class={`btn ${phone.trim() ? "" : "secondary"}`}
              href={smsUri(phone.trim(), part)}
              onClick={(e) => {
                if (!phone.trim()) {
                  e.preventDefault();
                  setErr("Enter the host's phone number first.");
                  return;
                }
                onSmsOpened?.();
              }}
            >
              Send SMS {sms.length > 1 ? `${i + 1}/${sms.length}` : ""}
            </a>
            <small class="muted">{gsm7Length(part)} / 160 GSM characters</small>
          </div>
        </div>
      ))}
    </section>
  );
}
