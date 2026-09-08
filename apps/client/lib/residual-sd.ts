/**
 * MODEL-FLOW-019-T10 — residual SD, back on Step 4, tagged with the
 * population it was computed over.
 *
 * AMENDS T04's own "SD IS NOT A TABLE COLUMN" and this feature's own
 * userDecision "sd is residual-derived and absent from both metrics and
 * holdoutMetrics, so Step 4 must render it as unavailable-for-this-source" —
 * both true of the source they described (the run row's own `metrics`/
 * `holdoutMetrics`), both false of the source Step 4 now has. MODEL-FLOW-
 * 019-T06 wired `useCandidatePredictions` into the table for the reveal-on-
 * demand charts, and `run_predictions_batch` carries `residual_sd` per run
 * (computed over the FULL frame, before decimation — `artifact_service.py`)
 * — a cell reading a field of a response Step 4 already fetches, not a new
 * endpoint or column.
 *
 * Pure module — no React, no IO (the `lib/metric-source.ts` pattern).
 *
 * SD CARRIES A SOURCE LIKE EVERY OTHER FIGURE (AC32). MODEL-FLOW-017-T01
 * finding 5: `predictions.parquet` holds a DIFFERENT population depending on
 * scoring phase — a non-CV run's own test split, or a SCORED CV run's
 * holdout (`score.py` writes the holdout under the same `predictionsKey` a
 * non-CV run's test split uses). So residual SD is a test-split figure or a
 * holdout figure and the two are not interchangeable — `cvScoringPhaseOf`
 * (already relied on by `lib/metric-source.ts`) is the single source of
 * that fact, never re-derived from `cvFoldsKey` here.
 *
 * ABSENCE IS ONE OF THREE HONEST CAUSES (AC32), never a blank cell:
 * - `awaiting-scoring` / `scoring` — a CV run has no `predictions.parquet`
 *   at train time by design (MODEL-FLOW-016-T06); the next action is to
 *   score it, or wait for scoring already in flight.
 * - `no-series`   — a non-CV SUCCEEDED run with `predictionsKey === null`,
 *   predating MODEL-FLOW-004's endpoint. Nothing to do about it here.
 * - `unreadable`  — a `predictionsKey` exists but the batch item carries its
 *   own `error` (an over-size frame, or a prefix MODEL-FLOW-011's sweeper
 *   reclaimed — MODEL-FLOW-018-T07's open finding that a selected-but-
 *   unsaved run's bytes are still reclaimable makes this a live case, not a
 *   theoretical one). This is the one cause that hides a real defect and
 *   must never render as a plain dash.
 * - `not-recorded` — the key and the batch item both exist but carry no
 *   number and no error either — the honest fallback bucket for a shape
 *   this module has not otherwise named.
 * A row not yet SUCCEEDED renders no reason at all (`source: null`) — the
 * same plain-dash treatment every other metric column already gives a
 * non-terminal row.
 */
import { cvScoringPhaseOf, type CvScoringSignals } from './metric-source'
import type { MetricSource } from './metric-source'
import type { RunPredictionsBatchItem } from '@/services/model-draft'

export type ResidualSdAbsence =
  | 'awaiting-scoring'
  | 'scoring'
  | 'no-series'
  | 'unreadable'
  | 'not-recorded'

export interface ResidualSdCell {
  value: number | null
  /** Which population `value` is a figure of — or which population it
   *  WOULD be, when absent (a CV run awaiting scoring still resolves to
   *  `holdout`, since that is where its figure lands once scored). Null
   *  only for a row with no defined figure of any kind yet (not SUCCEEDED). */
  source: MetricSource | null
  absence: ResidualSdAbsence | null
  errorText?: string
}

export interface ResidualSdRun extends CvScoringSignals {
  status: string
}

/**
 * `item` is this run's own entry from `useCandidatePredictions`' batch map,
 * or `undefined` when the run has not been fetched (not requested, or the
 * request has not resolved yet — `loading` disambiguates the two: a batch
 * genuinely in flight reports no absence reason at all rather than guessing
 * "not-recorded" about a fetch that has not finished).
 */
export function residualSdOf(
  run: ResidualSdRun,
  item: RunPredictionsBatchItem | undefined,
  loading: boolean,
): ResidualSdCell {
  if (run.status !== 'SUCCEEDED') {
    return { value: null, source: null, absence: null }
  }

  const phase = cvScoringPhaseOf(run)
  if (phase === 'awaiting-scoring') {
    return { value: null, source: 'holdout', absence: 'awaiting-scoring' }
  }
  if (phase === 'scoring') {
    return { value: null, source: 'holdout', absence: 'scoring' }
  }

  // `phase` is now 'not-cv' or 'scored' — both resolve to a defined source,
  // per MODEL-FLOW-017-T01 finding 5 (module doc above).
  const source: MetricSource = phase === 'scored' ? 'holdout' : 'test-split'

  if (!run.predictionsKey) {
    // Reachable only for a non-CV run: `cvScoringPhaseOf` returns 'scored'
    // (not 'not-cv') exactly when `predictionsKey` is set, so a CV run
    // never lands here — this is MODEL-FLOW-004's endpoint predating this
    // run's own training.
    return { value: null, source, absence: 'no-series' }
  }

  if (loading) {
    // In flight — nothing to report yet, and reporting one of the causes
    // below would be a guess about a fetch that has not resolved.
    return { value: null, source, absence: null }
  }

  if (!item) {
    return { value: null, source, absence: 'not-recorded' }
  }

  if (item.error) {
    return { value: null, source, absence: 'unreadable', errorText: item.error }
  }

  if (item.residualSd === null) {
    return { value: null, source, absence: 'not-recorded' }
  }

  return { value: item.residualSd, source, absence: null }
}
