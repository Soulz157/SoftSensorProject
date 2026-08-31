import { describe, expect, it } from 'vitest'
import type { Cell, DataRow, Dataset } from './preprocessing'
import {
  histogramBins,
  tagBoxplotStats,
  mostCorrelatedPartner,
  pearsonMatrix,
  kdeEstimate,
  densityToCount,
  frozenByTag,
  badDataByTag,
  badDataDetailByTag,
} from './data-quality'

function dataset(values: Record<string, (number | null)[]>): Dataset {
  const tags = Object.keys(values)
  const n = Math.max(...tags.map(t => values[t]!.length))
  const rows = Array.from({ length: n }, (_, i) => ({
    timestamp: `2026-01-01T00:0${i}:00Z`,
    cells: Object.fromEntries(
      tags.map(t => {
        const v = values[t]![i]
        return [
          t,
          v === null || v === undefined
            ? { value: 0, status: 'Bad' as const }
            : { value: v, status: 'Good' as const },
        ]
      }),
    ),
  }))
  return { tags, rows }
}

const FREEZE_TAG = 'FT'
const BASE_MS = Date.UTC(2026, 0, 1)
const hoursIso = (h: number) => new Date(BASE_MS + h * 3_600_000).toISOString()
const minutesIso = (m: number) => new Date(BASE_MS + m * 60_000).toISOString()

interface FreezePoint {
  ts: string
  value?: number
  status?: 'Good' | 'Bad' | 'Questionable'
  missing?: boolean
}

function freezeDataset(points: FreezePoint[]): Dataset {
  const rows: DataRow[] = points.map(p => {
    const cells: Record<string, Cell> = p.missing
      ? {}
      : { [FREEZE_TAG]: { value: p.value ?? 0, status: p.status ?? 'Good' } }
    return { timestamp: p.ts, cells }
  })
  return { tags: [FREEZE_TAG], rows }
}

