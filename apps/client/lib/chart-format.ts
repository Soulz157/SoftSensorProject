const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

const NAIVE_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]|$)/
const HAS_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/

/**
 * X-axis day label: `12 Sep`. No year, no time.
 *
 * A naive string (no `Z` / no offset) is the pipeline's own dialect — Bangkok
 * wall-clock with the zone stripped (see `aveva_connect.py`'s
 * `tz_convert('Asia/Bangkok').tz_localize(None)`) — so its calendar fields
 * are read VERBATIM here, never through an instant. Routing a naive string
 * through a timezone (UTC included) would shift it by the local offset and
 * flip the day near midnight — do not "fix" this to use `timeZone: 'UTC'`.
 * Offset-bearing strings (`Z`, `+07:00`), epoch numbers and `Date` objects
 * fall through to the instant path below, read in the browser's local zone.
 */
export function formatDayMonth(value: string | number | Date): string {
  if (typeof value === 'string' && !HAS_OFFSET.test(value)) {
    const m = NAIVE_DATE.exec(value)
    if (m) {
      const month = MONTHS[Number(m[2]) - 1]
      return month ? `${Number(m[3])} ${month}` : ''
    }
  }
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const month = MONTHS[d.getMonth()]
  return month ? `${d.getDate()} ${month}` : ''
}

/** Above this span a trend chart labels its X axis by day (`9 Jan`). */
export const DAY_TICKS_FROM_MS = 36 * 3_600_000

/**
 * Whether a trend's rows span more than ~a day and a half (2026-10-19), so
 * its X axis should read `9 Jan` rather than a clock time or weekday. The
 * Line tab used to pick its tick format from the fetch INTERVAL
 * (`PERIOD_TO_RANGE`: 1 h -> weekday, 1 min -> clock time), which on a
 * months-long dataset showed "Fri, Sat, ..." with no date at all. Reads the
 * first and last row only; naive stamps are compared as the same wall clock.
 */
export function spansMultipleDays(
  rows: readonly { timestamp: string }[],
): boolean {
  if (rows.length < 2) return false
  const t = (s: string) => new Date(s.replace(' ', 'T')).getTime()
  const span = t(rows[rows.length - 1]!.timestamp) - t(rows[0]!.timestamp)
  return Number.isFinite(span) && Math.abs(span) > DAY_TICKS_FROM_MS
}
