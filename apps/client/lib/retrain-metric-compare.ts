/**
 * One retrain metric, new version against the current one — the delta and
 * which side it favours. Pure module — no React, no IO.
 *
 * The better direction is `RANK_DIRECTION`'s (rmse/mae lower, r2 higher),
 * never restated here, so the card and the candidate ranking can never
 * disagree about what "better" means.
 */

import { RANK_DIRECTION, type RankMetricKey } from './metric-ranking'

/** Below half the last displayed digit (`formatMetricValue` prints 4dp), a
 *  difference would render as two identical numbers — calling one "better"
 *  there would claim something the screen cannot show. */
const SAME_BELOW = 5e-5

export interface MetricComparison {
  /** New minus current, in the metric's own units. */
  delta: number
  verdict: 'better' | 'worse' | 'same'
}

/** Null when either figure is missing or non-finite — no verdict is
 *  manufactured from one side alone. */
export function compareMetric(
  key: RankMetricKey,
  newValue: number | null | undefined,
  currentValue: number | null | undefined,
): MetricComparison | null {
  if (typeof newValue !== 'number' || !Number.isFinite(newValue)) return null
  if (typeof currentValue !== 'number' || !Number.isFinite(currentValue)) {
    return null
  }
  const delta = newValue - currentValue
  if (Math.abs(delta) < SAME_BELOW) return { delta, verdict: 'same' }
  const newIsLower = delta < 0
  const lowerIsBetter = RANK_DIRECTION[key] === 'min'
  return {
    delta,
    verdict: newIsLower === lowerIsBetter ? 'better' : 'worse',
  }
}
