/**
 * Pure builders for the Model Monitoring tab (`models/[id]`, Monitoring tab —
 * moved off the old standalone `/models/monitoring` route).
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

const HAS_TZ = /[Zz]|[+-]\d{2}:?\d{2}$/

/**
 * MODEL-FLOW-019-T21. The backend's wire form is zone-less —
 * `YYYY-MM-DD HH:mm:ss` (artifact_service.py's `ts.isoformat(sep=' ')`), not
 * an ECMA-262 date-time string. `Date.parse` treats a bare space-separated
 * string as LOCAL time, so the same instant renders at a different
 * wall-clock position depending on the viewer's timezone. Normalize to an
 * unambiguous UTC ISO string first; a string that already carries a zone
 * (tests, or any future caller) passes through untouched. Returns `NaN` on
 * an unparseable input rather than throwing — callers must check.
 */
export function parseServerTimestamp(ts: string): number {
  const iso = HAS_TZ.test(ts) ? ts : `${ts.replace(' ', 'T')}Z`
  return Date.parse(iso)
}

/**
 * Build chart rows from aligned actual/predicted points. `sd` is the residual
 * standard deviation the ±1/±2/±3 bands are drawn around the ACTUAL line, so
 * the shaded area strictly wraps the actual data points and the prediction is
 * read against it. A point whose timestamp fails to parse is dropped rather
 * than plotted at epoch 0.
 */
