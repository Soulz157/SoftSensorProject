/**
 * Model training-result metrics (single source of truth).
 *
 * Pure module — no React, no IO. MODEL-FLOW-004: the client no longer fits
 * anything — `r2`/`rmse`/`sd` come from the training run's own `metrics.json`
 * (via `ModelTrainingRun.metrics`), and the per-sample actual/predicted
 * points come from the run's `predictions.parquet`, both read server-side.
 * `fitFromRun` is the seam: it wraps served numbers in the same `ModelFit`
 * shape the Evaluation UI already renders, so `METRIC_KEY` / `METRIC_META` /
 * `buildFitRows` and both charts stay untouched.
 */
import { buildMonitoringRows, type MonitoringRow } from '@/lib/monitoring'

export type MetricKey = 'r2' | 'rmse' | 'sd'

export const METRIC_KEYS: MetricKey[] = ['r2', 'rmse', 'sd']

export interface ModelMetrics {
  /** Coefficient of determination from the run's own metrics.json. */
  r2: number
  /** Root mean squared error, from the run's own metrics.json. */
  rmse: number
  /** Standard deviation of residuals, computed server-side over the full test split. */
  sd: number
  /** Sample count (test_rows) — UI shows a placeholder when < 2. */
  n: number
}

export interface MetricMeta {
  label: string
  hint: string
  /** Format a metric value for display. */
  format: (v: number) => string
  /** Optional threshold-based accent class (Tailwind text-* token). */
  accent?: (v: number) => string | undefined
}

const fmt2 = (v: number) =>
  v.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

export const METRIC_META: Record<MetricKey, MetricMeta> = {
  r2: {
    label: 'R²',
    hint: 'Coefficient of determination',
    format: v => v.toFixed(3),
    accent: v =>
      v >= 0.85
        ? 'text-emerald-500'
        : v >= 0.7
          ? 'text-amber-500'
          : 'text-red-500',
  },
  rmse: {
    label: 'RMSE',
    hint: 'Root mean squared error',
    format: fmt2,
  },
  sd: {
    label: 'SD',
    hint: 'Residual standard deviation',
    format: fmt2,
  },
}

export interface FitPoint {
  /** ISO 8601 — carried from the source row so the charts can plot over time. */
  timestamp: string
  actual: number
  predicted: number
  residual: number
}

export interface ModelFit extends ModelMetrics {
  /** Per-sample actual / predicted / residual, for the evaluation charts. */
  points: FitPoint[]
}

/**
 * Wrap a training run's served metrics + predictions in the `ModelFit` shape
 * the Evaluation UI renders. `n` is always `points.length` — the endpoint
 * behind `points` has no decimation branch, so the two never disagree.
 */
export function fitFromRun(
  points: FitPoint[],
  metrics: { r2: number; rmse: number; sd: number },
): ModelFit {
  return {
    r2: metrics.r2,
    rmse: metrics.rmse,
    sd: metrics.sd,
    n: points.length,
    points,
  }
}

/**
 * One row per timestamp for the evaluation charts. Extends the monitoring row
 * (which already carries the ±1/±2/±3 SD band tuples) with the optional
 * comparison model's series — recharts renders from a single data array, so the
 * compared series has to live on the same rows.
 */
export interface FitRow extends MonitoringRow {
  comparePredict: number | null
  compareResidual: number | null
}

/**
 * Build evaluation chart rows from a fit. `sd` is the residual standard
 * deviation the SD bands are drawn around the actual line — the true SD, so the
 * "±1 SD" band on the Actual-vs-Predicted chart and the ±1/±2/±3 layers on the
 * Residual chart mean the same thing.
 */
export function buildFitRows(
  points: FitPoint[],
  sd: number,
  compare?: FitPoint[] | null,
): FitRow[] {
  return buildMonitoringRows(points, sd).map((row, i) => {
    const c = compare?.[i]
    return {
      ...row,
      comparePredict: c?.predicted ?? null,
      compareResidual: c?.residual ?? null,
    }
  })
}
