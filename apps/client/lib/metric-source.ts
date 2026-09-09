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
  holdout: 'Validate',
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
 * - `not-scored-yet`     — the dataset HAS a holdout (confirmed, not
 *   assumed) and this run has not been through a scoring phase that could
 *   produce a figure. The next action is to trigger scoring (MODEL-FLOW-016
 *   for a CV run; MODEL-FLOW-019-T20 widened the same trigger to any
 *   SUCCEEDED run — a stale non-CV run whose inline training-time replay
 *   failed is retroactively fixable through the exact same action, not a
 *   dead end).
 * - `not-recorded`       — EITHER the dataset-holdout fact itself is
 *   unknown (`datasetHasHoldout === null` — the lookup was skipped or
 *   soft-failed, which must read as "not recorded" rather than as a guess
 *   in either direction), or this run's own status makes the question
 *   moot. Never reached for a SUCCEEDED run on a CONFIRMED holdout-bearing
 *   dataset as of T20 — that case is always `not-scored-yet` now, since a
 *   remedy always exists.
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
  // MODEL-FLOW-019-T20. Was `cvScoringPhaseOf(run) !== 'not-cv' && ...` —
  // CV-only, because only a CV run could trigger scoring. Now any
  // SUCCEEDED run can, so a CONFIRMED holdout-bearing dataset with no
  // figure yet is always actionable, never a bare defect claim.
  if (datasetHasHoldout === true) return 'not-scored-yet'
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

/**
 * MODEL-FLOW-019 AC2. What fraction of the holdout's rows never reached a
 * score, beside the figure it qualifies — a holdout value with a third of
 * its rows dropped as unlabelled/bad-feature is a different claim than one
 * with none, and this system does not let the two look the same (DS-LAKE-
 * 018-T05's own reasoning, `HoldoutMetrics`'s own doc comment above).
 *
 * `rowCount` is the SCORED count (post-drop); the original sample is
 * `rowCount + droppedUnlabelled + droppedBadFeatures`, so the rate is
 * dropped-over-original, never dropped-over-scored.
 *
 * `'missing rate not recorded'`, never `'0.0% missing'`, when any of the
 * three counts is null — a run scored before these columns existed carries
 * a figure with no counts beside it, and reporting 0% would claim a clean
 * sample this run never actually measured (the same honest-legacy-null
 * discipline `holdoutAbsenceOf` already follows).
 */
export function holdoutMissingRateText(metric: HoldoutMetrics): string {
  const { rowCount, droppedUnlabelled, droppedBadFeatures } = metric
  if (
    rowCount === null ||
    droppedUnlabelled === null ||
    droppedBadFeatures === null
  ) {
    return 'missing rate not recorded'
  }
  const dropped = droppedUnlabelled + droppedBadFeatures
  const original = rowCount + dropped
  const rate = original > 0 ? (dropped / original) * 100 : 0
  return `${rate.toFixed(1)}% missing (n=${rowCount})`
}

/**
 * MODEL-FLOW-019-T20. AC2 for a GROUP of candidates sharing one holdout
 * chart, rather than for a single figure.
 *
 * AC2 ("a holdout figure is never shown without its own missing rate") was
 * written for one number in one cell; a chart plots many candidates' rows at
 * once and needs the same fact stated once. Candidates in a job share a
 * dataset and so normally share one rate — but that is a fact to CHECK, not
 * to assume: the standalone path can group runs across artifacts, and
 * silently printing the first candidate's rate over a group with several
 * would be a wrong number wearing a precise format.
 *
 * `undefined` when no candidate here has a holdout figure at all — the
 * caller then has no holdout chart to qualify, which is not the same as a
 * clean 0% sample and must not read like one.
 */
