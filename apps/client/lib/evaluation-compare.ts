/**
 * MODEL-SERVE-032. Pure helpers for the Evaluation page: range handling,
 * pairing a lab series with the imported predictions, and shaping chart rows.
 * No React, no IO.
 *
 * TIME. The page's pickers and axis speak PLANT WALL-CLOCK time (Bangkok,
 * UTC+7, no DST) — the same convention every artifact timestamp and the
 * Monitoring chart use (`lib/time-window.ts`, `lib/monitoring.ts`). The API
 * speaks UTC. The conversion happens in exactly two functions here
 * (`stampToUtcIso`, `utcToWallMs`); nothing else adds or subtracts an offset.
 */

import { alignLabToPredictions, type LabPoint } from '@/lib/lab-ingestion'
import type { PredPoint } from '@/lib/mock-lab-data'
import type { EvalPoint } from '@/lib/model-evaluation'
import type { EvaluationCompareResult } from '@/services/model-evaluation'

/** Bangkok is UTC+7 all year. */
export const PLANT_UTC_OFFSET_MS = 7 * 3_600_000

/** Mirrors the server's caps (`MAX_COMPARE_DAYS` / `MAX_COMPARE_ROWS` in
 *  apps/backend/src/lib/evaluation-compare.ts). The server is the guard; these
 *  only let the page say so before a round trip. */
export const COMPARE_MAX_DAYS = 31
export const COMPARE_MAX_ROWS = 2000

const DAY_MS = 86_400_000
const STAMP = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/

