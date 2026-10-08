import { monthOptions } from '@/lib/time-window'

/**
 * DS-LAKE-034-D02. A sequential colour for step `position` of `total`:
 * --chart-4 (teal, oldest) through blue to --chart-5 (purple, newest). Time is
 * ordered, so a ramp reads as "earlier → later" in a way five unrelated
 * categorical colours cannot. Never red/amber — those are reserved for status.
 */
export function sequentialRampColor(position: number, total: number): string {
  if (total <= 1) return 'var(--chart-4)'
  const pct = Math.round((position / (total - 1)) * 100)
  return `color-mix(in oklch, var(--chart-4) ${100 - pct}%, var(--chart-5))`
}

/** Beyond this many months the colour scale is per YEAR — 24 or 36 monthly
 * steps on one ramp are too close to tell apart. */
export const MONTHLY_BUCKET_LIMIT = 12

export type TimeBucketUnit = 'month' | 'year'

export interface TimeBucket {
  /** `YYYY-MM` or `YYYY`. */
  key: string
  label: string
  color: string
}

export interface TimeBuckets {
  unit: TimeBucketUnit
  /** Every month (or year) from the first point to the last, oldest first —
   * empty ones included, so a colour means the same time whatever falls in it. */
  buckets: TimeBucket[]
  /** The bucket key for a point's timestamp, or `null` when it has none. */
  keyOf: (t: string | undefined) => string | null
}

const YEAR_MONTH = /^(\d{4})-(\d{2})/

/**
 * Buckets for colouring a scatter cloud by time. Only each stamp's leading
 * `YYYY-MM` is read — the server sends naive wall-clock time, and no timezone
 * conversion may move a reading into the neighbouring month. `null` when no
 * stamp parses (an older server that sends no `t`), so the caller keeps its
 * single colour.
 */
export function timeBuckets(
  stamps: readonly (string | undefined)[],
): TimeBuckets | null {
  let first: string | null = null
  let last: string | null = null
  for (const t of stamps) {
    const m = t ? YEAR_MONTH.exec(t) : null
    if (!m) continue
    const ym = `${m[1]}-${m[2]}`
    if (first === null || ym < first) first = ym
    if (last === null || ym > last) last = ym
  }
  if (first === null || last === null) return null

  const months = monthOptions(`${first}-01`, `${last}-01`)
  if (months.length <= MONTHLY_BUCKET_LIMIT) {
    return {
      unit: 'month',
      buckets: months.map((m, i) => ({
        key: m.key,
        label: m.label,
        color: sequentialRampColor(i, months.length),
      })),
      keyOf: t => (t ? (YEAR_MONTH.exec(t)?.[0] ?? null) : null),
    }
  }

  const firstYear = Number(first.slice(0, 4))
  const lastYear = Number(last.slice(0, 4))
  const years = Array.from({ length: lastYear - firstYear + 1 }, (_, i) =>
    String(firstYear + i),
  )
  return {
    unit: 'year',
    buckets: years.map((y, i) => ({
      key: y,
      label: y,
      color: sequentialRampColor(i, years.length),
    })),
    keyOf: t => (t ? (YEAR_MONTH.exec(t)?.[1] ?? null) : null),
  }
}
