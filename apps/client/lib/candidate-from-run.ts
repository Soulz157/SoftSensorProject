import { holdoutAbsenceOf, sourcedMetricsOf } from '@/lib/metric-source'
import type {
  CandidateResult,
  ModelTrainingRunListItem,
} from '@/services/model-draft'

/** A metrics blob's numeric field, or null — same narrowing every other
 *  reader of this untyped Json column already does (RunParamsPanel's own
 *  `rmse` field, `lib/run-comparison.ts`'s `numberField`). Never NaN, never
 *  a string coerced into a number. */
function numField(
  metrics: Record<string, unknown> | null,
  key: string,
): number | null {
  const v = metrics?.[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * MODEL-FLOW-019-T08 part 4. Maps a draft run row onto the SAME
 * `CandidateResult` shape the job path already produces, so both render
 * through `CandidateTable`/`CandidateOverlayChart` and never drift.
 *
 * Every field here is either read straight off `run` (most of them — the
 * run row and the job's own candidate shape share `predictionsKey`,
 * `cvFoldsKey`, `scoringContainerId`, `lossHistoryKey` exactly) or narrowed
 * from the same untyped `metrics` Json every other reader narrows
 * (`metrics`/`trainMetrics`, the `train_*` convention MODEL-FLOW-013-T04
 * established). `lossHistory` is the one honest exception: the run row
 * never carries the PARSED series (only the job response embeds it
 * inline), so it is `null` here rather than a fabricated shape — T08's own
 * rule against inventing a value a run row has no source for.
 *
 * `datasetHasHoldout` is the ONE dataset-level fact this run row cannot
 * answer itself — MODEL-FLOW-019-T20 follow-up. Was derived inline from
 * `cvScoringPhaseOf(run)` alone, which could never distinguish "this
 * dataset never had a holdout" from "not recorded yet": every standalone
 * run read `'not-recorded'` where the job path's own `holdoutAbsenceFor`
 * could say `'no-dataset-holdout'`. Delegating to the shared
 * `holdoutAbsenceOf` (`lib/metric-source.ts`) — the same rule the backend's
 * `holdoutAbsenceFor` mirrors for the job path — retires that drift rather
 * than fixing it a second time in this file alone.
 */
export function candidateFromRun(
  run: ModelTrainingRunListItem,
  datasetHasHoldout: boolean | null,
): CandidateResult {
  return {
    algorithm: run.algorithm,
    status: run.status,
    runId: run.id,
    phase: 1,
    hyperparameters: run.hyperparameters,
    failureReason: run.failureReason,
    metrics: run.metrics
      ? {
          r2: numField(run.metrics, 'r2'),
          rmse: numField(run.metrics, 'rmse'),
          mae: numField(run.metrics, 'mae'),
        }
      : null,
    trainMetrics: run.metrics
      ? {
          r2: numField(run.metrics, 'train_r2'),
          rmse: numField(run.metrics, 'train_rmse'),
          mae: numField(run.metrics, 'train_mae'),
        }
      : null,
    lossHistoryKey: run.lossHistoryKey,
    lossHistory: null,
    predictionsKey: run.predictionsKey,
    cvFoldsKey: run.cvFoldsKey,
    holdoutPredictionsKey: run.holdoutPredictionsKey,
    scoringContainerId: run.scoringContainerId,
    sourcedMetrics: sourcedMetricsOf(run),
    holdoutAbsence: holdoutAbsenceOf(run, datasetHasHoldout),
  }
}
