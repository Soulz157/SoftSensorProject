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
export interface DateBounds {
  /** First instant a window may start, `yyyy-MM-ddTHH:mm`. */
  min: string
  /** Last instant a window may end, `yyyy-MM-ddTHH:mm`. */
  max: string
}

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

/** A stamp as the operator reads it: `yyyy-MM-dd HH:mm`. */
export function formatStamp(stamp: string): string {
  return stamp.replace('T', ' ')
}

/** The stamp as the ISO-8601 string the trigger DTO takes (naive, `Z`). */
export function stampToIso(stamp: string): string {
  return `${stamp}:00.000Z`
}

/**
 * `day` at `time`, pulled inside `bounds` when it falls outside them. Used
 * when a day is picked: the start defaults to 00:00 and the end to 23:59, and
 * clamping turns those into the real first/last reading on a partial day —
 * so picking two days alone already yields a window the server accepts.
 */
export function clampStamp(
  day: string,
  time: string,
  bounds: { min?: string; max?: string },
): string {
  const stamp = `${day}T${time}`
  if (bounds.min && stamp < bounds.min) return bounds.min
  if (bounds.max && stamp > bounds.max) return bounds.max
  return stamp
}

/**
 * A `yyyy-MM-dd` day as a LOCAL-midnight Date, for the calendar picker, or
 * `null` when it is empty or not a real day. Local, not UTC: the calendar
 * renders local days, and `new Date('2026-01-01')` would parse as UTC
 * midnight and show as the previous day anywhere west of Greenwich.
 */
export function dayToDate(day: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])]
  const date = new Date(y, mo, d)
  // Rejects rollover ("2026-13-45" would otherwise become a 2027 date).
  return date.getFullYear() === y &&
    date.getMonth() === mo &&
    date.getDate() === d
    ? date
    : null
}

/** The inverse of `dayToDate`: a Date's LOCAL calendar day as `yyyy-MM-dd`. */
export function dateToDay(date: Date): string {
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${mm}-${dd}`
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
