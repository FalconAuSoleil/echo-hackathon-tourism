import { describe, expect, it } from "vitest";
import catalogJson from "../../../catalog/catalog.json" with { type: "json" };
import { validateCatalog, type Catalog } from "./catalog.ts";
import { buildMonthlyRecap, findingStreak, previousMonth, RecapError, type MonthMessage, type Recap } from "./recap.ts";
import { testCatalog } from "./test-fixtures.ts";
import { escapeRegExp } from "./text.ts";
import type { FindingId, MessageStatus } from "./types.ts";

const catalog = testCatalog();
let seq = 0;
const msg = (month: string, findings: FindingId[], notSureCount = 0, status: MessageStatus = "analyzed"): MonthMessage => ({
  id: `m${seq++}`,
  month,
  status,
  findings,
  notSureCount,
});
const ids = (r: Recap) => r.lines.map((l) => l.templateId);

/**
 * Vérifie qu'une ligne n'est faite QUE de texte figé du catalogue et de chiffres : le texte doit être
 * exactement le modèle, chaque {n}/{k}/{x}/{p} remplacé par des chiffres et {finding} par une phrase
 * figée d'un constat.
 */
function assertOnlyCatalogTextAndDigits(rw: string, cat: Catalog): void {
  const findingAlt = cat.findings.map((f) => escapeRegExp(f.kinyarwanda!.rw)).join("|");
  const patterns = cat.templates.map(
    (t) =>
      new RegExp(
        `^${t.kinyarwanda.rw
          .split(/(\{(?:n|k|x|p|finding)\})/)
          .map((part) => (part === "{finding}" ? `(?:${findingAlt})` : /^\{[nkxp]\}$/.test(part) ? "\\d+" : escapeRegExp(part)))
          .join("")}$`,
        "u",
      ),
  );
  if (!patterns.some((re) => re.test(rw))) throw new Error(`recap line is not catalog text + digits: ${rw}`);
}

