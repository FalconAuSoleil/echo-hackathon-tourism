// Outils de test uniquement (non exportés par index.ts) : faux port d'embedding à vecteurs contrôlés,
// faux transcripteur, et catalogue de test avec des phrases kinyarwanda factices.
import catalogJson from "../../../catalog/catalog.json" with { type: "json" };
import type { Catalog, KinyarwandaSentence, RecapTemplateId } from "./catalog.ts";
import { validateCatalog } from "./catalog.ts";
import type { EmbedFn, Transcriber } from "./ports.ts";
import type { FindingId, Transcript, VisitorLang } from "./types.ts";
import { words } from "./text.ts";
import type { AnalysisConfig } from "./config.ts";

/** Règle « similarité » avec les seuils historiques des tests (le défaut livré est calibré par l'évaluation). */
export const SIMILARITY_TEST_CONFIG: Partial<AnalysisConfig> = { scoring: "similarity", acceptThreshold: 0.6, offListThreshold: 0.4, aggregation: "max", crossLingual: true };

/**
 * Concepts : un axe par concept, mots de toutes les langues. Comme un vrai modèle multilingue, le faux
 * embedder rapproche les paraphrases d'une langue à l'autre et IGNORE presque la négation (« not » n'ajoute
 * qu'un petit résidu), ce qui oblige le cœur à la traiter lui-même.
 */
const CONCEPTS: string[][] = [
  ["path", "road", "walk", "chemin", "route", "weg", "camino", "sendero", "access", "acces"], // 0
  ["long", "far", "lang", "largo", "weit", "loin"], // 1
  ["welcome", "warm", "accueil", "chaleureux", "willkommen", "herzlich", "bienvenida", "calurosa"], // 2
  ["roasting", "roast", "tasting", "torrefaction", "degustation", "rosten", "rostung", "verkostung", "tostado", "cata"], // 3
  ["meal", "food", "lunch", "repas", "essen", "mittagessen", "comida", "almuerzo"], // 4
  ["delicious", "tasty", "good", "delicieux", "bon", "lecker", "gut", "delicioso", "deliciosa", "rico"], // 5
  ["price", "prices", "prix", "preis", "preise", "precio", "precios"], // 6
  ["unclear", "clear", "clairs", "clair", "flou", "unklar", "klar", "claro", "claros"], // 7
  ["buy", "purchase", "acheter", "kaufen", "comprar"], // 8
  ["coffee", "cafe", "kaffee"], // 9
  ["shade", "water", "ombre", "eau", "schatten", "wasser", "sombra", "agua"], // 10
  ["picking", "pick", "cueillette", "cueillir", "pflucken", "ernte", "cosecha", "cherries", "cerises", "kirschen"], // 11
  ["visit", "tour", "visite", "besuch", "fuhrung", "visita"], // 12
];
const STOP = new Set(
  "the a an was were is it we i to of and our my there very too so too had have this that be been le la les l un une et est etait c'etait il y avait n'etait pas de des du nous der die das ein eine und war ist zu es gab wir el la los las un una y era fue estaba estaban no habia muy demasiado nos de del".split(" "),
);
const DIM = 13 + 32;

