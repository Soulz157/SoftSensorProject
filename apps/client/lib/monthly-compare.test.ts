import { describe, expect, it } from 'vitest'
import {
  allMonths,
  defaultMonthKeys,
  MAX_ALL_MONTHS,
  monthlyPending,
  settleWithConcurrency,
  mergeMonthlyBoxplots,
  mergeMonthlyHistograms,
  monthColor,
  type MonthResult,
} from './monthly-compare'
import { correlationsWith } from './data-quality'
import { monthOptions } from './time-window'
import type {
  DraftBoxplotResult,
  DraftHistogramResult,
  DraftTagBoxplot,
  DraftTagHistogram,
} from '@/services/dataset-draft'

const [JAN, FEB, MAR] = monthOptions(
  '2026-01-01 00:00:00',
  '2026-03-31 23:00:00',
)

function hist(tag: string, min: number, max: number): DraftTagHistogram {
  return {
    tag,
    mean: (min + max) / 2,
    median: (min + max) / 2,
    mode: min,
    std: 1,
    min,
    max,
    range: max - min,
    count: 10,
    kde: [],
  }
}

function histResult(...tags: DraftTagHistogram[]): DraftHistogramResult {
  return {
    source_key: 'k',
    domain_min: Math.min(...tags.map(t => t.min)),
    domain_max: Math.max(...tags.map(t => t.max)),
    tags,
    insufficient_tags: [],
  }
}

function box(tag: string): DraftTagBoxplot {
  return {
    tag,
    min: 0,
    q1: 1,
    median: 2,
    mean: 2,
    q3: 3,
    max: 4,
    whisker_low: 0,
    whisker_high: 4,
    outliers: [],
    outlier_count: 0,
    count: 10,
  } as DraftTagBoxplot
}

describe('mergeMonthlyHistograms', () => {
  it('relabels each month and recomputes the shared domain', () => {
    const results: MonthResult<DraftHistogramResult>[] = [
      { month: JAN!, data: histResult(hist('T1', 5, 10)), error: null },
      { month: FEB!, data: histResult(hist('T1', -2, 7)), error: null },
    ]
    const merged = mergeMonthlyHistograms(results, 'T1')
    expect(merged.tags).toEqual(['Jan 2026', 'Feb 2026'])
    expect(merged.result.tags.map(t => t.tag)).toEqual(merged.tags)
    expect(merged.result.domain_min).toBe(-2)
    expect(merged.result.domain_max).toBe(10)
    expect(merged.missing).toEqual([])
  })

  it('names a failed month and a month with no entry for the tag', () => {
    const results: MonthResult<DraftHistogramResult>[] = [
      { month: JAN!, data: null, error: 'boom' },
      { month: FEB!, data: histResult(hist('OTHER', 0, 1)), error: null },
      { month: MAR!, data: histResult(hist('T1', 0, 1)), error: null },
    ]
    const merged = mergeMonthlyHistograms(results, 'T1')
    expect(merged.missing).toEqual(['Jan 2026', 'Feb 2026'])
    expect(merged.tags).toEqual(['Mar 2026'])
  })

  it('keeps the colour of a month tied to its picked position', () => {
    const results: MonthResult<DraftHistogramResult>[] = [
      { month: JAN!, data: null, error: 'boom' },
      { month: FEB!, data: histResult(hist('T1', 0, 1)), error: null },
    ]
    const merged = mergeMonthlyHistograms(results, 'T1')
    // Feb is second in the picked list, so it keeps colour #2 even though
    // it is the only month drawn.
    expect(merged.styleMap.get('Feb 2026')).toEqual({ color: monthColor(1) })
    expect(monthColor(1)).toBe('var(--chart-2)')
  })

  it('returns a null domain when no month contributed', () => {
    const merged = mergeMonthlyHistograms(
      [{ month: JAN!, data: null, error: 'x' }],
      'T1',
    )
    expect(merged.result.domain_min).toBeNull()
    expect(merged.result.domain_max).toBeNull()
    expect(merged.tags).toEqual([])
  })
})

