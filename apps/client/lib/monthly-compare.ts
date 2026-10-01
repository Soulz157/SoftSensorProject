import { chartColorVar } from '@/lib/mock-readings'
import { sequentialRampColor } from '@/lib/scatter-time'
import type { MonthOption } from '@/lib/time-window'
import type {
  DraftBoxplotResult,
  DraftHistogramResult,
  DraftTagBoxplot,
  DraftTagHistogram,
} from '@/services/dataset-draft'

/**
 * DS-LAKE-031-D02. Months compared side by side for ONE tag. Equal to the tag
 * comparison's `MAX_COMPARE`, which is also the size of the `--chart-1..5`
 * palette, so no two picked months ever share a colour.
 */
export const MAX_MONTHS = 5

/**
 * DS-LAKE-031-D03. A month's colour is fixed by its POSITION in the picked
 * list, never by where it lands among the months that returned data — the
 * popover's swatch is the legend key, so the chart must draw each month in the
 * colour the popover already showed, even when an earlier month came back
 * empty.
 */
export function monthColor(position: number, total = MAX_MONTHS): string {
  if (total <= MAX_MONTHS) {
    return chartColorVar(((position % MAX_MONTHS) + 1) as 1 | 2 | 3 | 4 | 5)
  }
  // "All months" can exceed the 5-colour palette. Months are ordered, so a
  // sequential ramp reads as time — the same ramp the scatter's time colour
  // bar uses (DS-LAKE-034).
  return sequentialRampColor(position, total)
}

/**
 * Safety ceiling for "All months", not a product limit: one request per
 * month, and a chart with more series than this stops being readable. An
 * artifact spanning longer compares its latest `MAX_ALL_MONTHS`, and the
 * caption says so.
 */
export const MAX_ALL_MONTHS = 24

/** Every month the artifact spans, newest `MAX_ALL_MONTHS` if longer. */
export function allMonths(options: MonthOption[]): MonthOption[] {
  return options.slice(-MAX_ALL_MONTHS)
}

/**
 * `Promise.allSettled` with at most `limit` calls in flight. "All months" can
 * mean two dozen requests; firing them at once would queue them all on the
 * python service behind every other chart.
 */
export async function settleWithConcurrency<I, O>(
  items: I[],
  limit: number,
  fn: (item: I) => Promise<O>,
): Promise<PromiseSettledResult<O>[]> {
  const out: PromiseSettledResult<O>[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      try {
        out[i] = { status: 'fulfilled', value: await fn(items[i]!) }
      } catch (reason) {
        out[i] = { status: 'rejected', reason }
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  )
  return out
}

/** One month's response, as the monthly hooks hand it to the merge. `data`
 * is null when that month's request failed — `error` then says why. */
export interface MonthResult<T> {
  month: MonthOption
  data: T | null
  error: string | null
}

export interface MergedMonthly<T> {
  result: T
  /** Series names handed to the chart — the month labels that made it in. */
  tags: string[]
  /** Chart `seriesStyle` lookup, keyed by series name. */
  styleMap: Map<string, { color: string }>
  /** Labels of picked months that contributed nothing: the request failed,
   * or the month held no usable readings for the tag. Named in the caption
   * rather than dropped silently. */
  missing: string[]
}

/**
 * Picks `tag`'s entry out of each month's response and relabels it with the
 * month, so `TagHistogramChart`/`TagBoxplotChart` render the months as if they
 * were tags — same trick DS-LAKE-026's `mergeHistogramSides` uses for train vs
 * validation.
 */
function pickByMonth<E extends { tag: string }>(
  results: MonthResult<{ tags: E[] }>[],
  tag: string,
): {
  entries: E[]
  styleMap: Map<string, { color: string }>
  missing: string[]
} {
  const entries: E[] = []
  const styleMap = new Map<string, { color: string }>()
  const missing: string[] = []
  results.forEach(({ month, data }, position) => {
    const entry = data?.tags.find(t => t.tag === tag)
    if (!entry) {
      missing.push(month.label)
      return
    }
    entries.push({ ...entry, tag: month.label })
    styleMap.set(month.label, {
      color: monthColor(position, results.length),
    })
  })
  return { entries, styleMap, missing }
}

/**
 * Histogram merge. `domain_min`/`domain_max` are RECOMPUTED from the months
 * that made it in, never taken from any one response: each request computed
 * its domain over its own month only, so no single response's domain covers
 * the others.
 */
export function mergeMonthlyHistograms(
  results: MonthResult<DraftHistogramResult>[],
  tag: string,
): MergedMonthly<DraftHistogramResult> {
  const { entries, styleMap, missing } = pickByMonth<DraftTagHistogram>(
    results,
    tag,
  )
  let domainMin: number | null = null
  let domainMax: number | null = null
  for (const e of entries) {
    if (domainMin === null || e.min < domainMin) domainMin = e.min
    if (domainMax === null || e.max > domainMax) domainMax = e.max
  }
  return {
    result: {
      source_key: results.find(r => r.data)?.data?.source_key ?? '',
      domain_min: domainMin,
      domain_max: domainMax,
      tags: entries,
      insufficient_tags: [],
    },
    tags: entries.map(e => e.tag),
    styleMap,
    missing,
  }
}

/** Box Plot's twin of `mergeMonthlyHistograms`. No domain to reconcile —
 * `TagBoxplotChart` derives its own Y ticks from the rows it is handed. */
export function mergeMonthlyBoxplots(
  results: MonthResult<DraftBoxplotResult>[],
  tag: string,
): MergedMonthly<DraftBoxplotResult> {
  const { entries, styleMap, missing } = pickByMonth<DraftTagBoxplot>(
    results,
    tag,
  )
  return {
    result: {
      source_key: results.find(r => r.data)?.data?.source_key ?? '',
      tags: entries,
      insufficient_tags: [],
    },
    tags: entries.map(e => e.tag),
    styleMap,
    missing,
  }
}

/**
 * Whether a monthly comparison is still on its way. True during the
 * debounce window too — there `loading` has not flipped yet but no result or
 * error exists — so the chart never sits on 'ready' with nothing to draw
 * (the empty-tags-at-ready bug `TagHistogramChart`'s doc comment records).
 */
export function monthlyPending(state: {
  results: unknown[] | null
  loading: boolean
  error: string | null
}): boolean {
  return state.loading || (state.results === null && state.error === null)
}

/**
 * The months to start with when monthly mode is first opened: the latest two,
 * in calendar order. Recent months are the likeliest question ("did last
 * month drift?"), and two is the smallest comparison.
 */
export function defaultMonthKeys(options: MonthOption[]): string[] {
  return options.slice(-2).map(o => o.key)
}
