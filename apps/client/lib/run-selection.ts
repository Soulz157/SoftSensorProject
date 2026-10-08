/**
 * MODEL-FLOW-013-T05a/T07 — pure derivations over a candidate job's
 * `CandidateResult`s for the Model Selection step. No IO, no React.
 */
import type { CandidateResult } from '@/services/model-draft'

export type RenderMode = 'A' | 'B'

/**
 * The render mode is a property of the RUN, never a hardcoded algorithm
 * list — mode A (a real per-iteration curve) iff the run actually produced
 * a `lossHistory` (train.py's `extract_loss_history` wrote one and this
 * candidate's job read it back successfully); mode B (paired train/test
 * marks) otherwise. A future algorithm added to the catalogue with no
 * matching `extract_loss_history` branch falls to mode B automatically —
 * the honest state — rather than an empty mode-A chart.
 */
export function renderModeFor(candidate: CandidateResult): RenderMode {
  return candidate.lossHistory ? 'A' : 'B'
}

export interface ModeARow {
  iteration: number
  train: number | null
  validation: number | null
}

/**
 * One row per iteration, index-aligned across whichever series are present
 * — `validation` stays null for the whole series when the run's history had
 * none (mlp always; hist_gradient_boosting whenever early_stopping did not
 * resolve true), so the chart can omit that line rather than draw one from
 * nulls.
 */
export function modeARows(candidate: CandidateResult): ModeARow[] {
  const history = candidate.lossHistory
  if (!history) return []
  const train = history.series.train ?? []
  const validation = history.series.validation ?? null
  return train.map((value, i) => ({
    iteration: i + 1,
    train: value,
    validation: validation ? (validation[i] ?? null) : null,
  }))
}

export function modeAHasValidationSeries(candidate: CandidateResult): boolean {
  return Boolean(candidate.lossHistory?.series.validation)
}

/** Y-axis label for mode A — never assumed comparable across algorithms;
 *  "rmse" only when the run's own history says so (lightgbm/xgboost,
 *  explicitly requested at fit time), "loss" otherwise (mlp/hgb, the
 *  estimator's own native units). */
export function modeAMetricLabel(candidate: CandidateResult): string {
  const metric = candidate.lossHistory?.metric
  return metric === 'rmse' ? 'RMSE' : 'Loss'
}

export interface ModeBMark {
  label: 'Train' | 'Test'
  rmse: number | null
}

/**
 * Two paired marks, train RMSE and test RMSE — NEVER a line between them.
 * A two-point line is visually indistinguishable from a real curve to a
 * reader, the exact failure class MODEL-FLOW-000-T02 exists to name.
 */
export function modeBMarks(candidate: CandidateResult): ModeBMark[] {
  return [
    { label: 'Train', rmse: candidate.trainMetrics?.rmse ?? null },
    { label: 'Test', rmse: candidate.metrics?.rmse ?? null },
  ]
}
