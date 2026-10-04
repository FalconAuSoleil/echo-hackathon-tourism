import { useEffect, useState } from "preact/hooks";
import { db, host, refresh, updateSettings } from "../lib/host-store.ts";
import { wipeAll } from "../lib/db.ts";
import { hashPin, isValidPin } from "../lib/pin.ts";
import { mb } from "../ui/common.tsx";
import { analysis, memoryPreference, setMemoryPreference, type MemoryPreference } from "../lib/worker-client.ts";

export function SettingsPage() {
  const st = host.use();
  const s = st.settings;
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [msg, setMsg] = useState("");
  const [memPref, setMemPref] = useState<MemoryPreference>(memoryPreference());
  const [storage, setStorage] = useState<{ usage?: number; quota?: number; persisted?: boolean }>({});
  useEffect(() => {
    void refresh();
    void (async () => {
      const est = (await navigator.storage?.estimate?.()) ?? {};
      const persisted = (await navigator.storage?.persisted?.()) ?? false;
      setStorage({ usage: est.usage, quota: est.quota, persisted });
    })();
  }, []);

  const setNewPin = async () => {
    if (!isValidPin(pin)) return setMsg("The PIN must be 4 to 8 digits.");
    if (pin !== pin2) return setMsg("The two PINs differ.");
    await updateSettings({ pin: await hashPin(pin) });
    setPin("");
    setPin2("");
    setMsg("PIN set. Echo asks for it when the host app is opened.");
  };

  return (
    <>
      <section class="card">
        <h2>Farm and phones</h2>
        <label class="field">
          <span>Farm name (shown on the visitor card)</span>
          <input type="text" value={s.farmName} onChange={(e) => void updateSettings({ farmName: (e.target as HTMLInputElement).value })} />
        </label>
        <label class="field">
          <span>Farm's WhatsApp number (printed on the visitor card)</span>
          <input type="tel" value={s.farmPhone} onChange={(e) => void updateSettings({ farmPhone: (e.target as HTMLInputElement).value })} />
        </label>
        <label class="field">
          <span>Host's own phone number (receives the recap by SMS)</span>
          <input type="tel" value={s.hostPhone} onChange={(e) => void updateSettings({ hostPhone: (e.target as HTMLInputElement).value })} data-testid="host-phone" />
        </label>
        <fieldset style={{ border: "none", padding: 0 }}>
          <legend class="muted" style={{ fontSize: "0.9rem" }}>
            Who uses this phone?
          </legend>
          <label class="row">
            <input type="radio" name="mode" checked={s.mode === "A"} onChange={() => void updateSettings({ mode: "A" })} data-testid="mode-a" />
            Mode A: the host's own Android phone
          </label>
          <label class="row">
            <input type="radio" name="mode" checked={s.mode === "B"} onChange={() => void updateSettings({ mode: "B" })} />
            Mode B: the household smartphone; the host has a basic phone and gets the recap by SMS
          </label>
        </fieldset>
      </section>

      <section class="card">
        <h2>PIN lock (shared phone)</h2>
        <p class="muted" style={{ fontSize: "0.88rem" }}>
          Optional. Only a salted PBKDF2 hash of the PIN is kept on the phone. The "Try it" demo stays open; the host's messages are locked.
        </p>
        {s.pin ? (
          <button class="danger" onClick={() => void updateSettings({ pin: undefined }).then(() => setMsg("PIN removed."))}>
            Remove the PIN
          </button>
        ) : (
          <>
            <div class="grid2">
              <input type="password" inputMode="numeric" placeholder="New PIN (4 to 8 digits)" value={pin} onInput={(e) => setPin((e.target as HTMLInputElement).value)} />
              <input type="password" inputMode="numeric" placeholder="Repeat the PIN" value={pin2} onInput={(e) => setPin2((e.target as HTMLInputElement).value)} />
            </div>
            <p>
              <button onClick={() => void setNewPin()}>Set PIN</button>
            </p>
          </>
        )}
        {msg && <p>{msg}</p>}
      </section>

      <section class="card">
        <h2>Cooperative</h2>
        <label class="row">
          <input
            type="checkbox"
            checked={s.coopConsent}
            onChange={(e) => void updateSettings({ coopConsent: (e.target as HTMLInputElement).checked })}
            data-testid="coop-consent"
          />
          Share this farm's anonymous numbers per finding with the cooperative
        </label>
        <p class="muted" style={{ fontSize: "0.85rem" }}>
          Only counts per finding leave this view, never text, audio or dates of single messages. Remarks about the guide are never
          included. Off by default; can be turned off at any time. In this prototype nothing is actually sent anywhere: the{" "}
          <a href="#/coop">cooperative view</a> runs on this phone with synthetic farms.
        </p>
      </section>

      <section class="card">
        <h2>Memory</h2>
        <p class="muted" style={{ fontSize: "0.88rem" }}>
          On a phone with 2 GB of memory, Whisper and the similarity model do not fit together: Echo then loads one model at a time
          (all voice messages are transcribed first, then analysed). Automatic uses what the browser reports
          {typeof (navigator as { deviceMemory?: number }).deviceMemory === "number" ? ` (${(navigator as { deviceMemory?: number }).deviceMemory} GB here)` : " (not reported here: both models stay loaded)"}.
          Now: <strong>{analysis.memory === "one_model_at_a_time" ? "one model at a time" : "both models loaded"}</strong>.
        </p>
        <label class="field">
          <span>Memory use (applies after reopening Echo)</span>
          <select
            value={memPref}
            onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value as MemoryPreference;
              setMemoryPreference(v);
              setMemPref(v);
            }}
            data-testid="memory-pref"
          >
            <option value="auto">Automatic</option>
            <option value="low">One model at a time (slower, for 2 GB phones)</option>
            <option value="normal">Keep both models loaded (faster)</option>
          </select>
        </label>
      </section>

      <section class="card">
        <h2>Data on this phone</h2>
        <p class="muted" style={{ fontSize: "0.88rem" }}>
          {st.messages.length} message records, {st.review.length} remarks to be read, {st.queue.length} waiting in the queue.
          {storage.usage !== undefined && ` Browser storage used: ${mb(storage.usage)} (models included).`}
          {storage.persisted ? " Storage is persistent." : ""}
        </p>
        <div class="row">
          {!storage.persisted && navigator.storage?.persist && (
            <button class="secondary" onClick={() => void navigator.storage.persist().then((p) => setStorage({ ...storage, persisted: p }))}>
              Keep models and data (persistent storage)
            </button>
          )}
          <button
            class="danger"
            onClick={async () => {
              if (!confirm("Delete all messages, remarks and the queue from this phone?")) return;
              await wipeAll(await db());
              await refresh();
              setMsg("All messages deleted.");
            }}
          >
            Delete all messages
          </button>
        </div>
      </section>
    </>
  );
}
