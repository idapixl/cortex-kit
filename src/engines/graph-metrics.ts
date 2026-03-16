/**
 * Graph metrics for the cortex memory graph.
 *
 * Fiedler value: algebraic connectivity of the Laplacian.
 *   - High → well-integrated knowledge graph
 *   - Low  → disconnected clusters (compartmentalised knowledge)
 *
 * PE saturation: trend analysis over prediction-error values for recent
 * identity-related observations. Used to decide whether adversarial
 * rumination should be triggered.
 */

import type { CortexStore } from '../core/store.js';

// ─── Fiedler Value ────────────────────────────────────────────────────────────

/**
 * Compute the Fiedler value (algebraic connectivity) of the memory graph.
 *
 * The Fiedler value is the second-smallest eigenvalue of the graph Laplacian.
 * It is zero for disconnected graphs and increases with connectivity.
 *
 * Algorithm (two-pass power iteration, O(n·iter)):
 *   Pass 1 — power-iterate L to find lambda_max (largest eigenvalue), keeping
 *             v orthogonal to the constant eigenvector (eigenvalue 0).
 *   Pass 2 — power-iterate the shifted matrix (lambda_max·I − L) with the same
 *             deflation. The dominant eigenvalue mu_max of the shifted matrix
 *             satisfies: Fiedler = lambda_max − mu_max.
 *
 * This avoids matrix inversion (no shifted-inverse iteration needed) and is
 * exact enough for memory graphs up to ~5 000 nodes.
 */
export async function computeFiedlerValue(store: CortexStore): Promise<number> {
  const memories = await store.getAllMemories();
  const n = memories.length;
  if (n < 3) return 0;

  const idToIndex = new Map<string, number>();
  memories.forEach((m, i) => idToIndex.set(m.id, i));

  // Build adjacency (sparse).
  const adj = new Map<number, Map<number, number>>();
  const memIds = memories.map((m) => m.id);

  const edges = await store.getEdgesForMemories(memIds);
  for (const edge of edges) {
    const i = idToIndex.get(edge.source_id);
    const j = idToIndex.get(edge.target_id);
    if (i === undefined || j === undefined) continue;

    if (!adj.has(i)) adj.set(i, new Map());
    if (!adj.has(j)) adj.set(j, new Map());
    adj.get(i)!.set(j, edge.weight);
    adj.get(j)!.set(i, edge.weight);
  }

  // Check for isolated graph (no edges at all).
  if (adj.size === 0) return 0;

  // Degree vector.
  const degree = new Array<number>(n).fill(0);
  for (const [i, neighbors] of adj) {
    for (const [, w] of neighbors) {
      degree[i] += w;
    }
  }

  // Laplacian matrix-vector product: L·v = D·v − A·v
  function laplacianMul(v: number[]): number[] {
    const result = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      result[i] = degree[i] * v[i];
      const neighbors = adj.get(i);
      if (neighbors) {
        for (const [j, w] of neighbors) {
          result[i] -= w * v[j];
        }
      }
    }
    return result;
  }

  // Constant eigenvector (eigenvalue 0): ones / sqrt(n)
  const sqrtN = Math.sqrt(n);
  const ones = new Array<number>(n).fill(1 / sqrtN);

  /** Orthogonalise v against the constant eigenvector in-place. */
  function deflate(v: number[]): number[] {
    const dot = v.reduce((s, vi, i) => s + vi * ones[i], 0);
    return v.map((vi, i) => vi - dot * ones[i]);
  }

  /** Normalise a vector in place, return new vector. Returns null if near-zero. */
  function normalise(v: number[]): number[] | null {
    const norm = Math.sqrt(v.reduce((s, vi) => s + vi * vi, 0));
    if (norm < 1e-12) return null;
    return v.map((vi) => vi / norm);
  }

  const ITERS = 120;

  // ── Pass 1: find lambda_max of L ─────────────────────────────────────────
  // Start with a random vector orthogonal to the constant eigenvector.
  let v: number[] = deflate(new Array<number>(n).fill(0).map(() => Math.random() - 0.5));
  const vNorm = normalise(v);
  if (!vNorm) return 0;
  v = vNorm;

  for (let iter = 0; iter < ITERS; iter++) {
    let lv = laplacianMul(v);
    lv = deflate(lv);
    const lvNorm = normalise(lv);
    if (!lvNorm) break;
    v = lvNorm;
  }

  // Rayleigh quotient for lambda_max.
  const lvMax = laplacianMul(v);
  const lambdaMax = v.reduce((s, vi, i) => s + vi * lvMax[i], 0);

  if (lambdaMax <= 0) return 0;

  // ── Pass 2: find mu_max of (lambdaMax·I − L) ─────────────────────────────
  // Shifted matrix-vector product: (lambdaMax·I − L)·v
  function shiftedMul(vec: number[]): number[] {
    const lv2 = laplacianMul(vec);
    return vec.map((vi, i) => lambdaMax * vi - lv2[i]);
  }

  // Fresh random vector, deflated.
  let w: number[] = deflate(new Array<number>(n).fill(0).map(() => Math.random() - 0.5));
  const wNorm = normalise(w);
  if (!wNorm) return 0;
  w = wNorm;

  for (let iter = 0; iter < ITERS; iter++) {
    let sw = shiftedMul(w);
    sw = deflate(sw);
    const swNorm = normalise(sw);
    if (!swNorm) break;
    w = swNorm;
  }

  // Rayleigh quotient for mu_max.
  const swFinal = shiftedMul(w);
  const muMax = w.reduce((s, wi, i) => s + wi * swFinal[i], 0);

  // Fiedler = lambda_max − mu_max
  const fiedler = lambdaMax - muMax;
  return Math.max(0, fiedler);
}

