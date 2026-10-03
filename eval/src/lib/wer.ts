// Taux d'erreur de mots (WER) et de caractères (CER).
// Normalisation proche du BasicTextNormalizer de Whisper : minuscules (NFKC), contenu entre crochets ou
// parenthèses retiré, ponctuation et symboles remplacés par des espaces, espaces uniques. Les accents sont
// GARDÉS (une faute d'accent compte) ; les nombres ne sont pas normalisés (« 12 » ≠ « douze »).

export function normalizeForWer(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Distance d'édition (Levenshtein) entre deux séquences. */
export function editDistance<T>(a: readonly T[], b: readonly T[]): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  let cur = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length]!;
}

export interface ErrorCounts {
  wordErrors: number;
  refWords: number;
  charErrors: number;
  refChars: number;
}

export function errorCounts(reference: string, hypothesis: string): ErrorCounts {
  const r = normalizeForWer(reference);
  const h = normalizeForWer(hypothesis);
  const rw = r ? r.split(" ") : [];
  const hw = h ? h.split(" ") : [];
  return { wordErrors: editDistance(rw, hw), refWords: rw.length, charErrors: editDistance([...r], [...h]), refChars: [...r].length };
}

export function sumCounts(cs: readonly ErrorCounts[]): ErrorCounts {
  return cs.reduce(
    (a, c) => ({ wordErrors: a.wordErrors + c.wordErrors, refWords: a.refWords + c.refWords, charErrors: a.charErrors + c.charErrors, refChars: a.refChars + c.refChars }),
    { wordErrors: 0, refWords: 0, charErrors: 0, refChars: 0 },
  );
}

/** WER et CER de corpus (erreurs totales / mots de référence totaux). */
export function rates(c: ErrorCounts): { wer: number; cer: number } {
  return { wer: c.refWords ? c.wordErrors / c.refWords : 0, cer: c.refChars ? c.charErrors / c.refChars : 0 };
}
