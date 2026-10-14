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
  labStaleRuns,
  describeLabStale,
  labStaleNotices,
  LAB_STALE_FLOOR_MS,
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

// ── Lab-tag stale runs ─────────────────────────────────────────────────────
// Shaped on the real `s611water.lab` (draft 96734a45): hourly grid, the lab
// value changes about once a day (median run 23h, p90 95h), a few ~9-day
// stretches, then one value carried forward for 113 days.

const LAB = 's611water.lab'
const HOUR = 3_600_000
const DAY = 24 * HOUR

/** Hourly rows for one lab tag; `segments` are [value, hours] in order. */
function labDataset(
  segments: Array<[number, number]>,
  tag = LAB,
  extra: Partial<Record<number, Partial<Cell> | 'missing'>> = {},
): Dataset {
  const rows: DataRow[] = []
  let h = 0
  for (const [value, hours] of segments) {
    for (let i = 0; i < hours; i++, h++) {
      const override = extra[h]
      const cells: Record<string, Cell> =
        override === 'missing'
          ? {}
          : { [tag]: { value, status: 'Good', ...override } }
      rows.push({ timestamp: hoursIso(h), cells })
    }
  }
  return { tags: [tag], rows }
}

/** 30 daily lab samples, each held 24h — the normal carry-forward shape. */
function dailySegments(days: number, start = 1): Array<[number, number]> {
  return Array.from({ length: days }, (_, i) => [start + i * 0.01, 24])
}

describe('labStaleRuns', () => {
  it('uses the tag`s own median run as its typical interval', () => {
    const r = labStaleRuns(labDataset(dailySegments(30)), LAB)
    expect(r.typicalMs).toBe(DAY)
    // 5 x 24h = 5 days, above the 3-day floor.
    expect(r.thresholdMs).toBe(5 * DAY)
    expect(r.runs).toEqual([])
  })

  it('flags a 9-day hold and a 113-day hold, but not normal daily samples', () => {
    const r = labStaleRuns(
      labDataset([
        ...dailySegments(30),
        [1.4651, 9 * 24],
        ...dailySegments(10, 2),
        [1.2764, 113 * 24],
      ]),
      LAB,
    )
    expect(r.runs.map(run => run.value)).toEqual([1.4651, 1.2764])
    expect(r.runs[1]!.durationMs).toBe(113 * DAY)
    expect(r.runs[1]!.rows).toBe(113 * 24)
    expect(r.runs[1]!.from).toBe(hoursIso(49 * 24))
  })

  it('never goes below the 3-day floor, even for a fast-changing tag', () => {
    // Value changes every 2h -> 5 x 2h = 10h, floored to 3 days.
    const segs: Array<[number, number]> = Array.from({ length: 60 }, (_, i) => [
      i,
      2,
    ])
    segs.push([999, 2 * 24]) // 2 days flat: under the floor
    const r = labStaleRuns(labDataset(segs), LAB)
    expect(r.thresholdMs).toBe(LAB_STALE_FLOOR_MS)
    expect(r.runs).toEqual([])
  })

  it('falls back to the floor when there are too few runs for a median', () => {
    // One value for the whole frame — the worst case, must still be caught.
    const r = labStaleRuns(labDataset([[1.2764, 10 * 24]]), LAB)
    expect(r.typicalMs).toBeNull()
    expect(r.thresholdMs).toBe(LAB_STALE_FLOOR_MS)
    expect(r.runs).toHaveLength(1)
  })

  it('splits a run at a Bad or missing cell — absence is not evidence of a stale value', () => {
    const r = labStaleRuns(
      labDataset(
        [...dailySegments(30), [1.2764, 8 * 24]],
        LAB,
        // Breaks the 8-day hold into two 4-day halves, each under 5 days.
        { [30 * 24 + 4 * 24]: { status: 'Bad' } },
      ),
      LAB,
    )
    expect(r.runs).toEqual([])
  })
})

describe('qualityByTag — lab tags count Frozen by the stale rule', () => {
  it('no longer counts normal daily carry-forward as Frozen', () => {
    const ds = labDataset(dailySegments(30))
    expect(frozenByTag(ds)[LAB]).toBe(0)
    // The SAME shape on a non-lab tag keeps the 3h rule: every row frozen.
    const plain = labDataset(dailySegments(30), 'FI001.PV')
    expect(frozenByTag(plain)['FI001.PV']).toBe(30 * 24)
  })

  it('counts exactly the rows of the stale runs', () => {
    const ds = labDataset([...dailySegments(30), [1.2764, 113 * 24]])
    expect(frozenByTag(ds)[LAB]).toBe(113 * 24)
  })

  it('still exempts a lab tag listed in ignoreTags', () => {
    const ds = labDataset([[1.2764, 10 * 24]])
    expect(frozenByTag(ds, { ignoreTags: [LAB] })[LAB]).toBe(0)
  })
})

describe('describeLabStale', () => {
  it('names the value, span and usual interval, and says nothing is removed', () => {
    const r = labStaleRuns(
      labDataset([...dailySegments(30), [1.2764, 113 * 24]]),
      LAB,
    )
    const [msg] = describeLabStale(LAB, r)
    expect(msg).toContain('s611water.lab')
    expect(msg).toContain('1.2764')
    expect(msg).toContain('113 days')
    expect(msg).toContain('~1 day')
    expect(msg).toMatch(/nothing is removed/i)
  })

  it('leads with the longest hold and folds the rest into one line', () => {
    const r = labStaleRuns(
      labDataset([
        ...dailySegments(30),
        [1.4651000499725342, 9 * 24],
        ...dailySegments(5, 2),
        [1.4651000499725342, 6 * 24],
        ...dailySegments(5, 3),
        [1.2763999700546265, 113 * 24],
      ]),
      LAB,
    )
    const lines = describeLabStale(LAB, r)
    expect(lines).toHaveLength(2)
    // float32 noise trimmed for display.
    expect(lines[0]).toContain('unchanged at 1.2764 for 113 days')
    expect(lines[1]).toContain('6–9 days on 2 other occasions')
  })

  it('returns nothing when no run is stale', () => {
    expect(
      describeLabStale(LAB, labStaleRuns(labDataset(dailySegments(30)), LAB)),
    ).toEqual([])
  })
})

describe('labStaleNotices', () => {
  it('reports lab tags only, never a flat sensor tag', () => {
    const lab = labDataset([...dailySegments(30), [1.2764, 113 * 24]])
    const sensor = labDataset([[5, 143 * 24]], 'FI001.PV')
    const ds: Dataset = {
      tags: [LAB, 'FI001.PV'],
      rows: lab.rows.map((row, i) => ({
        ...row,
        cells: { ...row.cells, ...sensor.rows[i]!.cells },
      })),
    }
    const lines = labStaleNotices(ds)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain(LAB)
    expect(lines.join(' ')).not.toContain('FI001.PV')
  })
})