export function holdoutGroupMissingRateText(
  perCandidate: SourcedMetrics[][],
): string | undefined {
  const texts = new Set<string>()
  for (const sourced of perCandidate) {
    const holdout = sourced.find(m => m.source === 'holdout')
    if (holdout) texts.add(holdoutMissingRateText(holdout))
  }
  if (texts.size === 0) return undefined
  const [only] = [...texts]
  if (texts.size === 1) return `Holdout ${only}.`
  return `Holdout missing rate differs by candidate: ${[...texts].join('; ')}.`
}

/** The per-candidate facts `groupAbsenceText` needs — the STRUCTURAL
 *  minimum, so both of phase-4's shapes and Step 3's run rows satisfy it. */
export interface GroupAbsenceCandidate {
  cvFoldsKey: string | null
  holdoutAbsence: HoldoutAbsence | null
}

/**
 * MODEL-FLOW-019-T20 follow-up. WHY a population's overlay chart has no
 * series to draw, in one sentence, for the group as a whole.
 *
 * Until now that chart rendered `null` — it vanished. Vanishing is the one
 * outcome this feature exists to prevent: a reader who sees a test-split
 * chart and no holdout chart cannot tell whether the holdout does not
 * apply, was never scored, or failed to load, and the empty screen argues
 * for whichever they already believed. AC11 already refused a blank CELL
 * for exactly this reason ("three facts, three different next actions —
 * never one blank cell"); a missing chart is a blank cell the size of the
 * panel.
 *
 * It also made AC2 unreachable in practice: `holdoutGroupMissingRateText`
 * is passed to a chart that returns null whenever no candidate has a
 * holdout series, which is every real draft today, so the qualifier it
 * produces has never once appeared on screen.
 *
 * Stated by the GROUP rather than per candidate because the chart is one
 * figure over many runs — the same discipline `holdoutGroupMissingRateText`
 * follows directly above.
 */
export function groupAbsenceText(
  population: EvaluationPopulation,
  candidates: GroupAbsenceCandidate[],
): string {
  if (candidates.length === 0) return 'No candidates in this group.'

  if (population === 'test-split') {
    // A CV run has no test split AT ALL — cv_folds.json describes the fold
    // configuration, and the refit model that ships is scored separately.
    // So an all-CV group is not missing anything; naming it "missing" would
    // invent a defect out of a run kind behaving correctly.
    if (candidates.every(c => c.cvFoldsKey)) {
      return (
        'Every candidate here is cross-validated, and a cross-validated ' +
        'run has no test split — its held-out figure comes from the ' +
        'separate holdout scoring phase instead.'
      )
    }
    return artifactAbsenceText(population)
  }

  const absences = new Set(candidates.map(c => c.holdoutAbsence))
  if (absences.size === 1 && absences.has('no-dataset-holdout')) {
    return 'This dataset has no validation holdout, so there is nothing to score against.'
  }
  // ACTIONABLE, and phrased as such: the run is fine, the scoring phase
  // simply has not run. MODEL-FLOW-019-T20 widened scoring to non-CV runs,
  // so this is now a state the user can leave, not a defect they are stuck
  // reading about.
  if (absences.has('not-scored-yet')) {
    return 'No candidate has been scored against the validation holdout yet — scoring runs separately from training.'
  }
  return artifactAbsenceText(population)
}

/**
 * The plainest absence a population can report: nothing recorded, no reason
 * known beyond that.
 *
 * The population word is DERIVED from `populationLabel`, never spelled into
 * the sentence. This module's display vocabulary is live — 'Holdout' was
 * respelled to 'Validate' mid-flight to match `METRIC_SOURCE_LABELS` — and a
 * blanket rename over a hardcoded copy of it produced "a validate
 * predictions artifact", which is not English. Deriving keeps the next
 * rewording grammatical for free.
 */
function artifactAbsenceText(population: EvaluationPopulation): string {
  return `No candidate recorded a ${populationLabel(population)} predictions artifact.`
}

