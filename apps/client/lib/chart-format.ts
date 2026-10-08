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