describe("buildMonthlyRecap (SPEC 4.6)", () => {
  it("mois sans message : une seule ligne « pas de retour ce mois-ci »", () => {
    const r = buildMonthlyRecap({ month: "2026-10", messages: [msg("2026-09", ["N1"])], recurringUnknownVisitors: 0 }, catalog);
    expect(ids(r)).toEqual(["no_feedback"]);
    expect(r.lines[0]!.fr).toBe("Pas de retour ce mois-ci.");
  });

  it("volume, à garder (positif le plus cité, k sur n), à corriger (≥ 2 mentions)", () => {
    const messages = [
      msg("2026-10", ["P1", "N1"]),
      msg("2026-10", ["P1", "P4", "N1"]),
      msg("2026-10", ["P4", "P1"]),
      msg("2026-10", ["N2"]),
    ];
    const r = buildMonthlyRecap({ month: "2026-10", messages, recurringUnknownVisitors: 0 }, catalog);
    expect(ids(r)).toEqual(["volume", "keep", "fix"]);
    expect(r.lines[0]!.slots).toEqual({ n: 4 });
    expect(r.lines[1]).toMatchObject({ findingId: "P1", slots: { k: 3, n: 4 } });
    expect(r.lines[2]).toMatchObject({ findingId: "N1", slots: { k: 2, n: 4 } });
    expect(r.lines[1]!.rw).toBe("Mukomeze: ingingo p1 nziza (3 kuri 4).");
    expect(r.lines[1]!.en).toBe("Keep doing: warm welcome (3 out of 4).");
  });

  it("une seule mention, premier mois → « rien d'urgent à corriger »", () => {
    const r = buildMonthlyRecap({ month: "2026-10", messages: [msg("2026-10", ["P1"]), msg("2026-10", ["N3"])], recurringUnknownVisitors: 0 }, catalog);
    expect(ids(r)).toEqual(["volume", "keep", "nothing_urgent"]);
  });

  it("une seule mention mais 2 mois de suite → à corriger, avec « {x}e mois de suite »", () => {
    const messages = [msg("2026-08", ["N9"]), msg("2026-09", ["N9"]), msg("2026-10", ["N9"]), msg("2026-10", ["P2"])];
    const r = buildMonthlyRecap({ month: "2026-10", messages, recurringUnknownVisitors: 0 }, catalog);
    expect(r.lines[2]).toMatchObject({ templateId: "fix_streak", findingId: "N9", slots: { k: 1, n: 2, x: 3 } });
  });

  it("un mois sans mention casse la série", () => {
    const messages = [msg("2026-08", ["N9"]), msg("2026-09", ["P1"]), msg("2026-10", ["N9"])];
    expect(findingStreak("N9", "2026-10", messages)).toBe(1);
    expect(ids(buildMonthlyRecap({ month: "2026-10", messages, recurringUnknownVisitors: 0 }, catalog))).toEqual(["volume", "nothing_urgent"]);
  });

  it("égalité : le constat qui revient depuis le plus de mois l'emporte", () => {
    const messages = [
      msg("2026-09", ["N7"]),
      msg("2026-10", ["N2"]),
      msg("2026-10", ["N2"]),
      msg("2026-10", ["N7"]),
      msg("2026-10", ["N7"]),
    ];
    const r = buildMonthlyRecap({ month: "2026-10", messages, recurringUnknownVisitors: 0 }, catalog);
    expect(r.lines.find((l) => l.templateId.startsWith("fix"))).toMatchObject({ templateId: "fix_streak", findingId: "N7", slots: { k: 2, x: 2 } });
  });

  it("égalité au positif aussi tranchée par la série, puis l'ordre du catalogue", () => {
    const r1 = buildMonthlyRecap({ month: "2026-10", messages: [msg("2026-09", ["P7"]), msg("2026-10", ["P2"]), msg("2026-10", ["P7"])], recurringUnknownVisitors: 0 }, catalog);
    expect(r1.lines[1]!.findingId).toBe("P7");
    const r2 = buildMonthlyRecap({ month: "2026-10", messages: [msg("2026-10", ["P7"]), msg("2026-10", ["P2"])], recurringUnknownVisitors: 0 }, catalog);
    expect(r2.lines[1]!.findingId).toBe("P2");
  });

  it("sujet inconnu qui revient et remarques pas comprises : 5 lignes au plus", () => {
    const messages = [msg("2026-10", ["P1", "N1"], 1), msg("2026-10", ["P1", "N1"], 2), msg("2026-10", [], 1, "not_sure")];
    const r = buildMonthlyRecap({ month: "2026-10", messages, recurringUnknownVisitors: 3 }, catalog);
    expect(ids(r)).toEqual(["volume", "keep", "fix", "unknown_topic", "not_understood"]);
    expect(r.lines[3]!.slots).toEqual({ k: 3 });
    expect(r.lines[4]!.slots).toEqual({ p: 4 });
    expect(r.lines[0]!.slots).toEqual({ n: 3 }); // un message « pas sûr » est un retour reçu
  });

  it("doublons et inaudibles ne comptent ni dans n ni dans k", () => {
    const messages = [msg("2026-10", ["N1"]), msg("2026-10", ["N1"], 0, "duplicate"), msg("2026-10", [], 0, "inaudible")];
    const r = buildMonthlyRecap({ month: "2026-10", messages, recurringUnknownVisitors: 0 }, catalog);
    expect(r.lines[0]!.slots).toEqual({ n: 1 });
    expect(ids(r)).toEqual(["volume", "nothing_urgent"]);
  });

  it("audio : parties fixes, clips des nombres et du constat dans l'ordre ; clips manquants signalés", () => {
    const withAudio = testCatalog({ audioParts: true, numbers: true });
    const r = buildMonthlyRecap({ month: "2026-10", messages: [msg("2026-10", ["P1"]), msg("2026-10", ["P1"])], recurringUnknownVisitors: 0 }, withAudio);
    expect(r.lines[1]!.audio).toEqual([
      "audio/template-keep-0.wav",
      "audio/finding-P1.wav",
      "audio/template-keep-1.wav",
      "audio/num-2.wav",
      "audio/template-keep-2.wav",
      "audio/num-2.wav",
      "audio/template-keep-3.wav",
    ]);
    const noNumbers = testCatalog({ audioParts: true });
    const r2 = buildMonthlyRecap({ month: "2026-10", messages: [msg("2026-10", [])], recurringUnknownVisitors: 0 }, noNumbers);
    expect(r2.lines[0]!.missingAudio).toEqual(["number:1"]);
    const simple = buildMonthlyRecap({ month: "2026-10", messages: [msg("2026-10", ["P1"])], recurringUnknownVisitors: 0 }, catalog);
    expect(simple.lines[1]!.audio).toEqual(["audio/template-keep.wav", "audio/finding-P1.wav"]);
  });

  it("refuse de produire une ligne si le kinyarwanda figé manque (jamais de texte de secours)", () => {
    const bare = validateCatalog(JSON.parse(JSON.stringify(catalogJson)));
    if (bare.templates.every((t) => t.kinyarwanda.rw)) return; // catalogue déjà rempli
    expect(() => buildMonthlyRecap({ month: "2026-10", messages: [], recurringUnknownVisitors: 0 }, bare)).toThrow(RecapError);
  });

  it("chaque chaîne du récap n'est faite QUE de texte figé du catalogue et de chiffres (1000 mois aléatoires)", () => {
    let seed = 42;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const all = catalog.findings.map((f) => f.id);
    const months = ["2026-07", "2026-08", "2026-09", "2026-10"];
    for (let run = 0; run < 1000; run++) {
      const messages: MonthMessage[] = [];
      for (const month of months) {
        const n = Math.floor(rand() * 9);
        for (let i = 0; i < n; i++) {
          const k = Math.floor(rand() * 4);
          const fs = Array.from({ length: k }, () => all[Math.floor(rand() * all.length)]!);
          const statusRoll = rand();
          const status: MessageStatus = statusRoll < 0.1 ? "duplicate" : statusRoll < 0.2 ? "inaudible" : statusRoll < 0.3 ? "not_sure" : "analyzed";
          messages.push(msg(month, status === "analyzed" ? fs : [], Math.floor(rand() * 3), status));
        }
      }
      const r = buildMonthlyRecap({ month: "2026-10", messages, recurringUnknownVisitors: rand() < 0.3 ? 3 + Math.floor(rand() * 4) : 0 }, catalog);
      expect(r.lines.length).toBeGreaterThanOrEqual(1);
      expect(r.lines.length).toBeLessThanOrEqual(5);
      for (const line of r.lines) assertOnlyCatalogTextAndDigits(line.rw, catalog);
    }
  });

  it("le même contrôle passe sur le vrai catalogue du dépôt quand son kinyarwanda est rempli", () => {
    const real = validateCatalog(JSON.parse(JSON.stringify(catalogJson)));
    const ready = real.templates.every((t) => t.kinyarwanda.rw) && real.findings.every((f) => f.kinyarwanda?.rw);
    if (!ready) return; // pas encore généré par l'agent du catalogue
    const messages = [msg("2026-09", ["N1"]), msg("2026-10", ["P1", "N1"], 1), msg("2026-10", ["P3"]), msg("2026-10", [], 2, "not_sure")];
    const r = buildMonthlyRecap({ month: "2026-10", messages, recurringUnknownVisitors: 3 }, real);
    expect(r.lines).toHaveLength(5);
    for (const line of r.lines) assertOnlyCatalogTextAndDigits(line.rw, real);
    const empty = buildMonthlyRecap({ month: "2026-11", messages, recurringUnknownVisitors: 0 }, real);
    for (const line of empty.lines) assertOnlyCatalogTextAndDigits(line.rw, real);
  });

  it("le contrôle rejette bien un texte libre", () => {
    expect(() => assertOnlyCatalogTextAndDigits("Uku kwezi: ibitekerezo cinq.", catalog)).toThrow();
    expect(() => assertOnlyCatalogTextAndDigits("Uku kwezi: ibitekerezo 5.", catalog)).not.toThrow();
  });

  it("previousMonth franchit les années", () => {
    expect(previousMonth("2026-01")).toBe("2025-12");
    expect(previousMonth("2026-10")).toBe("2026-09");
  });
});
