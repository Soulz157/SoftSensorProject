/**
 * Minute-precision `yyyy-MM-ddTHH:mm` stamps — the value format of
 * `CalendarDateTimePicker` (components/calendar-date-time-picker.tsx) and of
 * the older `DateTimePicker`. Pure — no React, no IO.
 *
 * A stamp is a NAIVE wall-clock string, never a Date: stamps of the same
 * shape compare correctly as strings, and keeping them out of `Date` is what
 * stops a picked day from shifting across a timezone boundary. Dates appear
 * only at the calendar's edge (`dayToDate`/`dateToDay`), and there as LOCAL
 * midnight, because that is what the calendar renders.
 */

/** An inclusive `[min, max]` range of stamps. */
export interface StampBounds {
  /** First allowed instant, `yyyy-MM-ddTHH:mm`. */
  min: string
  /** Last allowed instant, `yyyy-MM-ddTHH:mm`. */
  max: string
}

/** A stamp as a person reads it: `yyyy-MM-dd HH:mm`. */
export function formatStamp(stamp: string): string {
  return stamp.replace('T', ' ')
}

/**
 * `day` at `time`, pulled inside `bounds` when it falls outside them. Used
 * when a day is picked: a start defaults to 00:00 and an end to 23:59, and
 * clamping turns those into the real first/last reading on a partial day —
 * so picking two days alone already yields an in-range window.
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