describe('frozenByTag', () => {
  it('flags 3 identical Good cells 1h apart as frozen (coverage = 3h)', () => {
    const ds = freezeDataset([
      { ts: hoursIso(0), value: 100 },
      { ts: hoursIso(1), value: 100 },
      { ts: hoursIso(2), value: 100 },
    ])
    expect(frozenByTag(ds)[FREEZE_TAG]).toBe(3)
  })

  it('does not flag 2 identical Good cells 1h apart (coverage = 2h)', () => {
    const ds = freezeDataset([
      { ts: hoursIso(0), value: 100 },
      { ts: hoursIso(1), value: 100 },
    ])
    expect(frozenByTag(ds)[FREEZE_TAG]).toBe(0)
  })

  it('flags 180 identical Good cells 1min apart (coverage = 3h)', () => {
    const points = Array.from({ length: 180 }, (_, i) => ({
      ts: minutesIso(i),
      value: 100,
    }))
    expect(frozenByTag(freezeDataset(points))[FREEZE_TAG]).toBe(180)
  })

  it('does not flag 179 identical Good cells 1min apart (coverage just under 3h)', () => {
    const points = Array.from({ length: 179 }, (_, i) => ({
      ts: minutesIso(i),
      value: 100,
    }))
    expect(frozenByTag(freezeDataset(points))[FREEZE_TAG]).toBe(0)
  })

  it('breaks a run on a Bad cell, so a would-qualify run split in two does not count', () => {
    const ds = freezeDataset([
      { ts: hoursIso(0), value: 100 },
      { ts: hoursIso(1), value: 100 },
      { ts: hoursIso(2), value: 0, status: 'Bad' },
      { ts: hoursIso(3), value: 100 },
      { ts: hoursIso(4), value: 100 },
    ])
    expect(frozenByTag(ds)[FREEZE_TAG]).toBe(0)
  })

  it('never flags a run of Bad cells (freeze only scans Good cells)', () => {
    const points = Array.from({ length: 5 }, (_, i) => ({
      ts: hoursIso(i),
      value: 0,
      status: 'Bad' as const,
    }))
    expect(frozenByTag(freezeDataset(points))[FREEZE_TAG]).toBe(0)
  })

  it('breaks a run across a large timestamp gap, even with identical values either side', () => {
    // Without a gap check this would look like one continuous 4-point run
    // (coverage 15h, well past the 3h window); the gap must split it into
    // two 2-point runs, each below the window on its own.
    const ds = freezeDataset([
      { ts: hoursIso(0), value: 100 },
      { ts: hoursIso(1), value: 100 },
      { ts: hoursIso(13), value: 100 },
      { ts: hoursIso(14), value: 100 },
    ])
    expect(frozenByTag(ds)[FREEZE_TAG]).toBe(0)
  })

  it('counts both runs when a tag goes flat, changes value, then goes flat again', () => {
    const points = [
      ...Array.from({ length: 5 }, (_, i) => ({ ts: hoursIso(i), value: 100 })),
      ...Array.from({ length: 5 }, (_, i) => ({
        ts: hoursIso(i + 5),
        value: 200,
      })),
    ]
    expect(frozenByTag(freezeDataset(points))[FREEZE_TAG]).toBe(10)
  })

  it('exempts a tag listed in ignoreTags', () => {
    const ds = freezeDataset([
      { ts: hoursIso(0), value: 100 },
      { ts: hoursIso(1), value: 100 },
      { ts: hoursIso(2), value: 100 },
    ])
    expect(frozenByTag(ds, { ignoreTags: [FREEZE_TAG] })[FREEZE_TAG]).toBe(0)
  })

  it('reports 0 when every timestamp is unparseable', () => {
    const ds = freezeDataset([
      { ts: 'not-a-timestamp', value: 100 },
      { ts: 'still-not-a-timestamp', value: 100 },
      { ts: 'also-not-a-timestamp', value: 100 },
    ])
    expect(frozenByTag(ds)[FREEZE_TAG]).toBe(0)
  })

  it('splits a run at a single unparseable-timestamp row instead of zeroing out the whole tag', () => {
    const ds = freezeDataset([
      { ts: hoursIso(0), value: 100 },
      { ts: hoursIso(1), value: 100 },
      { ts: hoursIso(2), value: 100 },
      { ts: 'not-a-timestamp', value: 100 },
      { ts: hoursIso(4), value: 100 },
      { ts: hoursIso(5), value: 100 },
      { ts: hoursIso(6), value: 100 },
    ])
    // 3 before the bad row (coverage 3h) + 3 after (coverage 3h) = 6.
    expect(frozenByTag(ds)[FREEZE_TAG]).toBe(6)
  })
})

describe('badDataDetailByTag', () => {
  it('sums to exactly badDataByTag (Missing + Null + Frozen tiles match the pill)', () => {
    const ds = freezeDataset([
      { ts: hoursIso(0), value: 0, status: 'Bad' },
      { ts: hoursIso(1), value: 0, status: 'Bad' },
      { ts: hoursIso(2), value: 5, status: 'Questionable' },
      { ts: hoursIso(3), value: 100 },
      { ts: hoursIso(4), value: 100 },
      { ts: hoursIso(5), value: 100 },
    ])
    const detail = badDataDetailByTag(ds)[FREEZE_TAG]!
    const pill = badDataByTag(ds)[FREEZE_TAG]

    expect(detail.bad).toBe(2)
    expect(detail.questionable).toBe(1)
    expect(detail.frozen).toBe(3)
    expect(detail.bad + detail.questionable + detail.frozen).toBe(pill)
  })
})

