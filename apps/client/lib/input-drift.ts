import type {
  ColumnRangeDrift,
  InputDriftReport,
  InputDriftStatus,
  InputDriftWindow,
  InputTrendPoint,
  InputTrendSeries,
} from '@/services/model-monitoring'
import { MONITORING_STATUS_LABEL } from '@/lib/drift-status-style'
import {
  CRITERIA_VERDICT_SEPARATOR,
  type StatusExplanation,
} from '@/lib/monitoring-status-explain'

/**
 * MODEL-SERVE-036. Pure derivations for the Input Drift card: a live value
 * below the training min or above the training max is drift, and a column
 * is graded by the share of such values. The backend grades; everything
 * here only reads what it sent, so the badge, the chart, the stats and the
 * per-window table describe one population.
 */

const MEANING: Record<InputDriftStatus, string> = {
  OK: 'Live values of this input stay inside the range the model was trained on.',
  WARN: 'Some live values fall outside the training range — the model is extrapolating for those rows.',
  CRITICAL:
    'Many live values fall outside the training range — predictions for those rows are extrapolation.',
  UNKNOWN:
    'No verdict. No training range is recorded for this input — retrain the model to record one.',
  INSUFFICIENT_DATA:
    'Not enough live values yet to grade this input on thin evidence.',
}

type Thresholds = InputDriftReport['basis']['thresholds']

/** Engineering-unit value for labels and tables. Small-scale tags keep 4
 *  decimals so a 0.0002-wide range does not collapse to 0. */
export function formatDriftValue(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  const digits = abs >= 100 ? 1 : abs >= 1 ? 2 : abs === 0 ? 0 : 4
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  })
}

export function formatPct(pct: number | null | undefined): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return '—'
  if (pct === 0) return '0%'
  return pct < 10 ? `${pct.toFixed(1)}%` : `${Math.round(pct)}%`
}

export function trainRangeLabel(
  col: Pick<ColumnRangeDrift, 'trainMin' | 'trainMax'>,
): string {
  if (col.trainMin === null || col.trainMax === null) return 'No range'
  return `${formatDriftValue(col.trainMin)} – ${formatDriftValue(col.trainMax)}`
}

/** Badge tooltip for one column. Thresholds are the ones the backend
 *  graded with, never a literal. */
export function explainRangeDrift(
  col: ColumnRangeDrift,
  thresholds: Thresholds | undefined,
): StatusExplanation {
  const meaning = col.reason
    ? `${MEANING[col.status]} (${col.reason})`
    : MEANING[col.status]
  if (!thresholds || col.status === 'UNKNOWN') return { meaning, criteria: [] }

  if (col.status === 'INSUFFICIENT_DATA') {
    return {
      meaning,
      criteria: [
        `${col.liveTotal} of ${thresholds.minSamples} values required`,
      ],
    }
  }

  const criteria = [`Training range ${trainRangeLabel(col)}`]
  if (col.outOfRangePct !== null) {
    const value = `Out of range ${col.outOfRangePct.toFixed(1)}% (${col.below} below, ${col.above} above, of ${col.liveTotal})`
    if (col.outOfRangePct >= thresholds.outOfRangeCriticalPct) {
      criteria.push(
        `${value} ≥ ${thresholds.outOfRangeCriticalPct}%${CRITERIA_VERDICT_SEPARATOR}CRITICAL`,
      )
    } else if (col.outOfRangePct >= thresholds.outOfRangeWarnPct) {
      criteria.push(
        `${value} ≥ ${thresholds.outOfRangeWarnPct}%${CRITERIA_VERDICT_SEPARATOR}WARN (critical at ${thresholds.outOfRangeCriticalPct}%)`,
      )
    } else {
      criteria.push(
        `${value} < ${thresholds.outOfRangeWarnPct}%${CRITERIA_VERDICT_SEPARATOR}${MONITORING_STATUS_LABEL.OK}`,
      )
    }
  }
  return { meaning, criteria }
}

/** Card header badge: the report status is the worst column. */
export function explainInputDriftReport(
  report: InputDriftReport,
): StatusExplanation {
  const total = report.columns.length
  const flagged = report.columns.filter(
    c => c.status === 'WARN' || c.status === 'CRITICAL',
  ).length
  const t = report.basis.thresholds
  return {
    meaning: `Worst verdict across ${total} input${total === 1 ? '' : 's'}. ${MEANING[report.status]}`,
    criteria:
      report.status === 'UNKNOWN'
        ? []
        : [
            `${flagged} of ${total} inputs outside their training range`,
            `warn ≥ ${t.outOfRangeWarnPct}%, critical ≥ ${t.outOfRangeCriticalPct}% of live values`,
          ],
  }
}

export interface TrendChartRow {
  /** Epoch ms, for a time-scale axis. */
  t: number
  value: number | null
  /** [min, max] of the point — equal to value at raw resolution. */
  envelope: [number, number] | null
  /** Where to draw the out-of-range mark for this point, or null when the
   *  point holds no out-of-range row. */
  outValue: number | null
}

/** The mark sits on the extreme that left the range, so a bucket whose
 *  mean is inside but whose max spiked still shows the spike. */