/**
 * MODEL-FLOW-019-T20 follow-up. The candidates a chart could NOT draw, when
 * it drew at least one — named, never silently dropped.
 *
 * The PARTIAL case is more dangerous than the empty one: a chart headed
 * "Overall candidate comparison" that quietly omits two of five candidates
 * looks complete and is not. The standalone path can group a CV run and a
 * non-CV run onto one target, and then each population's chart drops
 * whichever candidates lack that population — in opposite directions, with
 * neither chart saying so.
 *
 * `undefined` when every candidate is drawn, so a complete chart carries no
 * caveat at all.
 */
export function groupOmittedText(
  drawnRunIds: Set<string>,
  candidates: { runId: string | null; label: string }[],
): string | undefined {
  const omitted = candidates.filter(c => !c.runId || !drawnRunIds.has(c.runId))
  if (omitted.length === 0) return undefined
  return `Not drawn (no series for this population): ${omitted
    .map(c => c.label)
    .join(', ')}.`
}

/**
 * MODEL-FLOW-019-T15. WHICH POPULATION a predictions file describes.
 *
 * DERIVED from `MetricSource`, never declared beside it: a predictions
 * file is written by training (the test split) or by scoring (the raw
 * validation holdout), and is never a fold ESTIMATE — so this is that
 * union minus the one member it cannot be. A hand-written second union
 * would be the second-source-of-truth this feature's own T11 and T12 each
 * refused for pair lists and MODEL-FLOW-013-T05a refused for render
 * modes, and it would drift the moment `MetricSource` gains a member or
 * respells one.
 */
export type EvaluationPopulation = Extract<
  MetricSource,
  'test-split' | 'holdout'
>

/**
 * The population a run's predictions file describes, from its own scoring
 * phase. EXHAUSTIVE OVER ALL FOUR PHASES BY CONSTRUCTION rather than by
 * control flow: `awaiting-scoring` and `scoring` are CV runs that have no
 * test split to name at all, and today they only avoid being mislabelled
 * because two early returns fire before any chart renders. A fifth phase
 * fails to compile here (`never`) instead of silently defaulting to a
 * label — T01 already recorded that `cvScoringPhaseOf` has FOUR states
 * after this feature's own finding said three.
 */
export function populationOf(phase: CvScoringPhase): EvaluationPopulation {
  switch (phase) {
    case 'not-cv':
      return 'test-split'
    case 'scored':
      return 'holdout'
    // A CV run before its own scoring phase has produced no predictions
    // file yet. Callers reach a chart only past an early return, so this
    // names the population that file WILL have rather than inventing a
    // test split the run never had.
    case 'awaiting-scoring':
    case 'scoring':
      return 'holdout'
    default: {
      const unreachable: never = phase
      return unreachable
    }
  }
}

/**
 * THREE LABEL FORMS, ALL IN THIS FILE, because an axis, a sentence and a
 * heading each need different words, and the file that owns the source
 * owns every name for it. This deliberately does NOT resolve
 * Holdout-vs-Validate (MODEL-FLOW-019-T04 argues for 'Holdout' since
 * `validate` names the dataset QUALITY GATE in this codebase;
 * MODEL-FLOW-021 records a concurrent partial rename toward 'Validate'
 * and leaves it an open user decision) — it makes that decision a
 * one-line change in one file, whichever way it goes.
 */

/** Axis/column form, in the split vocabulary `METRIC_SOURCE_LABELS`
 *  already uses for Step 4's own columns — 'Test' / 'Validate'. */
export function populationAxisLabel(p: EvaluationPopulation): string {
  return METRIC_SOURCE_LABELS[p]
}

/** Prose form, for the middle of a sentence. */
export function populationLabel(p: EvaluationPopulation): string {
  return p === 'holdout' ? 'validation holdout' : 'test split'
}

/** Heading form — capitalised, standalone. */
export function populationTitle(p: EvaluationPopulation): string {
  return p === 'holdout' ? 'Validate' : 'Test-split'
}
