/**
 * Model-evaluation math + analysis (single source of truth).
 *
 * Pure module — no React, no IO. Compares a model's predictions against
 * laboratory ground-truth, computes error statistics (RMSE / MAE / R² / bias),
 * and derives a 3-section technical analysis (Graph Explanation / Root Cause /
 * Actionable Suggestions).
 *
 * `generateAnalysis` is a deterministic, stats-driven MOCK of the AI report —
 * the approved Phase-6 placeholder pattern (see `lib/mock-readings.ts`). When a
 * real LLM is wired, replace ONLY this function (and the generator call in
 * `hooks/use-model-evaluation.ts`) with a Claude call; everything else stays.
 */

import type { AIModel } from '@/types'

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

/** The 3-section technical report. */
export interface EvalAnalysis {
  graphExplanation: string
  rootCause: string[]
  suggestions: string[]
}

function round(v: number, digits = 2): number {
  const f = Math.pow(10, digits)
  return Math.round(v * f) / f
}

/** Compute RMSE / MAE / R² / bias from aligned prediction/lab pairs. */
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

/** Mean residual over the top-20% highest-actual ("peak load") samples. */
function peakResidual(points: EvalPoint[]): number {
  if (points.length === 0) return 0
  const sorted = [...points].sort((a, b) => b.actual - a.actual)
  const k = Math.max(1, Math.floor(points.length * 0.2))
  const peak = sorted.slice(0, k)
  const sum = peak.reduce((s, p) => s + (p.predicted - p.actual), 0)
  return sum / peak.length
}

function dirWord(bias: number): 'under-predicts' | 'over-predicts' | 'tracks' {
  if (bias < -0.05) return 'under-predicts'
  if (bias > 0.05) return 'over-predicts'
  return 'tracks'
}

/**
 * Deterministic, stats-driven technical analysis. Encodes reliability-engineering
 * heuristics keyed on the computed metrics — no randomness, no IO, no LLM.
 */
export function generateAnalysis(
  model: AIModel,
  metrics: EvalMetrics,
  points: EvalPoint[],
): EvalAnalysis {
  const name = model.name || 'the model'

  if (metrics.n === 0) {
    return {
      graphExplanation: `No paired prediction/laboratory samples are available for ${name}, so no comparison can be drawn.`,
      rootCause: [
        'Evaluation dataset is empty — predictions and lab results could not be aligned on a common timestamp index.',
      ],
      suggestions: [
        'Verify the model is deployed and emitting predictions, then re-run the evaluation once paired lab data exists.',
      ],
    }
  }

  const overall = dirWord(metrics.bias)
  const peak = peakResidual(points)
  const peakDir = peak < 0 ? 'under-predicts' : 'over-predicts'
  const absBias = Math.abs(metrics.bias)
  const absPeak = round(Math.abs(peak))

  // ── Graph Explanation ──────────────────────────────────────────────
  const graphExplanation =
    `The chart overlays ${name}'s predictions (dashed) against laboratory ground-truth (solid) across ${metrics.n} samples. ` +
    (overall === 'tracks'
      ? `The model tracks the measured value closely (mean bias ${metrics.bias >= 0 ? '+' : ''}${metrics.bias}, RMSE ${metrics.rmse}, MAE ${metrics.mae}, R² ${metrics.r2.toFixed(3)}). `
      : `The model consistently ${overall} the measured value (mean bias ${metrics.bias >= 0 ? '+' : ''}${metrics.bias}, RMSE ${metrics.rmse}, MAE ${metrics.mae}, R² ${metrics.r2.toFixed(3)}). `) +
    `Residuals are largest in the peak-load regime, where the model ${peakDir} the lab result by ~${absPeak}; agreement is tighter during steady-state operation.`

  // ── Root Cause Analysis ────────────────────────────────────────────
  const rootCause: string[] = []
  if (absBias > Math.max(0.5, metrics.rmse * 0.6)) {
    rootCause.push(
      `A systematic offset of ${metrics.bias >= 0 ? '+' : ''}${metrics.bias} units (bias dominating RMSE) points to sensor drift or a calibration error in the input feed rather than random scatter.`,
    )
  }
  if (metrics.r2 < 0.7) {
    rootCause.push(
      `Low R² (${metrics.r2.toFixed(3)}) indicates a data distribution shift between the training window and the current operating regime, or a missing explanatory variable absent from the current feature set.`,
    )
  } else {
    rootCause.push(
      `R² of ${metrics.r2.toFixed(3)} shows the model captures most variance; the remaining error is concentrated rather than systemic.`,
    )
  }
  if (absPeak > metrics.mae * 1.3) {
    rootCause.push(
      `Error concentrated at peak load suggests high-load conditions are under-represented in the training data — the model extrapolates poorly beyond its trained envelope.`,
    )
  }

  // ── Actionable Suggestions ─────────────────────────────────────────
  const suggestions: string[] = []
  if (absBias > Math.max(0.5, metrics.rmse * 0.6)) {
    suggestions.push(
      `Recalibrate the primary input sensor and re-baseline against a certified reference to remove the ${metrics.bias >= 0 ? 'positive' : 'negative'} systematic offset.`,
    )
  }
  suggestions.push(
    `Retrain ${name} using the latest laboratory results as ground truth, oversampling peak-load samples to extend the trained operating envelope.`,
  )
  if (metrics.r2 < 0.7) {
    suggestions.push(
      `Add the missing load-dependent variable to the feature set and apply a smoothing/outlier filter to the input pipeline before the next training cycle.`,
    )
  } else {
    suggestions.push(
      `Apply a smoothing filter to the input pipeline to suppress the residual high-frequency error and monitor for recurring peak-load drift.`,
    )
  }

  return { graphExplanation, rootCause, suggestions: suggestions.slice(0, 3) }
}

// ── Residual diagnostics (histogram + Q-Q) ────────────────────────────────────

/** One histogram bar: half-open bin [x0, x1) with its sample count. */
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