describe('histogramBins', () => {
  it('bins Good values into equal-width buckets spanning [min, max]', () => {
    // 0..10 (11 values), 5 bins → width 2, one value per bin edge overlap
    // handled by the inclusive-max rule (10 lands in the last bin).
    const ds = dataset({ a: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] })
    const bins = histogramBins(ds, 'a', 5)
    expect(bins).toHaveLength(5)
    expect(bins[0]).toMatchObject({ binStart: 0, binEnd: 2 })
    expect(bins[4]).toMatchObject({ binStart: 8, binEnd: 10 })
    expect(bins.reduce((sum, b) => sum + b.count, 0)).toBe(11)
  })

  it('puts a value equal to max in the final bin (inclusive upper edge)', () => {
    const ds = dataset({ a: [0, 10] })
    const bins = histogramBins(ds, 'a', 2)
    expect(bins[1]!.count).toBe(1)
    expect(bins[0]!.count).toBe(1)
  })

  it('ignores Bad cells when binning', () => {
    const ds = dataset({ a: [0, null, 10] })
    const bins = histogramBins(ds, 'a', 2)
    expect(bins.reduce((sum, b) => sum + b.count, 0)).toBe(2)
  })

  it('returns [] with fewer than 2 distinct Good values', () => {
    expect(histogramBins(dataset({ a: [5] }), 'a')).toEqual([])
    expect(histogramBins(dataset({ a: [5, 5, 5] }), 'a')).toEqual([])
    expect(histogramBins(dataset({ a: [] }), 'a')).toEqual([])
  })

  it('spans an explicit shared domain instead of the tag`s own min/max', () => {
    // Tag's own range is [2, 4], but a wider shared domain [0, 10] is passed
    // (e.g. the union domain across multiple overlaid tags) — bins must span
    // the shared domain, and the tag's values land in the bins matching their
    // position within that wider range, not re-normalized to their own range.
    const ds = dataset({ a: [2, 4] })
    const bins = histogramBins(ds, 'a', 5, { min: 0, max: 10 })
    expect(bins).toHaveLength(5)
    expect(bins[0]).toMatchObject({ binStart: 0, binEnd: 2 })
    expect(bins[4]).toMatchObject({ binStart: 8, binEnd: 10 })
    // 2 lands in bin [2,4), 4 lands in bin [4,6) — not both in the first bin.
    expect(bins[1]!.count).toBe(1)
    expect(bins[2]!.count).toBe(1)
    expect(bins.reduce((sum, b) => sum + b.count, 0)).toBe(2)
  })
})

describe('kdeEstimate', () => {
  it('samples exactly `sampleCount` points spanning the domain', () => {
    const points = kdeEstimate([1, 2, 3, 4, 5], { min: 0, max: 10 }, 50)
    expect(points).toHaveLength(50)
    expect(points[0]!.x).toBeCloseTo(0)
    expect(points[49]!.x).toBeCloseTo(10)
  })

  it('produces x values that increase monotonically across the domain', () => {
    const points = kdeEstimate([1, 2, 3, 4, 5], { min: 0, max: 10 })
    for (let i = 1; i < points.length; i++) {
      expect(points[i]!.x).toBeGreaterThan(points[i - 1]!.x)
    }
  })

  it('integrates to approximately 1 (trapezoidal rule over the domain)', () => {
    const domain = { min: -10, max: 20 }
    const points = kdeEstimate([1, 2, 3, 4, 5, 6, 7, 8], domain, 500)
    let area = 0
    for (let i = 1; i < points.length; i++) {
      const dx = points[i]!.x - points[i - 1]!.x
      area += ((points[i]!.y + points[i - 1]!.y) / 2) * dx
    }
    expect(area).toBeCloseTo(1, 1)
  })

  it('returns [] for fewer than 2 values, zero variance, or a degenerate domain', () => {
    expect(kdeEstimate([5], { min: 0, max: 10 })).toEqual([])
    expect(kdeEstimate([], { min: 0, max: 10 })).toEqual([])
    expect(kdeEstimate([5, 5, 5], { min: 0, max: 10 })).toEqual([])
    expect(kdeEstimate([1, 2, 3], { min: 10, max: 0 })).toEqual([])
    expect(kdeEstimate([1, 2, 3], { min: 5, max: 5 })).toEqual([])
  })
})