function hash(w: string): number {
  let h = 2166136261;
  for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function fakeVector(text: string): Float32Array {
  const v = new Float32Array(DIM);
  for (const w of words(text)) {
    const c = CONCEPTS.findIndex((list) => list.includes(w));
    if (c >= 0) v[c]! += 1;
    else if (!STOP.has(w)) v[13 + (hash(w) % 32)]! += 0.35;
  }
  let n = 0;
  for (const x of v) n += x * x;
  if (n === 0) {
    v[DIM - 1] = 1;
    return v;
  }
  const s = 1 / Math.sqrt(n);
  for (let i = 0; i < DIM; i++) v[i]! *= s;
  return v;
}

/** Faux EmbedFn ; compte les appels pour vérifier que les exemples ne sont plongés qu'une fois. */
export function fakeEmbedder(): EmbedFn & { calls: string[][] } {
  const calls: string[][] = [];
  const fn = (async (texts: string[]) => {
    calls.push(texts);
    return texts.map(fakeVector);
  }) as EmbedFn & { calls: string[][] };
  fn.calls = calls;
  return fn;
}

/** Faux Transcriber : renvoie un transcript fixé, et garde une copie de l'audio reçu. */
export function fakeTranscriber(result: Partial<Transcript> & { text: string }): Transcriber & { received: Float32Array[] } {
  const received: Float32Array[] = [];
  return {
    received,
    async transcribe(audio) {
      received.push(Float32Array.from(audio));
      return { language: "en", languageProbability: 0.98, confidence: 0.9, durationSec: audio.length / 16000, ...result };
    },
  };
}

const EXAMPLES: Partial<Record<FindingId, Partial<Record<VisitorLang, string[]>>>> = {
  P1: { en: ["The welcome was warm"], fr: ["L'accueil était chaleureux"], de: ["Herzlich willkommen"], es: ["Una bienvenida calurosa"] },
  P3: { en: ["We loved the roasting and tasting"], fr: ["La torréfaction était géniale"], de: ["Die Röstung war toll"], es: ["El tostado fue genial"] },
  P4: { en: ["The meal was delicious"], fr: ["Le repas était délicieux"], de: ["Das Essen war lecker"], es: ["La comida estaba deliciosa"] },
  P9: { en: ["I want to buy coffee"], fr: ["Je voudrais acheter du café"], de: ["Ich möchte Kaffee kaufen"], es: ["Quiero comprar café"] },
  N1: { en: ["The path was too long"], fr: ["Le chemin était trop long"], de: ["Der Weg war zu lang"], es: ["El camino era demasiado largo"] },
  N2: { en: ["Prices were unclear"], fr: ["Les prix n'étaient pas clairs"], de: ["Die Preise waren unklar"], es: ["Los precios no estaban claros"] },
  N8: { en: ["There was no shade", "Not enough water"], fr: ["Il n'y avait pas d'ombre"], de: ["Kein Schatten"], es: ["No había sombra"] },
  N10: { en: ["We couldn't buy coffee"], fr: ["Impossible d'acheter du café"], de: ["Wir konnten keinen Kaffee kaufen"], es: ["No pudimos comprar café"] },
};

const RW_TEMPLATES: Record<RecapTemplateId, string> = {
  volume: "Uku kwezi: ibitekerezo {n}.",
  keep: "Mukomeze: {finding} ({k} kuri {n}).",
  fix: "Icyo gukosora mbere: {finding} ({k} kuri {n}).",
  fix_streak: "Icyo gukosora mbere: {finding} ({k} kuri {n}), ukwezi kwa {x} gukurikiranye.",
  nothing_urgent: "Nta kintu cyihutirwa cyo gukosora.",
  unknown_topic: "Ingingo igikoresho kitazi igaruka ku bashyitsi {k}: musabe umuntu asome ibyo bitekerezo.",
  not_understood: "Ibitekerezo {p} bitumvikanye: mubaze umuntu.",
  no_feedback: "Nta gitekerezo uku kwezi.",
};

/** Sources fr/en figées pour les tests (indépendantes des reformulations du vrai catalogue). */
const TEMPLATE_SOURCES: Record<RecapTemplateId, { fr: string; en: string }> = {
  volume: { fr: "Ce mois-ci : {n} retours.", en: "This month: {n} feedback messages." },
  keep: { fr: "À garder : {finding} ({k} sur {n}).", en: "Keep doing: {finding} ({k} out of {n})." },
  fix: { fr: "À corriger en priorité : {finding} ({k} sur {n}).", en: "Fix first: {finding} ({k} out of {n})." },
  fix_streak: { fr: "À corriger en priorité : {finding} ({k} sur {n}), {x}e mois de suite.", en: "Fix first: {finding} ({k} out of {n}), month {x} in a row." },
  nothing_urgent: { fr: "Rien d'urgent à corriger.", en: "Nothing urgent to fix." },
  unknown_topic: { fr: "Un sujet que l'outil ne connaît pas revient chez {k} visiteurs : demandez à une personne de lire ces remarques.", en: "A topic the tool does not know comes back from {k} visitors: ask a person to read these remarks." },
  not_understood: { fr: "{p} remarques pas comprises : demandez à une personne.", en: "{p} remarks not understood: ask a person." },
  no_feedback: { fr: "Pas de retour ce mois-ci.", en: "No feedback this month." },
};

function sentence(rw: string, fr: string, en: string, audio: string | null): KinyarwandaSentence {
  return { rw, source: { fr, en }, backTranslation: {}, similarity: 0.9, attempts: 1, audio, status: "machine_translated_unvalidated" };
}

/**
 * Catalogue de test : constats et modèles du dépôt, exemples ci-dessus, kinyarwanda FACTICE (pour les
 * tests uniquement ; le vrai est produit par tools/ et figé dans catalog/catalog.json).
 */
export function testCatalog(options: { audioParts?: boolean; numbers?: boolean } = {}): Catalog {
  const raw = JSON.parse(JSON.stringify(catalogJson)) as Catalog;
  for (const f of raw.findings) {
    const ex = EXAMPLES[f.id] ?? {};
    f.examples = { en: ex.en ?? [], fr: ex.fr ?? [], de: ex.de ?? [], es: ex.es ?? [] };
    f.keywords = { en: [], fr: [], de: [], es: [] }; // indépendant des listes réelles, qui évoluent
    f.kinyarwanda = sentence(`ingingo ${f.id.toLowerCase()} ${f.polarity === "positive" ? "nziza" : "mbi"}`, f.labels.fr.toLowerCase(), f.labels.en.toLowerCase(), `audio/finding-${f.id}.wav`);
  }
  for (const t of raw.templates) {
    const rw = RW_TEMPLATES[t.id];
    const src = TEMPLATE_SOURCES[t.id];
    t.kinyarwanda = sentence(rw, src.fr, src.en, `audio/template-${t.id}.wav`);
    delete t.audioParts;
    if (options.audioParts) {
      const parts = rw.split(/\{(?:n|k|x|p|finding)\}/);
      t.audioParts = parts.map((p, i) => (p.trim() ? `audio/template-${t.id}-${i}.wav` : null));
    }
  }
  delete raw.numbers; // indépendant des clips de nombres du vrai catalogue
  if (options.numbers) {
    raw.numbers = {};
    for (let i = 0; i <= 30; i++) raw.numbers[String(i)] = { rw: String(i), audio: `audio/num-${i}.wav` };
  }
  return validateCatalog(raw);
}
