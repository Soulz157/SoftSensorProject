/**
 * Model-evaluation math (single source of truth).
 *
 * Pure module — no React, no IO. Compares a model's predictions against
 * laboratory ground-truth and computes error statistics (RMSE / MAE / R² /
 * bias), plus the residual diagnostics (histogram, Q-Q).
 *
 * MODEL-SERVE-032. The mock "AI analysis" (`generateAnalysis`) that used to
 * live here was removed with the Evaluation page's move to real data: it was
 * deterministic text generated from the metrics, shown on a production page
 * as if it were analysis.
 */

/** One aligned prediction/lab pair. `residual = predicted - actual`. */
export interface EvalPoint {
  /** ISO 8601 UTC. */
  timestamp: string
  predicted: number
  actual: number
  residual: number
}

/** Aggregate error statistics over a set of `EvalPoint`s. */
export interface EvalMetrics {
  /** Root mean squared error. */
  rmse: number
  /** Mean absolute error. */
  mae: number
  /** Coefficient of determination (1 - SS_res / SS_tot). */
  r2: number
  /** Mean signed error: >0 over-predicts, <0 under-predicts. */
  bias: number
  /** Sample count. */
  n: number
}

// MODEL-FLOW-019-T15. `EvaluationPopulation` and its label forms moved to
// `lib/metric-source.ts`, where they are DERIVED from `MetricSource`
// (`Extract<MetricSource, 'test-split' | 'holdout'>`) rather than declared
// as a second union carrying its own spelling of the same values — that
// file owns the source, so it owns every name for it.

function round(v: number, digits = 2): number {
  const f = Math.pow(10, digits)
  return Math.round(v * f) / f
}

/** Compute RMSE / MAE / R² / bias from aligned prediction/lab pairs. */
/**
 * One metric value, as every surface that prints RMSE/R²/MAE should print
 * it: four decimals, and an explicit "not recorded" for a figure the source
 * genuinely never carried.
 *
 * FIXED DECIMALS, not `formatAxisValue`'s significant digits — that one
 * formats a Y-axis tick whose magnitude is unknown (a process value can be
 * 0.48 or 1204). These are error metrics read side by side, where a
 * consistent decimal column is what makes two versions comparable at a
 * glance.
 *
 * `null` is never rendered as 0: a version that recorded no r2 and a
 * version that scored exactly 0 are different facts.
 */
export function formatMetricValue(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toFixed(4)
    : 'not recorded'
}

export function computeMetrics(points: EvalPoint[]): EvalMetrics {
  const n = points.length
  if (n === 0) return { rmse: 0, mae: 0, r2: 0, bias: 0, n: 0 }

  let se = 0
  let ae = 0
  let signed = 0
  let actualSum = 0
  for (const p of points) {
    const e = p.predicted - p.actual
    se += e * e
    ae += Math.abs(e)
    signed += e
    actualSum += p.actual
  }

  const rmse = Math.sqrt(se / n)
  const mae = ae / n
  const bias = signed / n

  const actualMean = actualSum / n
  let ssTot = 0
  for (const p of points) ssTot += (p.actual - actualMean) ** 2
  const r2 = ssTot === 0 ? 0 : 1 - se / ssTot

  return {
    rmse: round(rmse),
    mae: round(mae),
    r2: round(r2, 3),
    bias: round(bias),
    n,
  }
}

export interface HistogramBin {
  x0: number
  x1: number
  /** Bin centre — the numeric x used to place the bar / the zero baseline. */
  mid: number
  count: number
}

/**
 * Bin residual values into a fixed-width histogram. Bins span [min, max] of the
 * residuals; an empty or degenerate (all-equal) input yields a single centred
 * bin so the chart still renders. The zero-error baseline (x = 0) is drawn by
 * the chart, independent of the bin edges.
 */
export function residualHistogram(
  residuals: number[],
  binCount = 20,
): HistogramBin[] {
  const n = residuals.length
  if (n === 0) return []

  let min = Infinity
  let max = -Infinity
  for (const r of residuals) {
    if (r < min) min = r
    if (r > max) max = r
  }

  // Degenerate spread — one bin centred on the value.
  if (min === max) {
    return [{ x0: min - 0.5, x1: max + 0.5, mid: min, count: n }]
  }

  const bins = Math.max(1, Math.floor(binCount))
  const width = (max - min) / bins
  const out: HistogramBin[] = Array.from({ length: bins }, (_, i) => {
    const x0 = min + i * width
    const x1 = x0 + width
    return { x0, x1, mid: x0 + width / 2, count: 0 }
  })

  for (const r of residuals) {
    // Clamp the max value into the last bin (its right edge is inclusive).
    let idx = Math.floor((r - min) / width)
    if (idx >= bins) idx = bins - 1
    if (idx < 0) idx = 0
    const bin = out[idx]
    if (bin) bin.count += 1
  }
  return out
}

/**
 * Inverse standard-normal CDF (probit) — Acklam's rational approximation.
 * Accurate to ~1e-9 over p ∈ (0, 1); used for the Q-Q plot's theoretical
 * quantiles. Clamps the open endpoints so p = 0 / 1 don't return ±Infinity.
 */
export function normalQuantile(p: number): number {
  const clamped = Math.min(1 - 1e-12, Math.max(1e-12, p))

  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ]
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ]
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ]
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ]

  const plow = 0.02425
  const phigh = 1 - plow

  if (clamped < plow) {
    const q = Math.sqrt(-2 * Math.log(clamped))
    return (
      (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q +
        c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
    )
  }
  if (clamped > phigh) {
    const q = Math.sqrt(-2 * Math.log(1 - clamped))
    return (
      -(
        ((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q +
        c[5]!
      ) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
    )
  }
  const q = clamped - 0.5
  const r = q * q
  return (
    ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r +
      a[5]!) *
      q) /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
  )
}

/** One Q-Q point: theoretical normal quantile (x) vs standardized sample (y). */
export interface QQPoint {
  theoretical: number
  sample: number
}

export interface QQPlot {
  points: QQPoint[]
  /** Symmetric axis domain [-m, m] so the y = x reference line spans the plot. */
  domain: [number, number]
}

/**
 * Standardized-residual Q-Q plot against the normal distribution. Residuals are
 * centred and scaled by their own SD, sorted, then paired with the theoretical
 * quantile at plotting position (i + 0.5) / n. On a normal fit the points hug
 * the y = x diagonal (drawn by the chart as the reference line).
 */
export function qqPoints(residuals: number[]): QQPlot {
  const n = residuals.length
  if (n === 0) return { points: [], domain: [-3, 3] }

  const mean = residuals.reduce((a, b) => a + b, 0) / n
  const variance =
    residuals.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n
  const sd = Math.sqrt(variance)

  const sortedStd = [...residuals]
    .sort((a, b) => a - b)
    .map(r => (sd === 0 ? 0 : (r - mean) / sd))

  const points: QQPoint[] = sortedStd.map((sample, i) => ({
    theoretical: normalQuantile((i + 0.5) / n),
    sample,
  }))

  let m = 3
  for (const p of points) {
    m = Math.max(m, Math.abs(p.theoretical), Math.abs(p.sample))
  }
  const bound = Math.ceil(m)
  return { points, domain: [-bound, bound] }
}