describe('densityToCount', () => {
  it('rescales density onto the count axis (density * n * binWidth)', () => {
    expect(densityToCount(0.1, 100, 2)).toBeCloseTo(20)
    expect(densityToCount(0, 100, 2)).toBe(0)
  })
})

describe('tagBoxplotStats', () => {
  it('computes the five-number summary via linear-interpolated quartiles', () => {
    // Sorted: 1,2,3,4,5,6,7,8,9,10 (n=10)
    const ds = dataset({ a: [10, 3, 7, 1, 9, 2, 8, 4, 6, 5] })
    const stats = tagBoxplotStats(ds, 'a')
    expect(stats.min).toBe(1)
    expect(stats.max).toBe(10)
    expect(stats.median).toBe(5.5)
    // q1 at index 0.25*9=2.25 -> between sorted[2]=3 and sorted[3]=4 -> 3.25
    expect(stats.q1).toBeCloseTo(3.25)
    // q3 at index 0.75*9=6.75 -> between sorted[6]=7 and sorted[7]=8 -> 7.75
    expect(stats.q3).toBeCloseTo(7.75)
    // mean of 1..10 = 5.5
    expect(stats.mean).toBeCloseTo(5.5)
    expect(stats.outliers).toEqual([])
  })

  it('flags values beyond 1.5x IQR as outliers and clamps whiskers to observed range', () => {
    const ds = dataset({ a: [1, 2, 3, 4, 5, 6, 7, 8, 9, 100] })
    const stats = tagBoxplotStats(ds, 'a')
    expect(stats.outliers).toContain(100)
    expect(stats.whiskerHigh).toBeLessThan(100)
    expect(stats.whiskerHigh).toBeLessThanOrEqual(stats.max)
    expect(stats.whiskerLow).toBeGreaterThanOrEqual(stats.min)
  })

  it('returns all-zero stats with no outliers for a tag with 0 Good cells', () => {
    const ds = dataset({ a: [null, null] })
    expect(tagBoxplotStats(ds, 'a')).toEqual({
      min: 0,
      q1: 0,
      median: 0,
      mean: 0,
      q3: 0,
      max: 0,
      whiskerLow: 0,
      whiskerHigh: 0,
      outliers: [],
    })
  })
})

describe('mostCorrelatedPartner', () => {
  it('returns the argmax |r| partner, excluding self', () => {
    // b tracks a exactly (r=1), c is inversely related but weaker, d is noise.
    const ds = dataset({
      a: [1, 2, 3, 4, 5],
      b: [2, 4, 6, 8, 10],
      c: [5, 4, 3, 2, 1],
      d: [3, 1, 4, 1, 5],
    })
    const matrix = pearsonMatrix(ds)
    expect(mostCorrelatedPartner(matrix, 'a')).toBe('b')
  })

  it('returns a partner even when below the 0.8 topCorrelations threshold', () => {
    // Weak, sub-threshold correlation — topCorrelations(matrix) would return
    // [] here, but mostCorrelatedPartner must still pick the argmax partner.
    const ds = dataset({
      a: [1, 5, 2, 4, 3],
      b: [3, 2, 5, 1, 4],
    })
    const matrix = pearsonMatrix(ds)
    expect(Math.abs(matrix.matrix[0]![1]!)).toBeLessThan(0.8)
    expect(mostCorrelatedPartner(matrix, 'a')).toBe('b')
  })

  it('returns null for an unknown tag or a single-tag matrix', () => {
    const ds = dataset({ a: [1, 2, 3] })
    const matrix = pearsonMatrix(ds)
    expect(mostCorrelatedPartner(matrix, 'a')).toBeNull()
    expect(mostCorrelatedPartner(matrix, 'zzz')).toBeNull()
  })
})
