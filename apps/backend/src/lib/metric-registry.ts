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
 * pinned and stored).
 *
 * UPDATED 2026-09-14 (MODEL-SERVE-005-T03). They are now backfillable for
 * MONITORING windows too, but from a DIFFERENT object than this comment
 * previously named. `metrics.json` (pipelines/infer.py's D6 summary) still
 * has no `actual` and never will — that file is written at scoring time,
 * hours or days before the lab reports. The joined pairs live in
 * `truth.parquet` beside it, written by the ground-truth sweep, and
 * `InferenceWindowTruth` carries their sufficient statistics. So adding a
 * metric here requires no refit on EITHER side; for monitoring it requires
 * only a recompute from stored pairs, never a second fetch from the
 * historian.
 *
 * The boundary that remains: a window with NO joined pairs reports no
 * metric at all — `lib/live-error.ts` returns null rather than zero, and
 * this registry's `backfillable` flag says a metric CAN be computed where
 * truth exists, never that truth exists everywhere.
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
