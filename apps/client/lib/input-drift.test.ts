import { describe, expect, it } from 'vitest'
import type {
  ColumnRangeDrift,
  InputTrendSeries,
} from '@/services/model-monitoring'
import {
  explainRangeDrift,
  formatDriftValue,
  formatPct,
  sortBySeverity,
  sparklineRows,
  trendChartRows,
  trendYDomain,
  windowTableRows,
} from './input-drift'

const T = { outOfRangeWarnPct: 5, outOfRangeCriticalPct: 20, minSamples: 30 }

function col(over: Partial<ColumnRangeDrift> = {}): ColumnRangeDrift {
  return {
    column: 'TI202.PV',
    liveTotal: 1440,
    below: 0,
    above: 100,
    outOfRangePct: (100 / 1440) * 100,
    trainMin: 148.5,
    trainMax: 171.2,
    binMode: 'continuous',
    status: 'WARN',
    bins: null,
    ...over,
  }
}

function series(points: InputTrendSeries['points']): InputTrendSeries {
  return {
    resolution: 'raw',
    bucketMinutes: null,
    points,
    windows: [],
    liveMin: null,
    liveMax: null,
    liveMean: null,
    lastOutOfRangeAt: null,
  }
}

describe('formatDriftValue', () => {
  it('keeps small-scale values instead of rounding them to 0', () => {
    expect(formatDriftValue(0.0011)).toBe('0.0011')
    expect(formatDriftValue(171.24)).toBe('171.2')
    expect(formatDriftValue(null)).toBe('—')
  })
})

describe('formatPct', () => {
  it('shows one decimal under 10% and none above', () => {
    expect(formatPct(6.944)).toBe('6.9%')
    expect(formatPct(100)).toBe('100%')
    expect(formatPct(0)).toBe('0%')
    expect(formatPct(null)).toBe('—')
  })
})

describe('explainRangeDrift', () => {
  it('quotes the range and the WARN verdict from the backend thresholds', () => {
    const e = explainRangeDrift(col(), T)
    expect(e.criteria[0]).toBe('Training range 148.5 – 171.2')
    expect(e.criteria[1]).toMatch(/Out of range 6\.9% .* ≥ 5% → WARN/)
  })

  it('grades CRITICAL at the critical cutoff', () => {
    const e = explainRangeDrift(
      col({ above: 1440, outOfRangePct: 100, status: 'CRITICAL' }),
      T,
    )
    expect(e.criteria[1]).toMatch(/≥ 20% → CRITICAL$/)
  })

  it('has no criteria for UNKNOWN and states the sample floor for INSUFFICIENT_DATA', () => {
    expect(
      explainRangeDrift(
        col({ status: 'UNKNOWN', trainMin: null, trainMax: null }),
        T,
      ).criteria,
    ).toEqual([])
    expect(
      explainRangeDrift(col({ status: 'INSUFFICIENT_DATA', liveTotal: 12 }), T)
        .criteria,
    ).toEqual(['12 of 30 values required'])
  })

  it('prints no number before thresholds load', () => {
    expect(explainRangeDrift(col(), undefined).criteria).toEqual([])
  })
})

describe('trendChartRows', () => {
  it('marks only counted points, on the extreme that left the range', () => {
    const rows = trendChartRows(
      series([
        {
          t: '2026-10-19T00:00:00Z',
          value: 160,
          min: 155,
          max: 165,
          outOfRange: 0,
        },
        // Mean inside, max spiked above: the mark sits on the max.
        {
          t: '2026-10-19T00:15:00Z',
          value: 168,
          min: 160,
          max: 175,
          outOfRange: 2,
        },
        {
          t: '2026-10-19T00:30:00Z',
          value: 147,
          min: 146,
          max: 149,
          outOfRange: 5,
        },
      ]),
      148.5,
      171.2,
    )
    expect(rows.map(r => r.outValue)).toEqual([null, 175, 146])
    expect(rows[0]!.envelope).toEqual([155, 165])
  })

  it('never marks a point the backend did not count (categorical tolerance)', () => {
    const rows = trendChartRows(
      series([
        {
          t: '2026-10-19T00:00:00Z',
          value: 2.2,
          min: 2.2,
          max: 2.2,
          outOfRange: 0,
        },
      ]),
      0,
      2,
    )
    expect(rows[0]!.outValue).toBeNull()
  })
})

describe('trendYDomain', () => {
  it('keeps both training lines on screen even when every value is outside', () => {
    const [lo, hi] = trendYDomain([{ min: 4.6, max: 5.0 }], 0.82, 4.2)!
    expect(lo).toBeLessThan(0.82)
    expect(hi).toBeGreaterThan(5.0)
  })

  it('returns null with nothing to scale', () => {
    expect(trendYDomain([], null, null)).toBeNull()
  })
})

describe('sparklineRows', () => {
  it('downsamples to the cap and keeps an out-of-range mark inside a chunk', () => {
    const points = Array.from({ length: 200 }, (_, i) => ({
      t: new Date(Date.UTC(2026, 9, 19, 0, i)).toISOString(),
      value: 10,
      min: 10,
      max: i === 57 ? 30 : 10,
      outOfRange: i === 57 ? 1 : 0,
    }))
    const rows = sparklineRows(series(points), 0, 20, 40)
    expect(rows.length).toBeLessThanOrEqual(40)
    expect(rows.filter(r => r.outValue !== null)).toHaveLength(1)
  })
})

describe('windowTableRows', () => {
  it('sorts newest first and computes each window share', () => {
    const rows = windowTableRows([
      {
        windowStart: '2026-10-19T00:00:00Z',
        windowEnd: '2026-10-19T01:00:00Z',
        n: 60,
        min: 1,
        max: 2,
        mean: 1.5,
        below: 0,
        above: 6,
      },
      {
        windowStart: '2026-10-19T01:00:00Z',
        windowEnd: '2026-10-19T02:00:00Z',
        n: 0,
        min: null,
        max: null,
        mean: null,
        below: 0,
        above: 0,
      },
    ])
    expect(rows.map(r => r.windowStart)).toEqual([
      '2026-10-19T01:00:00Z',
      '2026-10-19T00:00:00Z',
    ])
    expect(rows[0]!.outOfRangePct).toBeNull()
    expect(rows[1]!.outOfRangePct).toBe(10)
  })
})

describe('sortBySeverity', () => {
  it('puts CRITICAL then WARN first and keeps backend order within a status', () => {
    const sorted = sortBySeverity([
      { status: 'OK' as const, id: 'a' },
      { status: 'WARN' as const, id: 'b' },
      { status: 'UNKNOWN' as const, id: 'c' },
      { status: 'CRITICAL' as const, id: 'd' },
      { status: 'OK' as const, id: 'e' },
    ])
    expect(sorted.map(s => s.id)).toEqual(['d', 'b', 'a', 'e', 'c'])
  })
})
