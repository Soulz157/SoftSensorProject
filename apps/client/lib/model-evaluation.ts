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
