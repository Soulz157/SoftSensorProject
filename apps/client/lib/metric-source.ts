/**
 * MODEL-FLOW-019-T02 — a metric's SOURCE travels with its value, in the type.
 *
 * Pure module — no React, no IO (the `lib/run-selection.ts` pattern). Three
 * sources exist in this system and they are three different claims about a
 * model, never three readings of one thing:
 *
 * - `test-split`   — scored on rows drawn from the SAME cleaned artifact the
 *                    model trained on, past the same crop/outlier/imputation
 *                    rules.
 * - `holdout`      — the dataset's raw validation holdout, split off at
 *                    BRONZE, that no fit ever saw. Under DS-LAKE-018's
 *                    resolved no-imputation decision it stays RAW, so a
 *                    MISSING_VALUE hole reaches predict() and depresses the
 *                    score for reasons that are not the model's fault —
 *                    which is why a holdout value here cannot be constructed
 *                    without its own row/dropped counts (DS-LAKE-018-T05).
 * - `cv-fold-estimate` — a fold MEAN with a spread, an estimate of the
 *                    CONFIGURATION rather than a measurement of the shipped
 *                    model. It deliberately has no `rmse`/`r2`/`mae` field:
 *                    a single number named like a measurement is exactly the
 *                    conflation MODEL-FLOW-016's finding 3 caught once
 *                    already.
 *
 * WHY A TAGGED UNION AND NOT A COLUMN HEADER: a header is a promise the
 * renderer makes; a tag is a fact the renderer cannot drop. MODEL-FLOW-004
 * had to RENAME a shipped heading ("Validation residual diagnostics" ->
 * "Test-split residual diagnostics") because a header had drifted from the
 * data beneath it. A header can drift again; `source` cannot go missing
 * without the value going with it.
 */

/** The three claims a number on this screen can be. */
export type MetricSource = 'test-split' | 'holdout' | 'cv-fold-estimate'

/** Short display word per source. `Est. CV` keeps the estimate/measurement
 *  distinction visible in the two characters a table column can afford —
 *  the same wording `StandaloneRunRow` shipped under MODEL-FLOW-018-T06. */
export const METRIC_SOURCE_LABELS: Record<MetricSource, string> = {
  'test-split': 'Test',
  holdout: 'Holdout',
  'cv-fold-estimate': 'Est. CV',
}

/** The three regression figures every source produces under the same
 *  spellings (one `regression_metrics()` helper in the trainer feeds test,
 *  train and holdout alike — images/trainer/app/metrics.py). */
export interface MetricTriple {
  r2: number | null
  rmse: number | null
  mae: number | null
}

/** A run's own test split. */
export interface TestSplitMetrics extends MetricTriple {
  source: 'test-split'
}

/**
 * The dataset's raw validation holdout. The counts are NOT optional
 * decoration — they are the only thing that separates "this model scores
 * 0.81" from "this model scored 0.81 on a holdout that was a third holes",
 * and DS-LAKE-018-T05 requires them beside every figure this source backs.
 * Each is independently nullable: a run scored before those keys existed
 * records the figure and not the counts, which must read as "not recorded"
 * rather than as zero dropped rows (MODEL-FLOW-010-T06's honest-legacy-null
 * pattern).
 */
export interface HoldoutMetrics extends MetricTriple {
  source: 'holdout'
  rowCount: number | null
  droppedUnlabelled: number | null
  droppedBadFeatures: number | null
}

/**
 * A CV run's fold aggregate. `mean` WITHOUT `std` is not the same claim —
 * a model at 0.6 ± 0.02 and one at 0.6 ± 0.4 are different findings, and
 * ranking on the mean alone discards the one thing k fits were paid for
 * (MODEL-FLOW-019 openDecisions item 2).
 */
export interface CvFoldEstimate {
  source: 'cv-fold-estimate'
  nSplits: number | null
  mean: MetricTriple
  std: MetricTriple
}

export type SourcedMetrics = TestSplitMetrics | HoldoutMetrics | CvFoldEstimate

/**
 * Why a holdout figure is absent — three different situations with three
 * different next actions, never one blank cell (MODEL-FLOW-019 AC11):
 *
 * - `no-dataset-holdout` — this dataset never had one. Not an error; the
 *   common case for much of this system. Nothing to do about it here.
 * - `not-scored-yet`     — a CV run that has not been through its own
 *   scoring phase. The next action is to trigger scoring (MODEL-FLOW-016).
 * - `not-recorded`       — the dataset HAS a holdout and this run still
 *   carries no figure: a run trained before the replay fix landed
 *   (MODEL-FLOW-016-T08, 2026-09-01), or a replay that failed. This one
 *   hides a real defect if it renders as a blank, which is why it is its
 *   own value and not folded into the first.
 */
export type HoldoutAbsence =
  | 'no-dataset-holdout'
  | 'not-scored-yet'
  | 'not-recorded'

/** A CV run's own scoring phase — moved here from
 *  `hooks/model/use-draft-run-evaluation` (MODEL-FLOW-016-T11) so the pure
 *  derivation lives in `lib/` with the rest of this module's source rules;
 *  that hook re-exports it, so every existing caller is unchanged. */
export type CvScoringPhase =
  | 'not-cv'
  | 'awaiting-scoring'
  | 'scoring'
  | 'scored'

/** The three run columns every source decision in this module reads. Named
 *  structurally rather than as `ModelTrainingRun`/`CandidateResult` so both
 *  shapes (and a test fixture) satisfy it without a cast. */
export interface CvScoringSignals {
  cvFoldsKey: string | null
  predictionsKey: string | null
  scoringContainerId: string | null
}

