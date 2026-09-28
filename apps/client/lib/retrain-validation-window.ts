/**
 * The retrain dialog's new-data validation window, as two minute-precision
 * `yyyy-MM-ddTHH:mm` stamps. Pure — no React, no IO.
 *
 * The bounds come from the chosen version's artifact metadata, whose
 * `startTime`/`endTime` are the real min/max of its timestamp column
 * (`object_store.get_frame_metadata`), formatted naive `YYYY-MM-DD HH:MM:SS`.
 * Python checks the window against those SAME instants
 * (`data_start <= from <= to <= data_end`, and `from >= cut` for New data
 * only), so the bounds keep the time of day: a window built from whole days
 * (00:00 to 23:59:59) was refused whenever the data started or ended part-way
 * through a day.
 *
 * Everything stays in that naive wall clock. A stamp goes out as
 * `${stamp}:00.000Z`, and python's `_wall_clock` drops the `Z` again, so no
 * timezone conversion happens on either side of the comparison.
 */
import { formatStamp, type StampBounds } from './date-stamp'

// The generic stamp helpers moved to `lib/date-stamp.ts` once a second
// picker needed them; re-exported so this module's callers are unchanged.
export {
  clampStamp,
  dateToDay,
  dayToDate,
  formatStamp,
} from './date-stamp'

/** The window's `[first, last]` allowed instants. */
export type DateBounds = StampBounds

const TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?/

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * A naive timestamp (`YYYY-MM-DD HH:MM:SS[.ffffff]`, or `T`-separated) as a
 * minute stamp, or `null` when unparseable. Rounded INWARD by the caller's
 * choice: a lower bound rounds `up` (14:00:30 -> 14:01, so the stamp is never
 * before the real first reading), an upper bound rounds `down`.
 */
export function toStamp(
  timestamp: string | null | undefined,
  round: 'up' | 'down',
): string | null {
  const m = timestamp ? TIMESTAMP.exec(timestamp) : null
  if (!m) return null
  const [y, mo, d, h, mi] = m.slice(1, 6).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ]
  const hasSeconds = Number(m[6] ?? 0) > 0 || Number(m[7] ?? 0) > 0
  // UTC arithmetic only as a calendar: the value is naive wall clock, and
  // this just carries a +1 minute across hour/day/month boundaries.
  const ms =
    Date.UTC(y, mo - 1, d, h, mi) + (round === 'up' && hasSeconds ? 60_000 : 0)
  const t = new Date(ms)
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`
}

/** `null` when either end is missing or unparseable — the pickers then stay
 *  unbounded rather than guessing a range the data may not have. */
export function timeBoundsFrom(
  startTime: string | null | undefined,
  endTime: string | null | undefined,
): DateBounds | null {
  const min = toStamp(startTime, 'up')
  const max = toStamp(endTime, 'down')
  return min && max ? { min, max } : null
}

/** The stamp as the ISO-8601 string the trigger DTO takes (naive, `Z`). */
export function stampToIso(stamp: string): string {
  return `${stamp}:00.000Z`
}

/**
 * True when the allowed range holds no instant at all — the first allowed
 * one is after the last. Happens for "New data only" when the chosen version
 * ends before the current version's cut: every reading it has is one the
 * current version trained on, so no valid validation window exists in it.
 */
export function isEmptyRange(bounds: DateBounds | null): boolean {
  return bounds !== null && bounds.min > bounds.max
}

/**
 * Why the chosen range cannot be submitted, or `null` when it can (or when
 * it is still half-chosen — an empty end is not yet an error). Stamps of the
 * same `yyyy-MM-ddTHH:mm` shape compare correctly as strings, so no Date is
 * built here.
 *
 * A time input's own `min`/`max` only constrain its spinner; a typed value
 * outside them is still accepted, so this check — not the attributes — is
 * the guard.
 */
export function validationWindowError(
  from: string,
  to: string,
  bounds: DateBounds | null,
): string | null {
  if (bounds) {
    const first = formatStamp(bounds.min)
    const last = formatStamp(bounds.max)
    if (from && from < bounds.min) return `Start can't be before ${first}.`
    if (from && from > bounds.max)
      return `Start can't be after the last reading (${last}).`
    if (to && to > bounds.max)
      return `End can't be after the last reading (${last}).`
    if (to && to < bounds.min) return `End can't be before ${first}.`
  }
  if (from && to && from > to) return 'Start must be on or before the end.'
  return null
}
