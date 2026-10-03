// Classifieur linéaire (régression logistique multinomiale) sur les embeddings des exemples du catalogue.
// Entraîné uniquement sur les exemples du catalogue (jamais sur les données d'évaluation), déterministe
// (initialisation à zéro, descente de gradient Adam en lot complet). Sa probabilité sert de confiance :
// elle se calibre mieux qu'un cosinus maximal contre un seul exemple (mesures : eval/results/RESULTS.md).
// Petit : K × (D + 1) nombres (21 × 385 avec MiniLM), entraînable sur l'appareil ou fourni pré-calculé.

export interface LinearClassifier {
  classes: string[];
  dim: number;
  /** Poids K × (D + 1), ligne k = [w_k (D valeurs), biais_k]. */
  weights: Float32Array;
}

export interface LinearTrainOptions {
  /** Pénalité L2 sur les poids (pas sur les biais). */
  l2: number;
  epochs: number;
  learningRate: number;
}

export const DEFAULT_LINEAR_TRAINING: LinearTrainOptions = { l2: 1e-4, epochs: 150, learningRate: 0.05 };

function softmaxInPlace(z: Float32Array): void {
  let mx = -Infinity;
  for (const v of z) if (v > mx) mx = v;
  let s = 0;
  for (let i = 0; i < z.length; i++) {
    z[i] = Math.exp(z[i]! - mx);
    s += z[i]!;
  }
  for (let i = 0; i < z.length; i++) z[i] = z[i]! / s;
}

function logits(w: Float32Array, k: number, d: number, x: Float32Array, out: Float32Array): void {
  const stride = d + 1;
  for (let c = 0; c < k; c++) {
    let s = w[c * stride + d]!;
    const o = c * stride;
    for (let j = 0; j < d; j++) s += w[o + j]! * x[j]!;
    out[c] = s;
  }
}

/** Entraîne le classifieur (Adam, lot complet). `labels[i]` est l'indice de classe de `inputs[i]`. */
export function trainLinearClassifier(
  inputs: readonly Float32Array[],
  labels: readonly number[],
  classes: readonly string[],
  options: Partial<LinearTrainOptions> = {},
): LinearClassifier {
  const o = { ...DEFAULT_LINEAR_TRAINING, ...options };
  const k = classes.length;
  const d = inputs[0]?.length ?? 0;
  const stride = d + 1;
  const n = inputs.length;
  if (n === 0 || labels.length !== n) throw new Error("trainLinearClassifier: inputs and labels must be non-empty and aligned");
  const w = new Float32Array(k * stride);
  const m = new Float32Array(k * stride);
  const v = new Float32Array(k * stride);
  const g = new Float32Array(k * stride);
  const z = new Float32Array(k);
  const b1 = 0.9;
  const b2 = 0.999;
  for (let ep = 1; ep <= o.epochs; ep++) {
    g.fill(0);
    for (let i = 0; i < n; i++) {
      const x = inputs[i]!;
      logits(w, k, d, x, z);
      softmaxInPlace(z);
      z[labels[i]!] = z[labels[i]!]! - 1;
      for (let c = 0; c < k; c++) {
        const gc = z[c]!;
        if (gc === 0) continue;
        const off = c * stride;
        for (let j = 0; j < d; j++) g[off + j] = g[off + j]! + gc * x[j]!;
        g[off + d] = g[off + d]! + gc;
      }
    }
    const c1 = 1 - b1 ** ep;
    const c2 = 1 - b2 ** ep;
    for (let p = 0; p < w.length; p++) {
      const isBias = p % stride === d;
      const grad = g[p]! / n + (isBias ? 0 : o.l2 * w[p]!);
      m[p] = b1 * m[p]! + (1 - b1) * grad;
      v[p] = b2 * v[p]! + (1 - b2) * grad * grad;
      w[p] = w[p]! - (o.learningRate * (m[p]! / c1)) / (Math.sqrt(v[p]! / c2) + 1e-8);
    }
  }
  return { classes: [...classes], dim: d, weights: w };
}

/** Probabilités par classe (même ordre que `classes`). */
export function predictProba(clf: LinearClassifier, x: Float32Array): Float32Array {
  const z = new Float32Array(clf.classes.length);
  logits(clf.weights, clf.classes.length, clf.dim, x, z);
  softmaxInPlace(z);
  return z;
}
