// Récap mensuel (SPEC 4.6) construit UNIQUEMENT à partir des phrases kinyarwanda figées du catalogue,
// avec des chiffres dans les emplacements. Aucun autre texte n'est produit. Au plus 5 lignes :
//   1. volume  2. à garder  3. à corriger (ou « rien d'urgent »)  4. sujet inconnu  5. pas compris
// Mois sans message : une seule ligne « pas de retour ce mois-ci ».
import type { Catalog, Finding, RecapTemplate, RecapTemplateId, Slot } from "./catalog.ts";
import { fillSlots } from "./catalog.ts";
import type { FindingId, MessageStatus } from "./types.ts";

/** Résumé d'un message tel qu'il est stocké (SPEC 6). */
export interface MonthMessage {
  id: string;
  month: string;
  status: MessageStatus;
  findings: FindingId[];
  /** Nombre de morceaux « pas sûr » de ce message. */
  notSureCount: number;
}

export interface RecapInput {
  month: string; // "YYYY-MM"
  /** Messages de tous les mois connus (le mois courant et l'historique, pour « {x}e mois de suite »). */
  messages: MonthMessage[];
  /** Plus grand groupe hors liste récurrent du mois (visiteurs distincts), ou 0. */
  recurringUnknownVisitors: number;
}

export interface RecapLine {
  templateId: RecapTemplateId;
  findingId?: FindingId;
  slots: Partial<Record<Slot, number>>;
  /** Texte kinyarwanda final (phrases figées + chiffres). */
  rw: string;
  /** Gloses pour la démo (à partir des sources fr/en figées), jamais montrées à l'hôte comme traduction libre. */
  fr: string;
  en: string;
  /** Clips audio à enchaîner pour la lecture (chemins relatifs à catalog/). */
  audio: string[];
  /** Clips attendus mais absents du catalogue (la ligne s'affiche quand même, l'audio est incomplet). */
  missingAudio: string[];
}

export interface Recap {
  month: string;
  lines: RecapLine[]; // au plus 5
  /** Comptes qui ont servi au récap (affichage, tests). */
  stats: { n: number; p: number; counts: Partial<Record<FindingId, number>>; streaks: Partial<Record<FindingId, number>> };
}

export class RecapError extends Error {}

/** Mois précédent au format "YYYY-MM". */
export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

const counted = (m: MonthMessage): boolean => m.status !== "duplicate" && m.status !== "inaudible";

/** Nombre de mois consécutifs, jusqu'au mois donné inclus, où le constat est cité au moins une fois. */
export function findingStreak(id: FindingId, month: string, messages: readonly MonthMessage[]): number {
  const cited = new Set(messages.filter((m) => counted(m) && m.findings.includes(id)).map((m) => m.month));
  let streak = 0;
  for (let mo = month; cited.has(mo); mo = previousMonth(mo)) streak++;
  return streak;
}

function template(catalog: Catalog, id: RecapTemplateId): RecapTemplate {
  const t = catalog.templates.find((x) => x.id === id);
  if (!t) throw new RecapError(`template ${id} missing from catalog`);
  if (!t.kinyarwanda?.rw) throw new RecapError(`template ${id} has no frozen Kinyarwanda sentence yet`);
  return t;
}

function finding(catalog: Catalog, id: FindingId): Finding {
  const f = catalog.findings.find((x) => x.id === id);
  if (!f) throw new RecapError(`finding ${id} missing from catalog`);
  if (!f.kinyarwanda?.rw) throw new RecapError(`finding ${id} has no frozen Kinyarwanda sentence yet`);
  return f;
}

/** Une ligne : phrase figée + chiffres, gloses fr/en et suite de clips audio. */
export function renderLine(
  catalog: Catalog,
  templateId: RecapTemplateId,
  slots: Partial<Record<Exclude<Slot, "finding">, number>>,
  findingId?: FindingId,
): RecapLine {
  const t = template(catalog, templateId);
  const f = findingId ? finding(catalog, findingId) : undefined;
  for (const [k, v] of Object.entries(slots)) {
    if (!Number.isInteger(v) || (v as number) < 0) throw new RecapError(`slot {${k}} must be a non-negative integer`);
  }
  const values = (lang: "rw" | "fr" | "en"): Partial<Record<Slot, string | number>> => {
    const out: Partial<Record<Slot, string | number>> = { ...slots };
    if (f) {
      out.finding = lang === "rw" ? f.kinyarwanda!.rw : (f.kinyarwanda?.source[lang] || f.labels[lang]);
    }
    return out;
  };
  if (t.slots.includes("finding") && !f) throw new RecapError(`template ${templateId} needs a finding`);

  // Audio : parties fixes découpées aux emplacements + clip du nombre ou du constat.
  const audio: string[] = [];
  const missingAudio: string[] = [];
  const push = (clip: string | null | undefined, label: string): void => {
    if (clip) audio.push(clip);
    else missingAudio.push(label);
  };
  if (t.audioParts) {
    const slotOrder = [...t.kinyarwanda.rw.matchAll(/\{(n|k|x|p|finding)\}/g)].map((m) => m[1] as Slot);
    t.audioParts.forEach((part, i) => {
      if (part) audio.push(part);
      const s = slotOrder[i];
      if (!s) return;
      if (s === "finding") push(f?.kinyarwanda?.audio, `finding:${findingId}`);
      else {
        const v = slots[s];
        push(catalog.numbers?.[String(v)]?.audio, `number:${v}`);
      }
    });
  } else {
    push(t.kinyarwanda.audio, `template:${templateId}`);
    if (f) push(f.kinyarwanda?.audio, `finding:${findingId}`);
  }

  return {
    templateId,
    ...(findingId ? { findingId } : {}),
    slots: { ...slots },
    rw: fillSlots(t.kinyarwanda.rw, values("rw")),
    fr: fillSlots(t.kinyarwanda.source.fr, values("fr")),
    en: fillSlots(t.kinyarwanda.source.en, values("en")),
    audio,
    missingAudio,
  };
}

