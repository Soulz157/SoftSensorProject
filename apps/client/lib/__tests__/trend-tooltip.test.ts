import { describe, expect, it } from 'vitest'
import {
  TREND_TOOLTIP_MAX_ROWS,
  trendTooltipRows,
  type TrendTooltipEntry,
} from '@/lib/trend-tooltip'

const series = (n: number): TrendTooltipEntry[] =>
  Array.from({ length: n }, (_, i) => ({
    name: `T${i + 1}`,
    value: i,
    color: '#000',
  }))

describe('trendTooltipRows', () => {
  it('lists everything, in one column, for a handful of tags', () => {
    const rows = trendTooltipRows(series(5))
    expect(rows.shown.map(e => e.name)).toEqual(['T1', 'T2', 'T3', 'T4', 'T5'])
    expect(rows.hidden).toBe(0)
    expect(rows.twoColumns).toBe(false)
  })

  it('caps 100 tags and counts the rest', () => {
    const rows = trendTooltipRows(series(100))
    expect(rows.shown).toHaveLength(TREND_TOOLTIP_MAX_ROWS)
    expect(rows.hidden).toBe(100 - TREND_TOOLTIP_MAX_ROWS)
    expect(rows.twoColumns).toBe(true)
  })

  it('puts focused tags first, in focus order, even from far down the list', () => {
    const rows = trendTooltipRows(series(100), ['T90', 'T42'])
    expect(rows.shown.slice(0, 3).map(e => e.name)).toEqual([
      'T90',
      'T42',
      'T1',
    ])
  })

  it('drops series with no reading at this point', () => {
    const rows = trendTooltipRows([
      { name: 'A', value: 1, color: undefined },
      { name: 'B', value: Number.NaN, color: undefined },
    ])
    expect(rows.shown.map(e => e.name)).toEqual(['A'])
    expect(rows.hidden).toBe(0)
  })
})
