/**
 * Mock laboratory-vs-prediction comparison data.
 *
 * Placeholder until real model predictions + lab results exist (same approved
 * Phase-6 mock pattern as `lib/mock-readings.ts`). Pure module — no React, no
 * IO. Values are computed deterministically from (modelId, timestamp) so a
 * given model yields a stable series (no flicker on re-render / range switch).
 *
 * Swap path: replace `generateLabComparison` with a `services/` `fetchClient`
 * call returning the same `EvalPoint[]` once a NestJS evaluation endpoint lands.
 */

import { rangeConfig, type TimeRange } from '@/lib/mock-readings'
import type { EvalPoint } from '@/lib/model-evaluation'

const HOUR_MS = 60 * 60 * 1000

/** Deterministic hash → [0, 1). Stable for a given string (FNV-1a). */
function hash01(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 100000) / 100000
}

function round(v: number, digits = 2): number {
  const f = Math.pow(10, digits)
  return Math.round(v * f) / f
}

/**
 * Generate a deterministic predicted-vs-lab series for one model over the given
 * range, ending at `now` and going backwards. Ascending by timestamp.
 *
 * The lab "actual" follows a sine baseline + small measurement noise. The model
 * "predicted" adds a per-model systematic bias amplified at peak load (high
 * sine) so error concentrates in the peak regime — exercising the heuristics in
 * `generateAnalysis` (`lib/model-evaluation.ts`).
 */
export function generateLabComparison(
  modelId: string,
  range: TimeRange,
  now: number = Date.now(),
): EvalPoint[] {
  const { points: count, stepMs } = rangeConfig(range)

  const baseline = 60 + hash01(`base:${modelId}`) * 40 // 60..100
  const amplitude = 12 + hash01(`amp:${modelId}`) * 18 // 12..30
  // Skewed toward a negative (under-prediction) tendency, but some models over-predict.
  const bias = (hash01(`bias:${modelId}`) - 0.62) * 7
  const periodMs = 24 * HOUR_MS
  const phase = hash01(`phase:${modelId}`) * Math.PI * 2

  const points: EvalPoint[] = []
  for (let i = count - 1; i >= 0; i--) {
    const ts = now - i * stepMs
    const sine = Math.sin((ts / periodMs) * Math.PI * 2 + phase)

    const labNoise = (hash01(`la:${modelId}:${ts}`) - 0.5) * 2 * 1.5
    const actual = baseline + amplitude * sine + labNoise

    // Peak-amplified bias: larger error when sine is high (peak load).
    const peakFactor = 0.5 + Math.max(0, sine) // 0.5..1.5
    const predNoise = (hash01(`pr:${modelId}:${ts}`) - 0.5) * 2 * 1.0
    const predicted = actual + bias * peakFactor + predNoise

    const a = round(actual)
    const p = round(predicted)
    points.push({
      timestamp: new Date(ts).toISOString(),
      predicted: p,
      actual: a,
      residual: round(p - a),
    })
  }
  return points
}
