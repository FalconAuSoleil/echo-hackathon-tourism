// Diagnostic : où se perdent les remarques sur la moitié CALIBRATION, avec la configuration livrée.
// Usage : cd eval && npx tsx src/experiments/diagnose.ts [--json out.json]
import { writeFileSync } from "node:fs";
import { words } from "@echo/core";
import { aligned } from "../lib/metrics.ts";
import { decide } from "../lib/system.ts";
import { DEFAULT_CONFIG, calibrationSplit, getEmbedder, loadCatalog, measure, prepare } from "./common.ts";

const cal = calibrationSplit();
const catalog = loadCatalog();
const cfg = { ...DEFAULT_CONFIG, ...(JSON.parse(process.env.CFG ?? "{}") as Partial<typeof DEFAULT_CONFIG>) };
const { prepared } = await prepare(cal, catalog, await getEmbedder("minilm"), cfg);
const s = measure(cal, prepared, cfg);
console.log(`calibration ${cal.length} feedbacks; shipped config: capture ${s.captureRate} err ${s.acceptedErrorRate} notSure ${s.notSureRate} accepted ${s.accepted}`);

const cats: Record<string, number> = {};
const bump = (k: string) => (cats[k] = (cats[k] ?? 0) + 1);
const byLang: Record<string, Record<string, number>> = {};
const byFinding: Record<string, { total: number; captured: number }> = {};
const rows: unknown[] = [];
let total = 0;
for (const f of cal) {
  const p = prepared.get(f.id)!;
  const out = decide(p, cfg);
  const a = p.analysis;
  const spanWords = f.chunks.map((c) => words(c.span));
  const chunkWords = out.chunks.map((c) => words(c.text));
  for (const [j, span] of f.chunks.entries()) {
    if (span.kind !== "finding") continue;
    total++;
    const fid = span.finding!;
    byFinding[fid] ??= { total: 0, captured: 0 };
    byFinding[fid].total++;
    const idx = out.chunks.map((_, i) => i).filter((i) => aligned(chunkWords[i]!, spanWords[j]!));
    let cat: string;
    let detail: Record<string, unknown> = {};
    if (idx.some((i) => out.chunks[i]!.findings.includes(fid))) {
      cat = "captured";
      byFinding[fid].captured++;
    } else if (a.status === "not_sure") cat = `message_not_sure:${a.reason}`;
    else if (idx.length === 0) cat = "no_aligned_chunk";
    else {
      // Morceau principal : celui qui partage le plus de mots avec le passage.
      const i = idx[0]!;
      const c = out.chunks[i]!;
      const raw = p.raw[i]!;
      const byP = [...raw].sort((x, y) => (y.probability ?? 0) - (x.probability ?? 0));
      const rank = byP.findIndex((r) => r.id === fid) + 1;
      const pr = raw.find((r) => r.id === fid)!;
      // Le morceau couvre-t-il aussi un autre passage annoté (découpage trop large) ?
      const otherSpans = f.chunks.filter((sp, k) => k !== j && aligned(chunkWords[i]!, spanWords[k]!));
      const merged = otherSpans.length > 0;
      const mergedTag = merged ? `merged(${otherSpans.map((o) => o.kind === "finding" ? "finding" : o.kind).join("+")})` : "single";
      detail = { rank, prob: Number(pr.probability?.toFixed(3)), top: byP[0]!.id, topP: Number(byP[0]!.probability?.toFixed(3)), agree: Number(pr.agree.toFixed(3)), inverted: Number(pr.inverted.toFixed(3)), merged: mergedTag, negation: a.chunks[i]!.negation };
      if (c.findings.length > 0) {
        cat = c.findings.length >= 2 && rank <= 3 ? "wrong_finding(two_cap)" : `wrong_finding(${rank === 2 ? "correct_2nd" : "correct_lower"})`;
      } else if (c.status === "off_list") cat = `off_list_below_floor(${rank === 1 ? "correct_top1" : "correct_not_top1"})`;
      else if (c.reason === "negation_uncertain") cat = "not_sure:negation_uncertain";
      else if (c.reason === "negation") cat = `not_sure:negation(${a.chunks[i]!.negation.negated ? "chunk_negated" : "chunk_plain"})`;
      else cat = `not_sure:below_threshold(${rank === 1 ? (pr.probability! >= 0.5 ? "top1_p>=0.5" : "top1_p<0.5") : "correct_not_top1"})`;
      cat = `${cat}|${mergedTag}`;
    }
    bump(cat);
    byLang[f.lang] ??= {};
    const short = cat.split("|")[0]!.replace(/\(.*$/, "");
    byLang[f.lang]![short] = (byLang[f.lang]![short] ?? 0) + 1;
    rows.push({ id: f.id, lang: f.lang, finding: fid, span: span.span, cat, ...detail, chunks: idx.map((i) => out.chunks[i]!.text) });
  }
}
console.log(`remarks ${total}`);
for (const [k, v] of Object.entries(cats).sort((a, b) => b[1] - a[1])) console.log(`${String(v).padStart(4)}  ${(100 * v / total).toFixed(1)} %  ${k}`);
console.log("by lang", JSON.stringify(byLang));
console.log("by finding", JSON.stringify(byFinding));
// Langue détectée
const langWrong = cal.filter((f) => prepared.get(f.id)!.analysis.lang !== f.lang).map((f) => `${f.id}:${f.lang}->${prepared.get(f.id)!.analysis.lang}`);
console.log("language detection wrong/unknown:", langWrong.length, langWrong.join(" "));
const out = process.argv.indexOf("--json");
if (out > 0) writeFileSync(process.argv[out + 1]!, JSON.stringify({ cats, byLang, byFinding, rows, langWrong }, null, 1));
