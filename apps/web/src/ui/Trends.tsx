import type { Catalog, MonthMessage } from "@echo/core";
import { findingLabel } from "../lib/assets.ts";
import { formatMonth } from "./common.tsx";

/**
 * Tendances par constat, mois par mois : tableau (les nombres sont le contenu) + barre fine pour l'œil.
 * La polarité est portée par le texte (colonne « kind ») ; la couleur ne fait que la redoubler.
 */
export function Trends({
  catalog,
  months,
  messages,
  liveMonth,
}: {
  catalog: Catalog;
  months: string[];
  messages: readonly MonthMessage[];
  /** Mois dont les messages viennent de la démo en direct (les autres sont synthétiques). */
  liveMonth?: string;
}) {
  const counted = messages.filter((m) => m.status !== "duplicate" && m.status !== "inaudible");
  const n = new Map(months.map((mo) => [mo, counted.filter((m) => m.month === mo).length]));
  const k = (id: string, mo: string) => counted.filter((m) => m.month === mo && m.findings.includes(id as never)).length;
  const rows = catalog.findings.filter((f) => months.some((mo) => k(f.id, mo) > 0));
  return (
    <div class="scroll-x" data-testid="trends">
      <table>
        <thead>
          <tr>
            <th>Finding</th>
            <th>Kind</th>
            {months.map((mo) => (
              <th key={mo}>
                {formatMonth(mo)}
                <br />
                {mo === liveMonth ? <span class="badge ok">live demo</span> : <span class="badge synthetic">synthetic</span>}
                <br />
                <span class="muted">n = {n.get(mo)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((f) => (
            <tr key={f.id}>
              <td>
                {f.id} {findingLabel(catalog, f.id)}
              </td>
              <td class="muted">{f.polarity === "negative" ? "to fix" : "liked"}</td>
              {months.map((mo) => {
                const c = k(f.id, mo);
                const total = n.get(mo) ?? 0;
                return (
                  <td key={mo} title={`${f.labels.en}: ${c} of ${total} messages in ${formatMonth(mo)}`}>
                    {c > 0 ? (
                      <>
                        <span class={`bar ${f.polarity === "negative" ? "negative" : ""}`} style={{ width: `${Math.max(4, (c / Math.max(1, total)) * 60)}px` }} />{" "}
                        {c}/{total}
                      </>
                    ) : (
                      <span class="muted">·</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