describe('mergeMonthlyBoxplots', () => {
  it('relabels months and names missing ones', () => {
    const ok: DraftBoxplotResult = {
      source_key: 'k',
      tags: [box('T1')],
      insufficient_tags: [],
    }
    const merged = mergeMonthlyBoxplots(
      [
        { month: JAN!, data: ok, error: null },
        { month: FEB!, data: null, error: 'x' },
        { month: MAR!, data: ok, error: null },
      ],
      'T1',
    )
    expect(merged.tags).toEqual(['Jan 2026', 'Mar 2026'])
    expect(merged.missing).toEqual(['Feb 2026'])
    expect(merged.styleMap.get('Mar 2026')).toEqual({ color: monthColor(2) })
  })
})

describe('All months', () => {
  const span = monthOptions('2024-01-01 00:00:00', '2026-06-30 00:00:00')

  it('takes every month, capped to the latest MAX_ALL_MONTHS', () => {
    expect(span).toHaveLength(30)
    const all = allMonths(span)
    expect(all).toHaveLength(MAX_ALL_MONTHS)
    expect(all[all.length - 1]!.key).toBe('2026-06')
    expect(allMonths([JAN!, FEB!]).map(m => m.key)).toEqual([
      '2026-01',
      '2026-02',
    ])
  })

  it('keeps the 5-colour palette up to 5 months and ramps beyond it', () => {
    expect(monthColor(4, 5)).toBe('var(--chart-5)')
    expect(monthColor(0, 12)).toContain('var(--chart-4) 100%')
    expect(monthColor(11, 12)).toContain('var(--chart-4) 0%')
    expect(
      new Set(Array.from({ length: 12 }, (_, i) => monthColor(i, 12))).size,
    ).toBe(12)
  })

  it('settles every item with at most `limit` in flight', async () => {
    let inFlight = 0
    let peak = 0
    const settled = await settleWithConcurrency(
      [1, 2, 3, 4, 5, 6, 7],
      3,
      async n => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await new Promise(r => setTimeout(r, 1))
        inFlight--
        if (n === 4) throw new Error('four')
        return n * 10
      },
    )
    expect(peak).toBe(3)
    expect(settled.map(s => s.status)).toEqual([
      'fulfilled',
      'fulfilled',
      'fulfilled',
      'rejected',
      'fulfilled',
      'fulfilled',
      'fulfilled',
    ])
    expect(settled[6]).toEqual({ status: 'fulfilled', value: 70 })
  })
})

describe('monthlyPending', () => {
  it('is pending in the debounce window, before loading flips', () => {
    expect(monthlyPending({ results: null, loading: false, error: null })).toBe(
      true,
    )
  })

  it('settles on a result or on an all-months error', () => {
    expect(monthlyPending({ results: [], loading: false, error: null })).toBe(
      false,
    )
    expect(
      monthlyPending({ results: null, loading: false, error: 'boom' }),
    ).toBe(false)
  })
})

describe('defaultMonthKeys', () => {
  it('starts with the latest two months', () => {
    expect(defaultMonthKeys([JAN!, FEB!, MAR!])).toEqual(['2026-02', '2026-03'])
  })
})

describe('correlationsWith', () => {
  const m = {
    tags: ['A', 'B', 'C', 'D'],
    matrix: [
      [1, 0.2, -0.9, Number.NaN],
      [0.2, 1, 0.5, 0.1],
      [-0.9, 0.5, 1, 0.3],
      [Number.NaN, 0.1, 0.3, 1],
    ],
  }

  it('orders partners by |r|, keeps weak pairs and puts the focus tag first', () => {
    expect(correlationsWith(m, 'A')).toEqual([
      { a: 'A', b: 'C', r: -0.9 },
      { a: 'A', b: 'B', r: 0.2 },
    ])
  })

  it('drops a non-finite r rather than ranking it', () => {
    expect(correlationsWith(m, 'D').map(p => p.b)).toEqual(['C', 'B'])
  })

  it('is empty for a tag the matrix did not resolve', () => {
    expect(correlationsWith(m, 'Z')).toEqual([])
  })
})