function outMark(
  p: InputTrendPoint,
  trainMin: number | null,
  trainMax: number | null,
): number | null {
  if (trainMax !== null && p.max !== null && p.max > trainMax) return p.max
  if (trainMin !== null && p.min !== null && p.min < trainMin) return p.min
  return p.value
}

/** Chart rows. A point is marked only when the backend counted an
 *  out-of-range row in it — the chart never re-decides what the badge
 *  counted (categorical tags allow a half-gap tolerance a plain min/max
 *  test would miss). */
export function trendChartRows(
  series: InputTrendSeries,
  trainMin: number | null,
  trainMax: number | null,
): TrendChartRow[] {
  return series.points.map(p => ({
    t: new Date(p.t).getTime(),
    value: p.value,
    envelope: p.min !== null && p.max !== null ? [p.min, p.max] : null,
    outValue: p.outOfRange > 0 ? outMark(p, trainMin, trainMax) : null,
  }))
}

/** Y domain covering the data AND both training lines, padded 8%, so the
 *  lines stay on screen even when every value sits far outside. */
export function trendYDomain(
  points: Pick<InputTrendPoint, 'min' | 'max'>[],
  trainMin: number | null,
  trainMax: number | null,
): [number, number] | null {
  const values: number[] = []
  for (const p of points) {
    if (p.min !== null) values.push(p.min)
    if (p.max !== null) values.push(p.max)
  }
  if (trainMin !== null) values.push(trainMin)
  if (trainMax !== null) values.push(trainMax)
  if (values.length === 0) return null
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const span = hi - lo || Math.abs(hi) || 1
  return [lo - span * 0.08, hi + span * 0.08]
}

/** At most `maxPoints` rows for the row sparkline: chunk means, each chunk
 *  keeping its first out-of-range mark. */
export function sparklineRows(
  series: InputTrendSeries,
  trainMin: number | null,
  trainMax: number | null,
  maxPoints = 80,
): TrendChartRow[] {
  const rows = trendChartRows(series, trainMin, trainMax)
  if (rows.length <= maxPoints) return rows
  const size = Math.ceil(rows.length / maxPoints)
  const out: TrendChartRow[] = []
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size)
    const vals = chunk.map(r => r.value).filter((v): v is number => v !== null)
    const mark = chunk.find(r => r.outValue !== null)?.outValue ?? null
    out.push({
      t: chunk[0]!.t,
      value: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
      envelope: null,
      outValue: mark,
    })
  }
  return out
}

export interface DriftStat {
  label: string
  value: string
  hint?: string
}

function formatStamp(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export function driftStats(
  col: ColumnRangeDrift,
  series: InputTrendSeries | undefined,
): DriftStat[] {
  const share = (n: number) =>
    col.liveTotal > 0
      ? `${formatPct((n / col.liveTotal) * 100)} of ${col.liveTotal.toLocaleString('en-US')}`
      : undefined
  return [
    { label: 'Training min', value: formatDriftValue(col.trainMin) },
    { label: 'Training max', value: formatDriftValue(col.trainMax) },
    { label: 'Live min', value: formatDriftValue(series?.liveMin) },
    { label: 'Live max', value: formatDriftValue(series?.liveMax) },
    { label: 'Live mean', value: formatDriftValue(series?.liveMean) },
    {
      label: 'Below training min',
      value: col.below.toLocaleString('en-US'),
      hint: share(col.below),
    },
    {
      label: 'Above training max',
      value: col.above.toLocaleString('en-US'),
      hint: share(col.above),
    },
    {
      label: 'Last out of range',
      value: series?.lastOutOfRangeAt
        ? formatStamp(series.lastOutOfRangeAt)
        : 'Not in this range',
    },
  ]
}

export interface WindowTableRow extends InputDriftWindow {
  outOfRangePct: number | null
}

/** Newest first, with each window's own out-of-range share. */
export function windowTableRows(windows: InputDriftWindow[]): WindowTableRow[] {
  return [...windows]
    .sort((a, b) => b.windowStart.localeCompare(a.windowStart))
    .map(w => ({
      ...w,
      outOfRangePct: w.n > 0 ? ((w.below + w.above) / w.n) * 100 : null,
    }))
}

const SEVERITY: Record<InputDriftStatus, number> = {
  CRITICAL: 0,
  WARN: 1,
  OK: 2,
  INSUFFICIENT_DATA: 3,
  UNKNOWN: 4,
}

/** Flagged columns first (CRITICAL, WARN), then the rest in backend order —
 *  a reader opens the card to find what moved. Stable. */
export function sortBySeverity<T extends Pick<ColumnRangeDrift, 'status'>>(
  columns: T[],
): T[] {
  return columns
    .map((c, i) => ({ c, i }))
    .sort((a, b) => SEVERITY[a.c.status] - SEVERITY[b.c.status] || a.i - b.i)
    .map(({ c }) => c)
}

/** A column the report has no row for, as an ungraded verdict — so a table
 *  can explain "no verdict" with the same wording as a real UNKNOWN. */
export function unknownDriftColumn(column: string): ColumnRangeDrift {
  return {
    column,
    liveTotal: 0,
    below: 0,
    above: 0,
    outOfRangePct: null,
    trainMin: null,
    trainMax: null,
    binMode: null,
    status: 'UNKNOWN',
    bins: null,
  }
}
