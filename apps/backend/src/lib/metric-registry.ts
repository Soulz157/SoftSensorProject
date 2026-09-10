/**
 * MODEL-SERVE-006-T08 (Pass B, evaluation-only scope). ONE definition set
 * for what a "metric" is in this system — name, label, and whether it is
 * BACKFILLABLE, per decisions.metrics_are_derived_from_predictions_not_
 * computed_at_fit: computable from (actual, predicted) alone, with no
 * re-fit, for ANY historical run whose predictions are still stored.
 *
 * Matches `apps/client/lib/model-metrics.ts`'s `MetricKey`/`METRIC_META`
 * vocabulary EXACTLY (r2/rmse/mae/sd) — this is a formalization of what
 * that file already computes server-side (MODEL-FLOW-004: the client
 * fits nothing, `ModelTrainingRun.metrics`/predictions.parquet already
 * carry these), not a new taxonomy.
 *
 * SCOPE, STATED EXPLICITLY (not silently glossed): all four are
 * backfillable for EVALUATION (a run's own test-split predictions,
 * pinned and stored). NONE are backfillable for MONITORING windows
 * today — `metrics.json` there (pipelines/infer.py's D6 summary) has no
 * `actual` at all, because ground truth is not joined
 * (MODEL-SERVE-005-T03 stays blocked). Adding a metric here never
 * requires a refit for evaluation history; it does nothing for
 * monitoring until that join lands — a future pass's job, not this one's.
 */
export interface MetricRegistryEntry {
  key: 'r2' | 'rmse' | 'mae' | 'sd';
  label: string;
  hint: string;
  /** True iff computable from stored (actual, predicted) pairs alone, for
   *  historical evaluation runs, with no re-fit. */
  backfillable: boolean;
}

export const METRIC_REGISTRY: MetricRegistryEntry[] = [
  {
    key: 'r2',
    label: 'R²',
    hint: 'Coefficient of determination',
    backfillable: true,
  },
  {
    key: 'rmse',
    label: 'RMSE',
    hint: 'Root mean squared error',
    backfillable: true,
  },
  { key: 'mae', label: 'MAE', hint: 'Mean absolute error', backfillable: true },
  {
    key: 'sd',
    label: 'SD',
    hint: 'Residual standard deviation',
    backfillable: true,
  },
];