/** Choisit le constat le plus cité ; égalité → plus longue série de mois, puis ordre du catalogue. */
function pickTop(ids: FindingId[], counts: Map<FindingId, number>, streaks: Map<FindingId, number>, order: FindingId[]): FindingId | undefined {
  return [...ids].sort(
    (a, b) =>
      (counts.get(b) ?? 0) - (counts.get(a) ?? 0) ||
      (streaks.get(b) ?? 0) - (streaks.get(a) ?? 0) ||
      order.indexOf(a) - order.indexOf(b),
  )[0];
}

export function buildMonthlyRecap(input: RecapInput, catalog: Catalog): Recap {
  const monthMsgs = input.messages.filter((m) => m.month === input.month && counted(m));
  const n = monthMsgs.length;
  const p = monthMsgs.reduce((s, m) => s + Math.max(0, m.notSureCount), 0);

  if (n === 0) {
    return { month: input.month, lines: [renderLine(catalog, "no_feedback", {})], stats: { n: 0, p: 0, counts: {}, streaks: {} } };
  }

  // k = nombre de messages (visiteurs) qui citent le constat, chaque constat compté une fois par message.
  const counts = new Map<FindingId, number>();
  for (const m of monthMsgs) for (const id of new Set(m.findings)) counts.set(id, (counts.get(id) ?? 0) + 1);
  const streaks = new Map<FindingId, number>();
  for (const id of counts.keys()) streaks.set(id, findingStreak(id, input.month, input.messages));
  const order = catalog.findings.map((f) => f.id);
  const polarity = new Map(catalog.findings.map((f) => [f.id, f.polarity] as const));

  const lines: RecapLine[] = [renderLine(catalog, "volume", { n })];

  const positives = [...counts.keys()].filter((id) => polarity.get(id) === "positive");
  const keep = pickTop(positives, counts, streaks, order);
  if (keep) lines.push(renderLine(catalog, "keep", { k: counts.get(keep)!, n }, keep));

  // À corriger : au moins 2 mentions, ou cité 2 mois de suite ; sinon « rien d'urgent ».
  const eligible = [...counts.keys()].filter(
    (id) => polarity.get(id) === "negative" && ((counts.get(id) ?? 0) >= 2 || (streaks.get(id) ?? 0) >= 2),
  );
  const fix = pickTop(eligible, counts, streaks, order);
  if (fix) {
    const x = streaks.get(fix) ?? 1;
    lines.push(x >= 2 ? renderLine(catalog, "fix_streak", { k: counts.get(fix)!, n, x }, fix) : renderLine(catalog, "fix", { k: counts.get(fix)!, n }, fix));
  } else {
    lines.push(renderLine(catalog, "nothing_urgent", {}));
  }

  if (input.recurringUnknownVisitors > 0) lines.push(renderLine(catalog, "unknown_topic", { k: input.recurringUnknownVisitors }));
  if (p > 0) lines.push(renderLine(catalog, "not_understood", { p }));

  if (lines.length > 5) throw new RecapError("recap has more than 5 lines"); // impossible par construction
  return {
    month: input.month,
    lines,
    stats: { n, p, counts: Object.fromEntries(counts), streaks: Object.fromEntries(streaks) },
  };
}

/** Lignes kinyarwanda du récap, prêtes pour splitSms. */
export function recapRwLines(recap: Recap): string[] {
  return recap.lines.map((l) => l.rw);
}

/** Tous les clips audio du récap, dans l'ordre de lecture. */
export function recapAudio(recap: Recap): string[] {
  return recap.lines.flatMap((l) => l.audio);
}
