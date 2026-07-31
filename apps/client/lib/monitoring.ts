/**
 * Pure builders for the Model Monitoring dashboard (`/models/monitoring`).
 * No React / IO — turns aligned `EvalPoint[]` into chart rows + window stats and
 * picks an adaptive time-axis formatter. Single source of truth for the
 * monitoring math; the page/components stay thin.
 */
import { format } from 'date-fns'
import type { EvalPoint } from '@/lib/model-evaluation'

/** One row per timestamp for the recharts monitoring charts. */
export interface MonitoringRow {
  /** Epoch ms — the numeric X value (recharts `type="number"`). */
  t: number
  timestamp: string
  actual: number
  predict: number
  /** actual − predict (spec sign; 0 = perfect prediction). */
  residual: number
  /** residual as a percentage of actual. */
  percentageError: number
  /**
   * ±k·SD band as [min, max] so recharts `Area` draws a filled band. Centered
   * on `actual` — the envelope wraps ground truth, so the prediction line sits
   * inside it exactly when the model is within k·SD of the real reading.
   */
  sd1: [number, number]
  sd2: [number, number]
  sd3: [number, number]
}

/**
 * Visible index window over a row array. `{}` means "full range" — both the
 * recharts `Brush` and `ChartZoomControls` speak this shape.
 */
export interface BrushWindow {
  startIndex?: number
  endIndex?: number
}

export interface WindowStats {
  /** Root mean square error over the window. */
  rmse: number
  /** Population SD of residuals over the window. */
  sd: number
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * Build chart rows from aligned actual/predicted points. `sd` is the residual
 * standard deviation the ±1/±2/±3 bands are drawn around the ACTUAL line, so
 * the shaded area strictly wraps the actual data points and the prediction is
 * read against it.
 */
export function buildMonitoringRows(
  points: EvalPoint[],
  sd: number,
): MonitoringRow[] {
  return points.map(p => {
    const residual = p.actual - p.predicted
    const percentageError = p.actual !== 0 ? (residual / p.actual) * 100 : 0
    const t = Date.parse(p.timestamp)
    return {
      t,
      timestamp: p.timestamp,
      actual: p.actual,
      predict: p.predicted,
      residual: round(residual),
      percentageError: round(percentageError),
      sd1: [round(p.actual - sd), round(p.actual + sd)],
      sd2: [round(p.actual - 2 * sd), round(p.actual + 2 * sd)],
      sd3: [round(p.actual - 3 * sd), round(p.actual + 3 * sd)],
    }
  })
}

/**
 * RMSE + population residual SD over a (visible) slice. Both recompute as the
 * user zooms/pans so the KPI, bands, and guardlines track the current window.
 */
export function windowStats(points: EvalPoint[]): WindowStats {
  const n = points.length
  if (n < 2) return { rmse: 0, sd: 0 }
  const residuals = points.map(p => p.actual - p.predicted)
  const sumSq = residuals.reduce((acc, r) => acc + r * r, 0)
  const rmse = Math.sqrt(sumSq / n)
  const mean = residuals.reduce((acc, r) => acc + r, 0) / n
  const variance = residuals.reduce((acc, r) => acc + (r - mean) ** 2, 0) / n
  return { rmse: round(rmse), sd: round(Math.sqrt(variance)) }
}

/**
 * Adaptive X-axis tick formatter keyed off the visible time span, so labels
 * scale from years/months (fully out) → days/hours → minutes/seconds (deep
 * zoom), per the monitoring spec.
 */
export function pickTimeFormat(spanMs: number): (t: number) => string {
  let pattern: string
  if (spanMs > 730 * DAY) pattern = 'yyyy'
  else if (spanMs > 60 * DAY) pattern = 'MMM yyyy'
  else if (spanMs > 2 * DAY) pattern = 'MMM d'
  else if (spanMs > 2 * HOUR) pattern = 'MMM d HH:mm'
  else if (spanMs > 2 * MINUTE) pattern = 'HH:mm'
  else pattern = 'HH:mm:ss'
  return (t: number) => format(t, pattern)
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}