/**
 * Reads the three raw signals into the one phase Step 4/5 render from, so
 * that branching exists in exactly one place. A non-SUCCEEDED run has no
 * defined phase — callers check `status`/`fit` first, unchanged from where
 * this function previously lived.
 */
export function cvScoringPhaseOf(run: CvScoringSignals | null): CvScoringPhase {
  if (!run?.cvFoldsKey) return 'not-cv'
  if (run.predictionsKey) return 'scored'
  if (run.scoringContainerId) return 'scoring'
  return 'awaiting-scoring'
}

/** A metrics blob's numeric field, or null — never NaN, never a string
 *  coerced into a number. `metrics`/`holdoutMetrics` are untyped Json
 *  columns end to end (schema.prisma), so every read through them is a
 *  narrowing, not an assertion. */
function num(bag: Record<string, unknown> | null | undefined, key: string) {
  const v = bag?.[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** The run fields this module derives from. Satisfied by
 *  `ModelTrainingRunListItem` and by a candidate's own run projection. */
export interface MetricSourceRun extends CvScoringSignals {
  metrics: Record<string, unknown> | null
  holdoutMetrics: Record<string, unknown> | null
}

/**
 * Every figure this run can honestly show, each carrying what it is a
 * figure OF. Order is stable — the run's own training-side source first
 * (test split, or the fold estimate for a CV run), holdout second — so a
 * table's columns do not reorder between polls.
 *
 * A CV run contributes NO test-split entry: its `metrics` carry only
 * `cv_*` aggregates (no bare `rmse`), confirmed against every real CV run
 * in this system. A run whose dataset has no holdout contributes no
 * holdout entry — see `holdoutAbsenceOf` for why it is absent.
 */
export function sourcedMetricsOf(
  run: MetricSourceRun | null | undefined,
): SourcedMetrics[] {
  if (!run) return []
  const out: SourcedMetrics[] = []
  const metrics = run.metrics
  const isCv = Boolean(run.cvFoldsKey)

  if (isCv) {
    const mean: MetricTriple = {
      r2: num(metrics, 'cv_r2_mean'),
      rmse: num(metrics, 'cv_rmse_mean'),
      mae: num(metrics, 'cv_mae_mean'),
    }
    const std: MetricTriple = {
      r2: num(metrics, 'cv_r2_std'),
      rmse: num(metrics, 'cv_rmse_std'),
      mae: num(metrics, 'cv_mae_std'),
    }
    if (mean.r2 !== null || mean.rmse !== null || mean.mae !== null) {
      out.push({
        source: 'cv-fold-estimate',
        nSplits: num(metrics, 'n_splits'),
        mean,
        std,
      })
    }
  } else if (metrics) {
    out.push({
      source: 'test-split',
      r2: num(metrics, 'r2'),
      rmse: num(metrics, 'rmse'),
      mae: num(metrics, 'mae'),
    })
  }

  const holdout = run.holdoutMetrics
  if (holdout) {
    out.push({
      source: 'holdout',
      r2: num(holdout, 'r2'),
      rmse: num(holdout, 'rmse'),
      mae: num(holdout, 'mae'),
      rowCount: num(holdout, 'row_count'),
      droppedUnlabelled: num(holdout, 'dropped_unlabelled'),
      droppedBadFeatures: num(holdout, 'dropped_bad_features'),
    })
  }

  return out
}

/**
 * Why this run shows no holdout figure, or null when it shows one (and so
 * has nothing to explain). `datasetHasHoldout` is the dataset-level fact
 * the run row itself cannot answer — pass `null` when it is unknown, which
 * reads as `not-recorded` rather than as a guess.
 *
 * Only meaningful for a SUCCEEDED run: a queued, running or failed run has
 * no figure of any kind yet, and saying "not recorded" about it would
 * describe the wrong thing.
 */
export function holdoutAbsenceOf(
  run: (MetricSourceRun & { status: string }) | null | undefined,
  datasetHasHoldout: boolean | null,
): HoldoutAbsence | null {
  if (!run || run.status !== 'SUCCEEDED') return null
  if (run.holdoutMetrics) return null
  if (datasetHasHoldout === false) return 'no-dataset-holdout'
  if (cvScoringPhaseOf(run) !== 'not-cv' && !run.predictionsKey) {
    return 'not-scored-yet'
  }
  return 'not-recorded'
}

/**
 * The one figure a single-value surface (a comparison row, a summary line)
 * should lead with, and what it is a figure OF. The shipped model's own
 * holdout score wins where it exists — it is the only number no fit ever
 * saw; otherwise the run's own training-side figure. Null when the run
 * produced nothing.
 *
 * This is a DISPLAY choice for a one-number surface, deliberately NOT a
 * ranking rule: ranking a holdout-scored row against a test-scored one in
 * one column is what MODEL-FLOW-019-T03 forbids, and it needs the whole set
 * to decide, not one row.
 */
export function headlineMetricOf(
  sourced: SourcedMetrics[],
): SourcedMetrics | null {
  return (
    sourced.find(m => m.source === 'holdout') ??
    sourced.find(m => m.source !== 'holdout') ??
    null
  )
}

/** One figure out of a sourced value — the fold MEAN for a CV estimate,
 *  which is the only number of that shape it has. Callers that show a CV
 *  mean are responsible for showing the spread beside it (`std[key]`). */
export function metricValueOf(
  metric: SourcedMetrics,
  key: keyof MetricTriple,
): number | null {
  return metric.source === 'cv-fold-estimate' ? metric.mean[key] : metric[key]
}

/** A sourced value's own rmse — the metric this system ranks and compares
 *  on by default (MODEL-FLOW-005 chose it over r2 after a real run scored
 *  r2 = -1,110,858 while its rmse stayed readable). */
export function rmseOf(metric: SourcedMetrics): number | null {
  return metricValueOf(metric, 'rmse')
}
