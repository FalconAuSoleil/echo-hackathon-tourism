// Balayages rapides sur la calibration : seuil, plancher, L2 (configuration livrée sinon).
import { DEFAULT_CONFIG, calibrationSplit, fmtPoint, getEmbedder, loadCatalog, makeConfig, prepare, sweepBest } from "./common.ts";

const cal = calibrationSplit();
const catalog = loadCatalog();
const embed = await getEmbedder(process.argv[2] ?? "minilm");
for (const l2 of [1e-3, 3e-4, 1e-4, 3e-5, 1e-5]) {
  const base = makeConfig({ ...DEFAULT_CONFIG, linearL2: l2 });
  const { prepared } = await prepare(cal, catalog, embed, base);
  for (const floor of [0, 0.3, 0.4, 0.45, 0.5, 0.55, 0.59]) {
    const r = sweepBest(cal, prepared, { ...base, offListThreshold: floor });
    console.log(`l2=${l2} floor=${floor} | 5%: ${fmtPoint(r.at5)} | 8%: ${fmtPoint(r.at8)} | 10%: ${fmtPoint(r.at10)}`);
  }
}
