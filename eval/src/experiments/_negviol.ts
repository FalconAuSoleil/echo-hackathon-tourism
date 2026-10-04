import { words } from "@echo/core";
import { aligned } from "../lib/metrics.ts";
import { decide, withAccept } from "../lib/system.ts";
import { DEFAULT_CONFIG, calibrationSplit, getEmbedder, loadCatalog, prepare } from "./common.ts";
const cal = calibrationSplit();
const cfg = { ...DEFAULT_CONFIG, acceptProbability: Number(process.argv[2] ?? 0.78) };
const { prepared } = await prepare(cal, loadCatalog(), await getEmbedder("minilm"), cfg);
for (const f of cal) {
  const out = decide(prepared.get(f.id)!, withAccept(cfg, cfg.acceptProbability));
  for (const sp of f.chunks) if (sp.kind === "negated" && sp.negates) {
    const hit = out.chunks.filter((c) => aligned(words(c.text), words(sp.span)) && c.findings.includes(sp.negates!));
    const p = prepared.get(f.id)!;
    if (hit.length) { const i = out.chunks.indexOf(hit[0]!); const r = p.raw[i]!.find((x) => x.id === sp.negates)!; console.log("VIOLATION", f.id, sp.negates, JSON.stringify(sp.span), "| chunk:", hit[0]!.text, "| neg", JSON.stringify(p.analysis.chunks[i]!.negation.cues), "agree", r.agree.toFixed(3), "inv", r.inverted.toFixed(3), "p", r.probability?.toFixed(3)); }
  }
}
