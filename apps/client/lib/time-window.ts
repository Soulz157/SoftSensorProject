/**
 * A closed time window sent to the artifact endpoints. Field names match the
 * API (`startTime`/`endTime` on `/rows`, `/histogram`, `/boxplot`, `/scatter`,
 * `/correlation`), so a window can be spread straight into a request.
 *
 * Both ends are naive wall-clock strings (`YYYY-MM-DD HH:MM:SS`), never `Z` or
 * offset-suffixed: the artifact's timestamp column is tz-naive, and pandas
 * refuses to compare it with a tz-aware timestamp. The server's bounds are
 * inclusive on both sides.
 */
export interface TimeWindow {
  startTime: string
  endTime: string
}

export interface MonthOption {
  /** `YYYY-MM` — the select value. */
  key: string
  label: string
  window: TimeWindow
}

const MONTH_NAMES = [
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

/** A safety valve, not a product limit: 20 years of months in one dropdown. */
const MAX_MONTH_OPTIONS = 240

const YEAR_MONTH = /^(\d{4})-(\d{2})/

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** `month` is 1-12. */
export function monthWindow(year: number, month: number): TimeWindow {
  // Day 0 of the NEXT month is the last day of this one; UTC only so the
  // host's own timezone can never shift the day count.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const ym = `${year}-${pad2(month)}`
  return {
    startTime: `${ym}-01 00:00:00`,
    endTime: `${ym}-${pad2(lastDay)} 23:59:59.999999`,
  }
}

function parseYearMonth(
  value: string | null | undefined,
): { year: number; month: number } | null {
  if (!value) return null
  const match = YEAR_MONTH.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  if (month < 1 || month > 12) return null
  return { year, month }
}

/**
 * Every calendar month touched by `[startTime, endTime]`, oldest first. Only
 * the leading `YYYY-MM` of each bound is read, so it does not matter whether
 * the server sent `T` or a space, or a fractional second. Empty when either
 * bound is missing or unparseable — the caller then shows no picker rather
 * than a wrong one.
 */
export function monthOptions(
  startTime: string | null | undefined,
  endTime: string | null | undefined,
): MonthOption[] {
  const from = parseYearMonth(startTime)
  const to = parseYearMonth(endTime)
  if (!from || !to) return []

  const options: MonthOption[] = []
  let { year, month } = from
  while (
    (year < to.year || (year === to.year && month <= to.month)) &&
    options.length < MAX_MONTH_OPTIONS
  ) {
    options.push({
      key: `${year}-${pad2(month)}`,
      label: `${MONTH_NAMES[month - 1]} ${year}`,
      window: monthWindow(year, month),
    })
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
  return options
}

/**
 * Stable string for effect/cache keys. `TimeWindow` objects are fresh
 * identities, and keying a hook on one would refetch every render.
 */
export function windowKey(window: TimeWindow | null | undefined): string {
  return window ? `${window.startTime}|${window.endTime}` : ''
}

/** The select value for a window: its month, or `''` for "all". */
export function windowMonthKey(window: TimeWindow | null | undefined): string {
  return window ? window.startTime.slice(0, 7) : ''
}

/** Spread target: `{...windowParams(w)}` adds nothing when there is no window. */
export function windowParams(
  window: TimeWindow | null | undefined,
): Partial<TimeWindow> {
  return window ? { startTime: window.startTime, endTime: window.endTime } : {}
}

/**
 * `&startTime=…&endTime=…` for a GET `/rows`-style query string, or `''`.
 * Values are URI-encoded (the space and colons in a wall-clock string are not
 * query-safe as written).
 */
export function timeQuery(params: Partial<TimeWindow>): string {
  return (
    (params.startTime
      ? `&startTime=${encodeURIComponent(params.startTime)}`
      : '') +
    (params.endTime ? `&endTime=${encodeURIComponent(params.endTime)}` : '')
  )
}

/**
 * The wall clock every artifact timestamp is written in. `frame_service.py`
 * flattens PI's tz-aware times with `tz_convert("Asia/Bangkok").tz_localize(
 * None)`, so what is stored — and what the metadata and `/rows` report — is
 * naive Bangkok local time.
 */
const WALL_CLOCK_TIME_ZONE = 'Asia/Bangkok'

const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i

/**
 * Restates a bound the API keeps as an INSTANT in the artifact's own wall
 * clock. The validation holdout's start comes back from Postgres as
 * `2025-12-31T17:00:00.000Z`, which is `2026-01-01 00:00:00` on the artifact's
 * clock: read as-is, the compare modal's validation picker would offer an
 * empty December as its first month. A string with no offset is already wall
 * clock and passes through untouched, as do empty values and anything that
 * does not parse.
 */
export function toWallClock<T extends string | null | undefined>(
  value: T,
): T | string {
  if (!value || !HAS_OFFSET.test(value)) return value
  const instant = new Date(value)
  if (Number.isNaN(instant.getTime())) return value

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: WALL_CLOCK_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(instant)
      .map(part => [part.type, part.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`
}

/** `Mar 2026` for a month window, or `''` for none. */
export function windowLabel(window: TimeWindow | null | undefined): string {
  const ym = parseYearMonth(window?.startTime)
  return ym ? `${MONTH_NAMES[ym.month - 1]} ${ym.year}` : ''
}

/**
 * What `DataAnalysisCard` needs to offer a period picker: the current window,
 * how to change it, and enough about the loaded page to caption it honestly.
 * A caller that leaves it out gets no picker and the card behaves as before.
 */
export interface EdaWindowControl {
  value: TimeWindow | null
  onChange: (window: TimeWindow | null) => void
  /** The next window's rows are in flight; what is on screen is the last one's. */
  loading: boolean
  /** Rows the server holds inside the window (not just the loaded page), or
   * `null` until the first page lands. */
  totalRows: number | null
  /** Rows actually fetched. Not `dataset.rows.length`: the card's `dataset` can
   * have had rows dropped by cleaning rules since, and "first N of M" must
   * compare like with like. */
  loadedRows: number
}

const count = (n: number): string => n.toLocaleString('en-US')

/**
 * One sentence saying what the rows on screen are. The loaded page is capped,
 * so "the preview" can be everything or only the head of a much longer
 * series, and the reader has to be told which.
 */
export function describePreviewWindow(args: {
  loadedRows: number
  totalRows: number | null
  window: TimeWindow | null
}): string {
  const { loadedRows, totalRows, window } = args
  const label = windowLabel(window)

  if (totalRows === null) {
    return label
      ? `${count(loadedRows)} rows loaded for ${label} — a bounded sample.`
      : `${count(loadedRows)} rows loaded — a bounded sample, not the full artifact.`
  }
  if (totalRows > loadedRows) {
    return label
      ? `First ${count(loadedRows)} of ${count(totalRows)} rows in ${label} — the rest of the month is not loaded.`
      : `First ${count(loadedRows)} of ${count(totalRows)} rows in the artifact — pick a month to see a later period.`
  }
  return label
    ? `All ${count(totalRows)} rows in ${label}.`
    : `All ${count(totalRows)} rows in the artifact.`
}
