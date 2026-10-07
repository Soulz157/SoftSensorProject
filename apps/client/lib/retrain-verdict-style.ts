import type { ThresholdVerdict } from '@/lib/acceptance-criteria'
import {
  compareMetric,
  type MetricComparison,
} from '@/lib/retrain-metric-compare'

/**
 * Text colour for the Retrain tab's new-vs-current verdicts: the metric
 * cards' ▲/▼ delta line, the "RMSE improved/regressed" summary sentences,
 * and the acceptance-criteria Pass/Fail words.
 *
 * Green = the new version is better / the criterion holds; red = worse /
 * fails. Same tones as `MONITORING_STATUS_CLASS` (lib/drift-status-style.ts)
 * so a "good" reads the same green on every tab. This is a second, explicit
 * carve-out from the red/amber status reservation, added on request
 * (2026-10-07) — the word always stays beside the colour, so colour is
 * never the only signal.
 *
 * `same` and `not-evaluated` stay neutral on purpose: no change is not an
 * improvement, and an absent verdict must never read as green.
 */
export const COMPARISON_VERDICT_CLASS: Record<
  MetricComparison['verdict'],
  string
> = {
  better: 'text-green-600 dark:text-green-400',
  worse: 'text-red-600 dark:text-red-400',
  same: 'text-foreground',
}

/**
 * Colour for an "RMSE improved/regressed by X" sentence (new − current).
 * Through `compareMetric`, not the bare sign, so a delta below its
 * "same" threshold stays neutral — matching the RMSE card beside it,
 * which says "No change" there rather than a red "regressed by 0.0000".
 */
export function rmseDeltaClass(delta: number): string {
  return COMPARISON_VERDICT_CLASS[
    compareMetric('rmse', delta, 0)?.verdict ?? 'same'
  ]
}

export const CRITERION_VERDICT_CLASS: Record<ThresholdVerdict, string> = {
  pass: COMPARISON_VERDICT_CLASS.better,
  fail: COMPARISON_VERDICT_CLASS.worse,
  'not-evaluated': 'text-muted-foreground',
}
