/**
 * MODEL-SERVE-005-T03. Live error over joined (actual, predicted) pairs —
 * pure functions, no I/O, the same shape `lib/prediction-drift.ts` takes
 * for the drift half of this feature.
 *
 * WHY SUFFICIENT STATISTICS AND NOT PER-WINDOW METRICS. Lab truth arrives
 * hours or days apart while an inference window scores every interval, so
 * most windows carry ZERO joined pairs and some carry exactly one. A
 * per-window RMSE over one sample is a single residual wearing a metric's
 * name. `InferenceWindowTruth` therefore stores per-window SUMS, and this
 * module pools them into one EXACT metric over whatever range is asked for
 * — never an average of averages, which is what pooling finished per-window
 * metrics would silently produce.
 *
 * The formulas are `apps/client/lib/model-evaluation.ts`'s `computeMetrics`
 * exactly, including its sign convention `residual = predicted - actual`,
 * so the Monitoring tab and the Evaluation tab can never report opposite
 * signs for the same model. Two deliberate differences:
 *
 *   1. `computeMetrics` returns `{rmse: 0, mae: 0, r2: 0, ...}` for an
 *      empty set. Harmless in a mock-fed chart, dangerous as a published
 *      monitoring figure — a window no lab has reported on yet would read
 *      as a perfect score. This module returns `null` instead.
 *   2. No rounding. `computeMetrics` rounds for display; rounding belongs
 *      to the renderer, not to a stored or served number.
 */

/** One window's contribution — `InferenceWindowTruth`'s own sum columns. */
export interface TruthStats {
  n: number;
  sumSe: number;
  sumAe: number;
  sumSigned: number;
  sumActual: number;
  sumActualSq: number;
}

/** The four `METRIC_REGISTRY` keys plus bias, which the registry does not
 *  declare but `computeMetrics` has always returned beside them. */
export interface LiveError {
  r2: number;
  rmse: number;
  mae: number;
  sd: number;
  /** Mean signed residual: > 0 over-predicts, < 0 under-predicts. */
  bias: number;
  n: number;
}

const EMPTY: TruthStats = {
  n: 0,
  sumSe: 0,
  sumAe: 0,
  sumSigned: 0,
  sumActual: 0,
  sumActualSq: 0,
};

/**
 * Combine many windows' sums into one. Rows with `n <= 0` are SKIPPED
 * rather than added — a window that joined nothing carries no information,
 * and letting its zeros through would make it indistinguishable from a
 * window whose residuals genuinely summed to zero. Same guard and same
 * reason as `poolFeatureStats`'s own `n <= 0` skip.
 */
export function poolTruthStats(rows: readonly TruthStats[]): TruthStats {
  const pooled: TruthStats = { ...EMPTY };
  for (const row of rows) {
    if (!row || row.n <= 0) continue;
    pooled.n += row.n;
    pooled.sumSe += row.sumSe;
    pooled.sumAe += row.sumAe;
    pooled.sumSigned += row.sumSigned;
    pooled.sumActual += row.sumActual;
    pooled.sumActualSq += row.sumActualSq;
  }
  return pooled;
}

/**
 * `null` when no pairs exist — NEVER an error of zero. The caller must be
 * able to say "ground truth has not arrived for this range" and mean it;
 * see this module's own header.
 *
 * R² comes from the pooled sums directly:
 *   SS_res = sumSe
 *   SS_tot = sumActualSq - sumActual² / n    (the standard identity)
 * which is exact over the union of every window pooled in, rather than an
 * average of per-window R²s. A degenerate SS_tot (every actual identical,
 * or a single pair) yields `r2: 0`, matching `computeMetrics`'s own
 * `ssTot === 0` branch instead of dividing by zero.
 */
export function computeLiveError(pooled: TruthStats): LiveError | null {
  const { n } = pooled;
  if (n <= 0) return null;

  const rmse = Math.sqrt(pooled.sumSe / n);
  const mae = pooled.sumAe / n;
  const bias = pooled.sumSigned / n;

  // Residual SD around the MEAN residual (bias) — which is what a residual
  // spread means, and is not the same number as RMSE unless bias is zero.
  const variance = Math.max(0, pooled.sumSe / n - bias * bias);
  const sd = Math.sqrt(variance);

  const ssTot = pooled.sumActualSq - (pooled.sumActual * pooled.sumActual) / n;
  // Subtracting two large, nearly equal sums can land a hair below zero in
  // floating point for a genuinely constant series; treat that as the
  // degenerate case it is rather than producing a negative denominator.
  const r2 = ssTot <= 0 ? 0 : 1 - pooled.sumSe / ssTot;

  return { r2, rmse, mae, sd, bias, n };
}
