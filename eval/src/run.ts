// Point d'entrée unique de l'évaluation (SPEC 9) : `pnpm eval`.
//   pnpm eval                       # tout : niveaux 1, 2, 3, performances, puis RESULTS.md
//   pnpm eval -- --level 2          # un seul niveau (répétable : --level 2 --level 3), aussi perf, report
//   pnpm eval -- --level pii --level report   # contrôle du nettoyage des noms/numéros seul (sans modèle)
//   pnpm eval -- --whisper tiny,base,small   --fleurs-limit 20   --quick
// Mêmes modèles (@echo/models) et même code (@echo/core) que l'app. Les sorties brutes (transcriptions
// en cache) vont dans eval/results/raw/ (git-ignoré) : relancer reprend là où l'on s'était arrêté.
import { parseArgs } from "node:util";
import { runLevel1 } from "./level1.ts";

// `pnpm eval -- --level 2` transmet le « -- » tel quel : on le retire, sinon tout devient positionnel.
const argv = process.argv.slice(2).filter((a, i) => !(i === 0 && a === "--"));
const { values } = parseArgs({
  args: argv,
  options: {
    level: { type: "string", multiple: true },
    whisper: { type: "string" },
    "fleurs-limit": { type: "string" },
    quick: { type: "boolean", default: false },
    "small-limit": { type: "string" },
    "app-whisper": { type: "string" },
  },
  allowPositionals: true,
});

const levels = new Set(values.level?.length ? values.level.flatMap((l) => l.split(",")) : ["1", "2", "3", "perf", "report"]);
const sizes = (values.whisper ?? "tiny,base,small").split(",");
const log = (s: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${s}`);

// whisper-small : 50 énoncés par langue par défaut (RTF ≈ 1,4 ici, 100 × 5 langues prendraient > 2 h).
if (levels.has("1"))
  await runLevel1({
    sizes,
    limit: values["fleurs-limit"] ? Number(values["fleurs-limit"]) : undefined,
    limits: { small: Number(values["small-limit"] ?? values["fleurs-limit"] ?? 50) },
    log,
  });
// Contrôle du nettoyage des données personnelles (niveau 2, rapide, sans modèle) : aussi seul avec --level pii.
if (levels.has("2") || levels.has("pii")) {
  const { runPii } = await import("./pii.ts");
  runPii({ log });
}
if (levels.has("2")) {
  const { runLevel2 } = await import("./level2.ts");
  await runLevel2({ log, variants: values.quick ? ["similarity-minilm-max", "linear-minilm-l2=3e-4"] : undefined });
}
if (levels.has("3")) {
  const { runLevel3 } = await import("./level3.ts");
  await runLevel3({ sizes, log });
}
if (levels.has("perf")) {
  const { runPerf } = await import("./perf.ts");
  await runPerf({ sizes, log, appWhisper: values["app-whisper"] ?? "base" });
}
if (levels.has("report")) {
  const { runReport } = await import("./report.ts");
  runReport(log);
}
