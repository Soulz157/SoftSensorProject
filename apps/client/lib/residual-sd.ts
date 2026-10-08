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
import {
  cvScoringPhaseOf,
  holdoutSeriesAbsenceOf,
  type HoldoutSeriesAbsence,
  type HoldoutSeriesCandidate,
} from './metric-source'
import type { MetricSource } from './metric-source'
import type { RunPredictionsBatchItem } from '@/services/model-draft'

/**
 * MODEL-FLOW-019-T33. Widened from T10's five, and every addition is BORROWED
 * rather than invented — T33's own instruction is to depend on T29's absence
 * vocabulary instead of minting a sixth state of its own, so the non-CV
 * holdout causes arrive as `HoldoutSeriesAbsence` verbatim and
 * `holdoutSeriesAbsenceOf` stays their single decider. The only genuinely new
 * member is `no-test-split`, which names a case that could not arise while
 * there was one SD cell per row: a CV run's TEST column, definitionally empty
 * because the run never had a test split. It is terminal and carries no
 * action, the same asymmetry T28 states for its own two charts.
 */
export type ResidualSdAbsence =
  | 'awaiting-scoring'
  | 'scoring'
  | 'no-series'
  | 'unreadable'
  | 'not-recorded'
  | 'no-test-split'
  | HoldoutSeriesAbsence

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

/**
 * MODEL-FLOW-019-T33. Now `HoldoutSeriesCandidate` rather than bare
 * `CvScoringSignals` — the extra fields (`algorithm`, `holdoutPredictionsKey`,
 * `scoringContainerId`, `holdoutAbsence`) are exactly what
 * `holdoutSeriesAbsenceOf` reads, so the Validate column's absence is decided
 * by the SAME function T28's Validate chart and T29's Score button already
 * use. Duplicating that decision here is how a chart and a cell on one screen
 * come to give different reasons for one missing series.
 */
export interface ResidualSdRun extends HoldoutSeriesCandidate {
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
  /**
   * MODEL-FLOW-019-T33. POPULATION IS AN ARGUMENT, NEVER A DERIVATION, and
   * this is the fourth place that sentence has had to be written (T20's first
   * pass added the hazard to the overlay, T20's second removed it, T27/T28
   * were each warned off it). Deriving it from `cvScoringPhaseOf` returns
   * `test-split` UNCONDITIONALLY for a non-CV run, so a holdout SD read that
   * way would caption as Test — a number under the wrong column heading,
   * which is the one failure this whole feature exists to prevent.
   *
   * REQUIRED, not defaulted: every live caller has a column to disambiguate,
   * and a default would restore exactly the silent mis-captioning above for
   * the next caller that forgets it.
   */
  population: MetricSource,
): ResidualSdCell {
  if (run.status !== 'SUCCEEDED') {
    return { value: null, source: null, absence: null }
  }

  const source = population
  const isCv = Boolean(run.cvFoldsKey)

  if (population === 'test-split') {
    // A CV run has no test split BY DEFINITION — terminal, no action, never
    // "unscored work" a button could fix. This is the case that could not
    // arise while one cell was routed to whichever column matched its own
    // derived source: the other column simply rendered a bare dash, stating
    // nothing at all.
    if (isCv) {
      return { value: null, source, absence: 'no-test-split' }
    }
    if (!run.predictionsKey) {
      // MODEL-FLOW-004's endpoint predating this run's own training.
      return { value: null, source, absence: 'no-series' }
    }
  } else {
    // HOLDOUT. The two run kinds keep their series in different columns —
    // a CV run's `predictionsKey` IS its holdout; a non-CV run's holdout
    // lands in `holdoutPredictionsKey` — but that asymmetry is resolved
    // SERVER-SIDE by `predictionKeyFor`, so the caller's holdout batch is
    // already the right series for either kind and nothing here picks a key.
    // What still differs is the REASON a series is missing.
    const phase = cvScoringPhaseOf(run)
    if (phase === 'awaiting-scoring') {
      return { value: null, source, absence: 'awaiting-scoring' }
    }
    if (phase === 'scoring') {
      return { value: null, source, absence: 'scoring' }
    }
    if (isCv) {
      if (!run.predictionsKey) {
        return { value: null, source, absence: 'no-series' }
      }
    } else {
      // T33 depends on T29's decision here rather than inventing its own
      // states: `predates-recording` and `not-scored-yet` stay separate
      // TYPE members (T29's result says so explicitly, naming this task),
      // and collapse only in the rendered sentence.
      const absence = holdoutSeriesAbsenceOf(run)
      if (absence) return { value: null, source, absence }
    }
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