export function buildMonitoringRows(
  points: EvalPoint[],
  sd: number,
): MonitoringRow[] {
  return points.flatMap(p => {
    const t = parseServerTimestamp(p.timestamp)
    if (Number.isNaN(t)) return []
    const residual = p.actual - p.predicted
    const percentageError = p.actual !== 0 ? (residual / p.actual) * 100 : 0
    return [
      {
        t,
        timestamp: p.timestamp,
        actual: p.actual,
        predict: p.predicted,
        residual: round(residual),
        percentageError: round(percentageError),
        sd1: [round(p.actual - sd), round(p.actual + sd)] as [number, number],
        sd2: [round(p.actual - 2 * sd), round(p.actual + 2 * sd)] as [
          number,
          number,
        ],
        sd3: [round(p.actual - 3 * sd), round(p.actual + 3 * sd)] as [
          number,
          number,
        ],
      },
    ]
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

/** MODEL-SERVE-001-T18. `truthLagMinutes` and `cadenceMinutes` are stored in
 *  minutes; every real schedule sets them to a round hour count (1440 = 24h,
 *  60 = 1h, T03's own precedent), so a plain hour/minute split reads
 *  naturally without pulling in a duration-formatting library for one
 *  readout. Lives here rather than in the tab because T05's note below is a
 *  pure derivation and had to be testable without rendering the page. */
export function formatLagDuration(minutes: number): string {
  return minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`
}

/**
 * MODEL-SERVE-008-T05, the unconditional half. A residual is
 * predicted − actual, so it cannot exist without a MEASURED actual and the
 * Residual chart can never be denser than the lab — no cadence, driver or
 * refresh rate changes that. The sentence renders in BOTH states on purpose:
 * empty, it distinguishes a physical limit from a gap someone forgot to
 * close; populated, it explains why there are so few points.
 *
 * Takes the cadence alone, not the whole coverage object: the claim is about
 * how often the model SCORES versus how often the lab reports, and passing
 * the scheduling fact it actually reads keeps this callable from a test
 * without constructing a payload.
 */
export function residualDensityNote(cadenceMinutes: number | null): string {
  const base =
    'A residual needs a measured actual, so this chart can only ever be as dense as the lab'
  // No schedule means no scoring rate to contrast against — the limit is
  // still true, so the sentence still renders, just without the comparison.
  return cadenceMinutes
    ? `${base} — the model scores every ${formatLagDuration(cadenceMinutes)}, but each point here needs a lab measurement to pair with.`
    : `${base}.`
}

/**
 * MODEL-SERVE-008-T04. A chart row that may carry the DENSE predicted
 * series, the joined pair, or both.
 *
 * DELIBERATELY NOT `MonitoringRow`, and this is the load-bearing part.
 * `EvalPoint`'s `actual` and `residual` are non-optional on purpose —
 * MODEL-SERVE-005 recorded the refusal and its reason: the SD-band and
 * residual math structurally require ground truth, and satisfying the shape
 * without it means fabricating an actual value. A dense predicted point has
 * no lab counterpart, so it CANNOT be a MonitoringRow; widening that type to
 * fit would quietly re-open the exact hole this ledger closed. It gets its
 * own key on its own row type instead.
 */
export interface LiveOverlayRow extends Partial<MonitoringRow> {
  t: number
  timestamp: string
  /** The dense serving-plane prediction. A DIFFERENT series from `predict`,
   *  which is the scheduled window's prediction inside a joined pair — two
   *  provenances, never one series with holes in it. */
  live?: number
  /** MODEL-SERVE-009-T05. The target's last REPORTED value, carried forward
   *  by PI between lab samples — rendered as "Actual" (user decision
   *  2026-09-17) but kept under its OWN key, never merged into `actual`.
   *  That separation is the safety property: `actual` is what the residual,
   *  the SD band and every error metric read, and a held number entering
   *  those would publish a confident error against a value nobody measured
   *  in that interval. */
  held?: number
  /** MODEL-SERVE-011-T12. The SCHEDULED plane's hourly point —
   *  `predictionMean` over one window's 60 scored rows, from that window's
   *  own metrics.json.
   *
   *  ITS OWN KEY, like every other series here. It is neither `predict`
   *  (which exists only inside a JOINED pair and carries a measured actual
   *  beside it) nor `live` (a single instant through the warm /predict):
   *  this is an hour of predictions summarised by one number, and merging
   *  it into either would put two different things under one name. */
  scheduled?: number

  /** MODEL-SERVE-009-T05 follow-up. `live - held`: the model's prediction
   *  minus the lab's LAST MEASURED value.
   *
   *  THIS IS NOT A RESIDUAL AND MUST NOT BE TREATED AS ONE. A residual is
   *  predicted − actual where the actual was measured IN THAT INTERVAL; this
   *  compares against a number carried forward from the last time the lab
   *  reported, which on this plant is roughly daily. It answers "how far has
   *  the model drifted from the last thing we actually know" — a real
   *  operational question — and it is deliberately excluded from RMSE, R2
   *  and the SD band, all of which assume a measured actual per point. */
  heldDeviation?: number
}

/**
 * Merge the joined pairs and the dense predicted series onto one time axis.
 *
 * Recharts needs a single `data` array, so the two series share rows — but
 * they never share a KEY: a timestamp that has only a dense prediction
 * yields a row with `live` and nothing else, and no `actual` is invented for
 * it. A reader of the result can always tell which provenance a value came
 * from by which key it is under.
 *
 * Exact-timestamp match only, no nearest-neighbour snapping: pairing a
 * dense prediction to a joined row it did not come from would be the same
 * fabrication by a subtler route, and the tolerance question already has an
 * owner server-side (`truthToleranceMinutes`).
 */
export function mergeLivePredictions(
  rows: MonitoringRow[],
  live: Array<{ timestamp: string; predicted: number }>,
  /** MODEL-SERVE-009-T05. The target's held value, drawn as a flat step
   *  across every point in the range — it IS one number, so a straight line
   *  is the honest shape. Omitted entirely when the lab has never reported. */
  held?: number | null,
  /** MODEL-SERVE-009-T05. The visible range, used ONLY when the held value
   *  is the sole thing to draw. A carried-forward reading has no timestamps
   *  of its own, so with no prediction series to borrow an axis from there
   *  is nothing to plot it against — two endpoints over the range the user
   *  is already looking at draws the constant honestly, and invents no
   *  measurement (the value and its real measured-at are stated in the
   *  caption either way). */
  bounds?: { fromMs: number; toMs: number } | null,
): LiveOverlayRow[] {
  const byT = new Map<number, LiveOverlayRow>()
  for (const row of rows) byT.set(row.t, { ...row })

  for (const point of live) {
    const t = parseServerTimestamp(point.timestamp)
    if (Number.isNaN(t)) continue
    const existing = byT.get(t)
    if (existing) {
      existing.live = point.predicted
    } else {
      byT.set(t, { t, timestamp: point.timestamp, live: point.predicted })
    }
  }

  const merged = [...byT.values()].sort((a, b) => a.t - b.t)

  // Applied LAST, over whatever timestamps the two prediction series
  // produced: the held value has no timestamps of its own (it is a single
  // carried-forward reading), so it borrows the axis rather than inventing
  // points that would imply repeated measurement.
  if (held != null) {
    if (merged.length === 0 && bounds) {
      return [
        {
          t: bounds.fromMs,
          timestamp: new Date(bounds.fromMs).toISOString(),
          held,
        },
        {
          t: bounds.toMs,
          timestamp: new Date(bounds.toMs).toISOString(),
          held,
        },
      ]
    }
    for (const row of merged) {
      row.held = held
      // Only where a prediction actually exists — never invented for a row
      // that has no model output to compare.
      const predicted = row.live ?? row.predict
      if (typeof predicted === 'number') row.heldDeviation = predicted - held
    }
  }

  return merged
}

/**
 * MODEL-SERVE-011-T12. Fold the SCHEDULED plane's hourly points into rows
 * the chart already holds.
 *
 * EXACT TIMESTAMP MATCH ONLY, like `mergeLivePredictions` above and for the
 * same reason: a window's summary belongs at that window's own start, and
 * snapping it to a nearby joined row would attach an hour's mean to a
 * measurement it did not come from. A point with no row of its own simply
 * gets one.
 *
 * The point is placed at `windowStart` — the instant the window's data
 * BEGINS, matching where `InferenceWindow` rows and the Logs tab already
 * index a window. Placing it at the midpoint would read better on a chart
 * and would put the series a half-hour away from every other view of the
 * same window.
 */
export function mergeScheduledPredictions(
  rows: LiveOverlayRow[],
  scheduled: Array<{ windowStart: string; mean: number }>,
): LiveOverlayRow[] {
  if (scheduled.length === 0) return rows

  const byT = new Map<number, LiveOverlayRow>()
  for (const row of rows) byT.set(row.t, { ...row })

  for (const point of scheduled) {
    const t = parseServerTimestamp(point.windowStart)
    if (Number.isNaN(t)) continue
    const existing = byT.get(t)
    if (existing) {
      existing.scheduled = point.mean
    } else {
      byT.set(t, {
        t,
        timestamp: point.windowStart,
        scheduled: point.mean,
      })
    }
  }

  return [...byT.values()].sort((a, b) => a.t - b.t)
}