/** `yyyy-MM-ddTHH:mm` (plant wall clock) -> UTC ISO `Z`; null if malformed. */
export function stampToUtcIso(stamp: string): string | null {
  const m = STAMP.exec(stamp)
  if (!m) return null
  const ms = Date.parse(`${m[1]}T${m[2]}:00.000+07:00`)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

/** A UTC instant -> the plant wall-clock epoch the chart axis plots on. The
 *  UTC fields of the result ARE the Bangkok digits, which is what
 *  `lib/monitoring`'s tick formatters read. */
export function utcToWallMs(iso: string): number {
  return Date.parse(iso) + PLANT_UTC_OFFSET_MS
}

/** A UTC instant -> `yyyy-MM-ddTHH:mm` plant wall clock. */
export function utcToStamp(ms: number): string {
  return new Date(ms + PLANT_UTC_OFFSET_MS).toISOString().slice(0, 16)
}

/** The default import window: the 24 hours ending now (to the minute). */
export function defaultRange(now: number = Date.now()): {
  from: string
  to: string
} {
  const minute = Math.floor(now / 60_000) * 60_000
  return { from: utcToStamp(minute - DAY_MS), to: utcToStamp(minute) }
}

/** The first problem with a picked range, or null. Row count is the server's
 *  to judge (it knows the cadence); this catches what is knowable here. */
export function validateRange(from: string, to: string): string | null {
  const a = stampToUtcIso(from)
  const b = stampToUtcIso(to)
  if (!a || !b) return 'Pick both a start and an end.'
  const span = Date.parse(b) - Date.parse(a)
  if (span <= 0) return 'The end must be after the start.'
  if (span > COMPARE_MAX_DAYS * DAY_MS) {
    return `A range is limited to ${COMPARE_MAX_DAYS} days. Narrow it.`
  }
  return null
}

/** Only the rows that were actually scored: a skipped row is a gap, not a 0. */
export function predictedSeries(
  result: Pick<EvaluationCompareResult, 'points'>,
): PredPoint[] {
  const out: PredPoint[] = []
  for (const p of result.points) {
    if (p.predicted !== null) {
      out.push({ timestamp: p.t, predicted: p.predicted })
    }
  }
  return out
}

export function labFromEvents(
  events: ReadonlyArray<{ t: string; value: number }>,
): LabPoint[] {
  return events.map(e => ({ timestamp: e.t, value: e.value }))
}

/**
 * Lab events from the source plus the points the user added, one per
 * timestamp. A user-added point wins a collision: it is the user's
 * correction of that instant.
 */
export function mergeLab(
  imported: readonly LabPoint[],
  added: readonly LabPoint[],
): LabPoint[] {
  const byTime = new Map<number, LabPoint>()
  for (const p of imported) byTime.set(Date.parse(p.timestamp), p)
  for (const p of added) byTime.set(Date.parse(p.timestamp), p)
  return [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p)
}

/** Lab/prediction pairs within the schedule's tolerance, ready for
 *  `computeMetrics`. */
export function pairLab(
  result: Pick<EvaluationCompareResult, 'points' | 'toleranceMinutes'>,
  lab: readonly LabPoint[],
): EvalPoint[] {
  return alignLabToPredictions(
    predictedSeries(result),
    [...lab],
    result.toleranceMinutes * 60_000,
  )
}

export interface ChartRow {
  /** Plant wall-clock epoch ms (see `utcToWallMs`). */
  t: number
  predicted: number | null
  /** The lab value snapped to this row, if one is nearest to it. */
  lab: number | null
  /** The lab event's own instant (wall-clock epoch), for the tooltip: a lab
   *  value is drawn on the nearest grid row but never relabelled to its time. */
  labAt: number | null
  skippedReason: string | null
}

/**
 * One row per imported grid point, in order. Lab values ride on the NEAREST
 * grid row rather than adding rows of their own: an interleaved lab-only row
 * would carry `predicted: null` and break the prediction line, hiding the
 * real gaps this chart exists to show. The shift is at most half a cadence,
 * and the tooltip states the lab event's true time.
 *
 * A lab event outside the imported span is dropped from the chart (it is
 * outside what the user asked to see); it still counts for nothing in
 * metrics, since there is no prediction near it.
 */
export function buildChartRows(
  result: Pick<EvaluationCompareResult, 'points'>,
  lab: readonly LabPoint[],
): ChartRow[] {
  const rows: ChartRow[] = result.points.map(p => ({
    t: utcToWallMs(p.t),
    predicted: p.predicted,
    lab: null,
    labAt: null,
    skippedReason: p.skippedReason,
  }))
  if (rows.length === 0) return rows

  const times = result.points.map(p => Date.parse(p.t))
  const first = times[0]
  const last = times[times.length - 1]
  if (first === undefined || last === undefined) return rows
  const half = rows.length > 1 ? (last - first) / (rows.length - 1) / 2 : 0
  const bestDist = new Array<number>(rows.length).fill(Infinity)

  for (const l of lab) {
    const at = Date.parse(l.timestamp)
    if (!Number.isFinite(at)) continue
    const i = nearestIndex(times, at)
    const row = rows[i]
    const near = times[i]
    if (!row || near === undefined) continue
    const dist = Math.abs(near - at)
    // Outside the span by more than half a cadence = not part of this range.
    if (dist > half && (at < first || at > last)) continue
    if (dist < (bestDist[i] ?? Infinity)) {
      bestDist[i] = dist
      row.lab = l.value
      row.labAt = at + PLANT_UTC_OFFSET_MS
    }
  }
  return rows
}

function nearestIndex(sorted: readonly number[], x: number): number {
  let lo = 0
  let hi = sorted.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    const v = sorted[mid]
    if (v !== undefined && v < x) lo = mid + 1
    else hi = mid
  }
  const prev = sorted[lo - 1]
  const cur = sorted[lo]
  if (
    lo > 0 &&
    prev !== undefined &&
    cur !== undefined &&
    Math.abs(prev - x) <= Math.abs(cur - x)
  ) {
    return lo - 1
  }
  return lo
}

export interface XRow {
  t: number
  v: number | null
}

/** One X tag's series for its mini-chart; aligned with `buildChartRows`. */
export function xRows(
  result: Pick<EvaluationCompareResult, 'points' | 'features'>,
  tag: string,
): XRow[] {
  const values = result.features[tag] ?? []
  return result.points.map((p, i) => ({
    t: utcToWallMs(p.t),
    v: values[i] ?? null,
  }))
}
