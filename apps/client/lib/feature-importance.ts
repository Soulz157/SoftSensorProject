/**
 * MODEL-FLOW-019-T09 — ranking, tail summary and rankability for a run's
 * `RunFeatureImportance`. Pure module — no React, no IO, the
 * `lib/acceptance-criteria.ts`/`lib/metric-ranking.ts` pattern this sits
 * beside.
 *
 * `importance` on every entry is ALREADY non-negative by the time it reaches
 * this module (the trainer writes `abs(coefficient)` for a coefficient
 * method — see `importance.py`'s own doc) — this module ranks and sums
 * exactly the field it is given, never re-deriving magnitude itself, so a
 * change to that convention has exactly one place to change.
 */

import type { RunFeatureImportance } from '@/services/model-draft'

export interface RankedFeature {
  rank: number
  name: string
  importance: number
  /** Share of the TOTAL importance across every feature the run used — not
   *  just the ones shown, so AC23's "top 10 of 21" stays honest even when
   *  `limit` truncates the returned list. */
  share: number
  /** The signed value, when the method carries one — never re-derived from
   *  `importance` (which has already discarded the sign). */
  coefficient?: number | null
}

/** Descending by `importance` (already magnitude, never signed) — top
 *  `limit` entries, `share` computed against the FULL set's total so a
 *  truncated list never inflates the shown features' apparent weight. */
export function rankFeatures(
  importance: RunFeatureImportance,
  limit = 10,
): RankedFeature[] {
  const total = importance.features.reduce((sum, f) => sum + f.importance, 0)
  return [...importance.features]
    .sort((a, b) => b.importance - a.importance)
    .slice(0, limit)
    .map((f, i) => ({
      rank: i + 1,
      name: f.name,
      importance: f.importance,
      share: total > 0 ? f.importance / total : 0,
      coefficient: f.coefficient,
    }))
}

export interface TailSummary {
  shownCount: number
  totalCount: number
  /** Share of total importance held by the shown (top-`limit`) features. */
  topShare: number
  /** Share of total importance held by every feature NOT shown — "what the
   *  remaining N carry in aggregate" (AC23). Zero when nothing is hidden. */
  tailShare: number
}

/** AC23: a top-10 list must never be mistaken for the whole feature set — this
 *  is the arithmetic that states the count and what the tail carries. */
export function tailSummary(
  importance: RunFeatureImportance,
  limit = 10,
): TailSummary {
  const total = importance.features.reduce((sum, f) => sum + f.importance, 0)
  const sorted = [...importance.features].sort(
    (a, b) => b.importance - a.importance,
  )
  const shown = sorted.slice(0, limit)
  const shownSum = shown.reduce((sum, f) => sum + f.importance, 0)
  return {
    shownCount: shown.length,
    totalCount: sorted.length,
    topShare: total > 0 ? shownSum / total : 0,
    tailShare: total > 0 ? (total - shownSum) / total : 0,
  }
}

/**
 * AC27: a coefficient over UNSCALED inputs ranks by unit, not by influence —
 * this is the gate that keeps that number off a ranked table rather than
 * leaving the render to decide it. "impurity" has no such question
 * (`standardized` is `null` for it) and is always rankable.
 *
 * MODEL-FLOW-019-T32 / AC70 adds `standardized-coefficient` and NOTHING ELSE.
 * That method is |coef| * std(X) over the rows the estimator was fit on —
 * dimensionless and comparable by construction, which is exactly what
 * `standardized: true` already asserts, so it needs no branch of its own here
 * beyond the trainer setting that flag.
 *
 * AC27 IS UNCHANGED: a plain `coefficient` whose inputs carry no recorded
 * scaling is still refused. What the same task also fixed is the trainer's
 * PREDICATE for that flag — it read `feature_spec.scaling`, which is empty on
 * every real spec in this system, instead of the fitted `scalingParams` — so
 * scaled linear runs now rank that were previously refused. A correction to
 * the reading, not a relaxation of the rule.
 */
export function canRank(importance: RunFeatureImportance): boolean {
  if (importance.method === 'impurity') return true
  return importance.standardized === true
}

/**
 * AC26: arithmetic only, never a recommended band — MODEL-FLOW-020-T03
 * measured three orderings across three effective sample sizes and closed as
 * a no-op, so no threshold is derivable from this system's data. `null` when
 * either input is missing (a candidate-job run has no `splitStats` by
 * design, MODEL-FLOW-014-T06) or `featureCount` is zero.
 */
export function observationsPerFeature(
  distinctLabelledValues: number | null | undefined,
  featureCount: number | null | undefined,
): number | null {
  if (
    distinctLabelledValues == null ||
    featureCount == null ||
    featureCount <= 0
  ) {
    return null
  }
  return distinctLabelledValues / featureCount
}