// ─── PE Saturation ───────────────────────────────────────────────────────────

export interface PESaturationResult {
  /** Mean prediction error over the most recent 14-day window. */
  mean_pe: number;
  /** Trend relative to the prior 14-day window. */
  trend: 'rising' | 'stable' | 'declining';
  /**
   * True when the recent mean PE has fallen below 0.10 — signal that
   * adversarial rumination should be triggered to prevent stagnation.
   */
  saturated: boolean;
  recommendation: string;
}

/**
 * Detect PE saturation in identity-related observations.
 *
 * Queries the 'observations' collection for entries in the last 28 days
 * that have a non-null prediction_error. Computes the mean PE for the most
 * recent 14-day window vs the prior 14-day window and classifies the trend.
 *
 * A "saturated" state (mean_pe < 0.10) means the system is no longer
 * surprised by identity-type inputs — a sign that adversarial or
 * counterfactual prompting should be introduced to break out of the plateau.
 */
export async function detectPESaturation(store: CortexStore): Promise<PESaturationResult> {
  const now = Date.now();
  const msPerDay = 24 * 60 * 60 * 1000;

  const fourteenDaysAgo = new Date(now - 14 * msPerDay);
  const twentyEightDaysAgo = new Date(now - 28 * msPerDay);

  // Use the generic query interface to fetch recent observations with PE data.
  // content_type 'reflective' is the primary identity signal; also include
  // 'declarative' that happen to carry a PE score.
  let rawRecent: Record<string, unknown>[] = [];
  let rawPrior: Record<string, unknown>[] = [];

  try {
    rawRecent = await store.query(
      'observations',
      [
        { field: 'created_at', op: '>=', value: fourteenDaysAgo },
        { field: 'processed', op: '==', value: true },
      ],
      { orderBy: 'created_at', orderDir: 'desc', limit: 500 },
    );

    rawPrior = await store.query(
      'observations',
      [
        { field: 'created_at', op: '>=', value: twentyEightDaysAgo },
        { field: 'created_at', op: '<', value: fourteenDaysAgo },
        { field: 'processed', op: '==', value: true },
      ],
      { orderBy: 'created_at', orderDir: 'desc', limit: 500 },
    );
  } catch {
    // Store may not support compound queries — return neutral state.
    return {
      mean_pe: 0,
      trend: 'stable',
      saturated: false,
      recommendation: 'PE saturation check unavailable — store query failed.',
    };
  }

  function extractPE(rows: Record<string, unknown>[]): number[] {
    return rows
      .filter((r) => {
        const ct = r['content_type'];
        return ct === 'reflective' || ct === 'declarative' || ct === undefined || ct === null;
      })
      .map((r) => r['prediction_error'])
      .filter((pe): pe is number => typeof pe === 'number' && pe >= 0);
  }

  const recentPEs = extractPE(rawRecent);
  const priorPEs = extractPE(rawPrior);

  const mean = (arr: number[]) =>
    arr.length === 0 ? 0 : arr.reduce((s, v) => s + v, 0) / arr.length;

  const meanRecent = mean(recentPEs);
  const meanPrior = mean(priorPEs);

  // Trend: > 0.03 change is meaningful; within ±0.03 is stable.
  const delta = meanRecent - meanPrior;
  let trend: PESaturationResult['trend'];
  if (delta > 0.03) {
    trend = 'rising';
  } else if (delta < -0.03) {
    trend = 'declining';
  } else {
    trend = 'stable';
  }

  // Saturation: recent mean PE below 0.10 and at least one 14-day window
  // of data available.
  const saturated = recentPEs.length >= 5 && meanRecent < 0.10;

  let recommendation: string;
  if (saturated) {
    recommendation =
      'PE is saturated (mean < 0.10). Introduce adversarial or counterfactual observations ' +
      'to break the plateau and restore learning signal.';
  } else if (trend === 'declining' && meanRecent < 0.20) {
    recommendation =
      'PE is declining toward saturation. Consider diversifying observation sources.';
  } else if (trend === 'rising') {
    recommendation = 'PE is rising — high learning signal. No intervention needed.';
  } else {
    recommendation = 'PE is within normal range. No intervention needed.';
  }

  return { mean_pe: meanRecent, trend, saturated, recommendation };
}
