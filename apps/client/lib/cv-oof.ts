import type { CvFoldRecord, RunPredictionPoint } from '@/services/model-draft'
import { parseServerTimestamp } from '@/lib/monitoring'

/**
 * MODEL-FLOW-028-T04. Pure derivations for a CV run's out-of-fold (OOF) chart.
 *
 * The OOF file is deliberately three columns (`timestamp, y_true, y_pred`) so
 * the shared prediction reader takes it unchanged; which FOLD a row belongs to
 * is therefore derived here, from `cv_folds.json`'s `cut_timestamp`s. Fold i
 * covers `[cut_i, cut_{i+1})` — `cut_timestamp` is the first test row of the
 * fold (`splits.py` `expanding_fold_plan`), and test windows are contiguous.
 */

/** One clock for series points, fold cuts AND the normal Actual vs Predicted
 *  chart's rows (`buildMonitoringRows` parses with the same function). Both
 *  points and cuts come from the same pandas `str(Timestamp)` spelling
 *  ("2026-02-08 00:46:00"), so parsing them identically keeps the comparison
 *  exact — and a fold line lands on the same x as the row it opens. */
export function toMs(timestamp: string): number {
  return parseServerTimestamp(timestamp)
}

/** The x position of each fold's opening cut, ascending — what the normal
 *  chart draws as vertical boundary lines. Empty when no fold parses. */
export function foldCutXs(folds: readonly CvFoldRecord[]): number[] {
  return foldCutsOf(folds).map(c => c.t)
}

export interface FoldCut {
  fold: number
  t: number
}

/** Every fold's cut, ascending. Sorted here rather than trusted: this is the
 *  one place the boundary rule depends on order. */
export function foldCutsOf(folds: readonly CvFoldRecord[]): FoldCut[] {
  return folds
    .map(f => ({ fold: f.fold, t: toMs(f.cut_timestamp) }))
    .filter(c => Number.isFinite(c.t))
    .sort((a, b) => a.t - b.t)
}

/** The fold `t` falls in, or null when it precedes the first cut (a row no
 *  fold ever tested — it cannot be attributed, so it is not guessed). */
export function foldOf(t: number, cuts: readonly FoldCut[]): number | null {
  let fold: number | null = null
  for (const cut of cuts) {
    if (t >= cut.t) fold = cut.fold
    else break
  }
  return fold
}

/** The recharts data key a fold's predicted line reads. */
export function foldKey(fold: number): string {
  return `fold${fold}`
}

export interface OofRow {
  t: number
  actual: number
  /** `fold<N>` -> that fold's prediction on this row; every other fold's key
   *  is null, so each fold draws as its own segment. */
  [foldDataKey: string]: number | null
}

export interface OofSeries {
  rows: OofRow[]
  folds: number[]
  cuts: FoldCut[]
  /** Points that precede the first cut and so belong to no fold. */
  unassigned: number
}

/**
 * One row per point, with the prediction placed under its fold's own key.
 * Rows come out time-ordered regardless of input order.
 */
export function buildOofSeries(
  points: readonly RunPredictionPoint[],
  folds: readonly CvFoldRecord[],
): OofSeries {
  const cuts = foldCutsOf(folds)
  const foldNumbers = cuts.map(c => c.fold)
  const rows: OofRow[] = []
  let unassigned = 0

  const timed = points
    .map(p => ({ p, t: toMs(p.timestamp) }))
    .filter(x => Number.isFinite(x.t))
    .sort((a, b) => a.t - b.t)

  for (const { p, t } of timed) {
    const fold = foldOf(t, cuts)
    if (fold === null) {
      unassigned += 1
      continue
    }
    const row: OofRow = { t, actual: p.yTrue }
    for (const n of foldNumbers) row[foldKey(n)] = n === fold ? p.yPred : null
    rows.push(row)
  }
  return { rows, folds: foldNumbers, cuts, unassigned }
}

/** `var(--chart-N)` for fold position `index` (0-based), cycling the five
 *  chart tokens — k is capped by distinct labels, not by the palette. */
export function foldColor(index: number): string {
  return `var(--chart-${(index % 5) + 1})`
}
