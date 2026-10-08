/**
 * MODEL-SERVE-020-T05. Chart rows for the Retrain tab's Actual vs Predicted
 * and Residual charts — the new version's series, with the current version
 * optionally overlaid on the rows both were scored on.
 *
 * Pure module — no React, no IO.
 *
 * WHY THIS ALIGNS BY TIMESTAMP AND NOT BY INDEX. `buildFitRows(points, sd,
 * compare)` pairs a compare series with `compare[i]` for row `i`, which is only
 * right when both arrays cover the SAME rows in the SAME order. Two versions
 * of one model rarely do: on the one real retrain checked (2026-09-28), the new
 * version was scored on 259 rows and the current version on 1,325 — every one
 * of the 259 timestamps exists in the 1,325, but index i is a different
 * instant in each. Pairing by index would have drawn the current version's
 * line against the wrong time steps and looked entirely plausible.
 *
 * Overlay rule (user decision, MODEL-SERVE-020-D02, 2026-09-28): the current
 * version is drawn only on the rows BOTH versions were scored on. That is an
 * exact like-for-like picture; it is NOT a claim about the RMSE delta, which
 * MODEL-SERVE-019-D03 still refuses when the two sides' rows differ.
 */

import { buildFitRows, type FitPoint, type FitRow } from '@/lib/model-metrics'
import type { RunPredictionPoint, RunPredictions } from '@/services/model-draft'

/** The two data sets the charts can show. `CURRENT_TEST` is the test data of
 *  the current version (the new version is scored on the same rows, and the
 *  current version can be overlaid); `NEW_DATA` is the new data the operator
 *  set aside (only the new version was ever scored on it). */
export type RetrainChartDataSet = 'CURRENT_TEST' | 'NEW_DATA'

/** Colour of the current version's line. The evaluation chart draws its
 *  compare series with this exact token (`actual-vs-predicted-chart.tsx`,
 *  `residual-chart.tsx`); named here so the legend cannot claim a colour the
 *  chart does not use. */
export const CURRENT_VERSION_COLOR = 'var(--chart-4)'

export interface RetrainChartSeries {
  rows: FitRow[]
  /** The new version's own residual SD — what the SD bands are drawn around. */
  sd: number
  /** Rows the current version's line is drawn on; 0 when there is no overlay. */
  sharedRowCount: number
  /** Rows in the new version's series. */
  totalRowCount: number
  /** One plain sentence saying what the overlay covers (or why there is none).
   *  Null when no overlay was requested, so nothing is claimed. */
  overlayNote: string | null
}

function toFitPoint(p: RunPredictionPoint): FitPoint {
  return {
    timestamp: p.timestamp,
    actual: p.yTrue,
    predicted: p.yPred,
    residual: p.yTrue - p.yPred,
  }
}

/**
 * `current` is null when no overlay applies (the new-data data set, or the
 * current version has no series) — the rows then carry no compare values and
 * `overlayNote` stays null. When `current` is given, the note always says how
 * many rows it covers, including the case where that is none.
 */
export function buildRetrainSeries(
  candidate: RunPredictions,
  current: RunPredictions | null,
  currentLabel: string,
): RetrainChartSeries {
  const points = candidate.points.map(toFitPoint)
  const rows = buildFitRows(points, candidate.residualSd)
  const total = points.length

  if (current === null) {
    return {
      rows,
      sd: candidate.residualSd,
      sharedRowCount: 0,
      totalRowCount: total,
      overlayNote: null,
    }
  }

  const byTime = new Map<string, FitPoint>()
  for (const p of current.points) byTime.set(p.timestamp, toFitPoint(p))

  let shared = 0
  const overlaid = rows.map((row, i) => {
    const at = points[i]
    const match = at ? byTime.get(at.timestamp) : undefined
    if (!match) return row
    shared += 1
    return {
      ...row,
      comparePredict: match.predicted,
      compareResidual: match.residual,
    }
  })

  return {
    rows: overlaid,
    sd: candidate.residualSd,
    sharedRowCount: shared,
    totalRowCount: total,
    overlayNote:
      shared === 0
        ? `${currentLabel} was not scored on any of these rows, so it is not drawn.`
        : shared === total
          ? `${currentLabel} is drawn on all ${total.toLocaleString()} rows both versions were scored on.`
          : `${currentLabel} is drawn on the ${shared.toLocaleString()} of ${total.toLocaleString()} rows both versions were scored on.`,
  }
}
