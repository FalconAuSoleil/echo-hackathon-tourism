import { useEffect, useMemo, useState } from "preact/hooks";
import { aggregateCooperative, type CoopFarmInput } from "@echo/core";
import { findingLabel, type StaticData } from "../lib/assets.ts";
import { host, refresh } from "../lib/host-store.ts";
import { addMonths, currentMonth } from "../lib/recap-service.ts";
import { SYNTHETIC_FARM_COUNT, syntheticCoopFarms } from "../lib/synthetic.ts";
import { Synthetic, formatMonth } from "../ui/common.tsx";

export function Coop({ data }: { data: StaticData }) {
  const st = host.use();
  useEffect(() => void refresh(), []);
  const month = currentMonth();
  const periods = [
    { key: "3m", label: "Last 3 months", months: [addMonths(month, -2), addMonths(month, -1), month] },
    { key: "1m", label: formatMonth(month), months: [month] },
  ];
  const [period, setPeriod] = useState("3m");
  const months = periods.find((p) => p.key === period)!.months;
  const agg = useMemo(() => {
    // Seuls les identifiants de constats « hors guide » (coopFindings) entrent ici : jamais de texte.
    const own: CoopFarmInput = {
      farmId: "this-farm",
      consent: st.settings.coopConsent,
      messages: st.messages.map((m) => ({ month: m.month, status: m.status, coopFindings: m.coopFindings })),
    };
    return aggregateCooperative([...syntheticCoopFarms(month), own], data.catalog, { months });
  }, [st.messages, st.settings.coopConsent, period]);
  const positives = agg.findings.filter((f) => f.polarity === "positive");
  const negatives = agg.findings.filter((f) => f.polarity === "negative");
  const row = (f: (typeof agg.findings)[number]) => (
    <tr key={f.id}>
      <td>
        <strong>
          {f.farms} farm{f.farms > 1 ? "s" : ""} out of {agg.consentingFarms}
        </strong>
      </td>
      <td>
        {f.id} {findingLabel(data.catalog, f.id)}
        {f.polarity === "positive" && f.farms >= Math.ceil(agg.consentingFarms * 0.75) && <span class="badge ok"> liked almost everywhere: an offer to build on</span>}
      </td>
      <td class="muted">{f.mentions} mentions</td>
    </tr>
  );
  return (
    <>
      <section class="card">
        <h1 style={{ fontSize: "1.3rem" }}>Cooperative view</h1>
        <p class="notice">
          <strong>Demo data: {SYNTHETIC_FARM_COUNT} synthetic farms</strong> (generated, not real farms). This farm is added only if its host
          turned on sharing in Settings ({st.settings.coopConsent ? <strong>currently on</strong> : <strong>currently off</strong>}). In a real deployment
          each consenting farm would hand over only these numbers; nothing is sent anywhere in this prototype.
        </p>
        <p class="muted" style={{ fontSize: "0.85rem" }}>
          Anonymous counts per finding. Remarks about the guide stay with the host and are never counted here. Not-sure remarks are never
          counted.
        </p>
        <div class="row">
          {periods.map((p) => (
            <button key={p.key} class={p.key === period ? "" : "secondary"} onClick={() => setPeriod(p.key)}>
              {p.label}
            </button>
          ))}
        </div>
      </section>
      <section class="card" data-testid="coop">
        <h2>
          What visitors liked <Synthetic />
        </h2>
        <table>
          <tbody>{positives.map(row)}</tbody>
        </table>
        <h2 style={{ marginTop: "0.8rem" }}>
          What to fix <Synthetic />
        </h2>
        <table>
          <tbody>{negatives.map(row)}</tbody>
        </table>
        <p class="muted" style={{ fontSize: "0.82rem" }}>
          {agg.messages} messages from {agg.consentingFarms} consenting farms.
        </p>
      </section>
    </>
  );
}
