import type { OffListCluster, ReviewChunk } from "@echo/core";
import { reasonText } from "./MessageResult.tsx";

function Item({ c }: { c: ReviewChunk }) {
  return (
    <li class={`chunk ${c.status}`} data-testid="review-item">
      <div class="text">“{c.text}”</div>
      <div class="meta">
        {c.status === "not_sure" ? <span class="ask">Not sure: ask a person</span> : <span class="muted">Off-list</span>}
        {c.reason && <span class="muted">({reasonText(c.reason)})</span>}
        {c.mentionsGuide && <span class="badge plain">about the guide: host only</span>}
        {c.synthetic && <span class="badge synthetic">synthetic</span>}
      </div>
      {c.englishMT && c.englishMT.trim() !== c.text.trim() && (
        <div style={{ marginTop: "0.3rem", fontSize: "0.88rem" }}>
          <span class="badge mt">machine translation, to be checked</span> <span class="muted">English, whole message (Whisper):</span> {c.englishMT}
        </div>
      )}
    </li>
  );
}

/** Liste en lecture seule « À faire lire par une personne » (SPEC 4.4, 4.5). L'outil ne tranche jamais. */
export function ReviewList({ chunks, recurring }: { chunks: readonly ReviewChunk[]; recurring: readonly OffListCluster[] }) {
  const inCluster = new Set(recurring.flatMap((c) => c.chunkIds));
  const byId = new Map(chunks.map((c) => [c.id, c]));
  const rest = chunks.filter((c) => !inCluster.has(c.id));
  const notSure = rest.filter((c) => c.status === "not_sure");
  const off = rest.filter((c) => c.status === "off_list");
  return (
    <section class="card" data-testid="review-list">
      <h2>To be read by a person</h2>
      <p class="muted" style={{ fontSize: "0.85rem" }}>
        Read-only. Remarks the tool did not understand or does not know. The guide, the host's daughter or someone from the cooperative
        can read them; the tool never decides for them.
      </p>
      {chunks.length === 0 && <p class="muted">Nothing to read yet.</p>}
      {recurring.map((cl) => (
        <div key={cl.id} class="notice warn" data-testid="recurring-topic">
          <strong>A topic the tool does not know comes back from {cl.distinctVisitors} visitors: ask a person to read these remarks.</strong>
          <span class="muted"> Echo does not name it: it has no validated sentence for it.</span>
          <ul class="chunks">
            {cl.chunkIds.map((id) => byId.get(id)).filter((c): c is ReviewChunk => !!c).map((c) => (
              <Item key={c.id} c={c} />
            ))}
          </ul>
        </div>
      ))}
      {notSure.length > 0 && (
        <>
          <h3>Not sure</h3>
          <ul class="chunks">
            {notSure.map((c) => (
              <Item key={c.id} c={c} />
            ))}
          </ul>
        </>
      )}
      {off.length > 0 && (
        <>
          <h3>Off-list</h3>
          <ul class="chunks">
            {off.map((c) => (
              <Item key={c.id} c={c} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
