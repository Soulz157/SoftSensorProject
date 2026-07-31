/**
 * Model training-result metrics (single source of truth).
 *
 * Pure module — no React, no IO. Fits an OLS line over a deterministic tag pair
 * of the model-ready dataset and derives R² / RMSE / residual SD. Mirrors the
 * approved Phase-6 placeholder pattern (`lib/preprocessing.ts`,
 * `lib/model-evaluation.ts`) — when a real training backend lands, replace ONLY
 * `computeMetrics` with the served metrics; the `MetricKey` / `METRIC_META`
 * contract stays so the Results UI is untouched.
 */
import {
  CORRELATED_PAIR,
  linearRegression,
  toScatterPoints,
  type Dataset,
  type ScatterPoint,
} from '@/lib/preprocessing'
import { buildMonitoringRows, type MonitoringRow } from '@/lib/monitoring'

export type MetricKey = 'r2' | 'rmse' | 'sd'

export const METRIC_KEYS: MetricKey[] = ['r2', 'rmse', 'sd']

export interface ModelMetrics {
  /** Coefficient of determination from the OLS fit. */
  r2: number
  /** Root mean squared error of residuals. */
  rmse: number
  /** Standard deviation of residuals. */
  sd: number
  /** Aligned sample count — UI shows a placeholder when < 2. */
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

/**
 * Deterministic prediction target/feature pair. Prefers the correlated pair so
 * the fit is meaningful; otherwise falls back to the first two selected tags.
 */
export function pickDefaultPair(
  tags: string[],
): { xTag: string; yTag: string } | null {
  const { anchor, derived } = CORRELATED_PAIR
  if (tags.includes(anchor) && tags.includes(derived)) {
    return { xTag: anchor, yTag: derived }
  }
  if (tags.length >= 2 && tags[0] && tags[1]) {
    return { xTag: tags[0], yTag: tags[1] }
  }
  return null
}

const EMPTY_METRICS: ModelMetrics = { r2: 0, rmse: 0, sd: 0, n: 0 }

/**
 * Fit `yTag` on `xTag` over the model-ready dataset and return R² / RMSE / SD.
 * Returns `n = 0` (caller renders a placeholder) when fewer than 2 points exist.
 */
export function computeMetrics(
  modelReady: Dataset,
  xTag: string,
  yTag: string,
): ModelMetrics {
  const points = toScatterPoints(modelReady, xTag, yTag)
  const n = points.length
  if (n < 2) return { ...EMPTY_METRICS }

  const { slope, intercept, r2 } = linearRegression(points)
  const residuals = points.map(p => p.y - (slope * p.x + intercept))
  const meanRes = residuals.reduce((a, b) => a + b, 0) / n
  const sumSq = residuals.reduce((a, b) => a + b * b, 0)
  const rmse = Math.sqrt(sumSq / n)
  const variance =
    residuals.reduce((a, b) => a + (b - meanRes) * (b - meanRes), 0) / n
  const sd = Math.sqrt(variance)

  return { r2, rmse, sd, n }
}

export interface FitPoint {
  /** ISO 8601 — carried from the source row so the charts can plot over time. */
  timestamp: string
  actual: number
  predicted: number
  residual: number
}

export interface ModelFit extends ModelMetrics {
  slope: number
  intercept: number
  /** Per-sample actual / predicted / residual, for the evaluation charts. */
  points: FitPoint[]
}

const EMPTY_FIT: ModelFit = {
  ...EMPTY_METRICS,
  slope: 0,
  intercept: 0,
  points: [],
}

/**
 * Like `computeMetrics` but also returns the per-sample actual/predicted/residual
 * points — drives the Actual-vs-Predicted + Residual charts. Predicted is the OLS
 * fit `slope·x + intercept`; residual = actual − predicted.
 *
 * Values and timestamps are collected in a SINGLE pass over the rows (rather than
 * via `toScatterPoints` + a separate timestamp zip) — that helper applies a
 * cell-existence filter, so any second pass would desync the two arrays wherever
 * a row was dropped.
 */
export function computeFit(
  modelReady: Dataset,
  xTag: string,
  yTag: string,
): ModelFit {
  const raw: ScatterPoint[] = []
  const timestamps: string[] = []
  for (const row of modelReady.rows) {
    const x = row.cells[xTag]
    const y = row.cells[yTag]
    if (!x || !y) continue
    raw.push({ x: x.value, y: y.value })
    timestamps.push(row.timestamp)
  }

  const n = raw.length
  if (n < 2) return { ...EMPTY_FIT }

  const { slope, intercept, r2 } = linearRegression(raw)
  const points: FitPoint[] = raw
    .map((p, i) => {
      const predicted = slope * p.x + intercept
      return {
        timestamp: timestamps[i] ?? '',
        actual: p.y,
        predicted,
        residual: p.y - predicted,
      }
    })
    // Rows arrive chronologically today; sorting keeps the line monotonic in x
    // regardless of upstream ordering.
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
  const residuals = points.map(p => p.residual)
  const meanRes = residuals.reduce((a, b) => a + b, 0) / n
  const rmse = Math.sqrt(residuals.reduce((a, b) => a + b * b, 0) / n)
  const sd = Math.sqrt(
    residuals.reduce((a, b) => a + (b - meanRes) * (b - meanRes), 0) / n,
  )

  return { r2, rmse, sd, n, slope, intercept, points }
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
