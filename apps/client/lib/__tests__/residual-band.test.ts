import { describe, expect, it } from 'vitest'
import {
  CLIP_SD,
  DOMAIN_SD,
  bandCoverage,
  beyondBandCounts,
  residualBand,
  type ResidualPoint,
} from '@/lib/residual-band'

const pts = (values: number[]): ResidualPoint[] =>
  values.map((value, i) => ({ t: i * 3_600_000, value }))

describe('residualBand', () => {
  it('hides the bands below 3 points, saying how many there are', () => {
    expect(residualBand(pts([0.1, 0.2]), 0.05)).toEqual({
      show: false,
      reason: 'few-points',
      n: 2,
    })
  })

  it('hides the bands when there is no spread (SD 0)', () => {
    expect(residualBand(pts([0.3, 0.3, 0.3]), 0)).toMatchObject({
      show: false,
      reason: 'no-spread',
    })
  })

  it('always shows 0 ± 3.5 SD, so the bands around 0 are readable', () => {
    const band = residualBand(pts([0.01, -0.01, 0.002, 0]), 0.01)
    if (!band.show) throw new Error('expected bands')
    expect(band.domain[0]).toBeLessThanOrEqual(-DOMAIN_SD * 0.01)
    expect(band.domain[1]).toBeGreaterThanOrEqual(DOMAIN_SD * 0.01)
  })

  it('keeps a biased model on the axis WITH the bands around 0 (the s611water case)', () => {
    // every point near -0.038, SD 0.0028: ~13.5 SD from 0
    const band = residualBand(
      pts([-0.04, -0.036, -0.035, -0.037, -0.042]),
      0.0028,
    )
    if (!band.show) throw new Error('expected bands')
    expect(band.domain[1]).toBeGreaterThanOrEqual(DOMAIN_SD * 0.0028)
    // every point stays on the axis: a consistent bias is NOT clipped
    expect(band.domain[0]).toBeLessThan(-0.042)
    expect(band.outliers).toEqual([])
  })

  it('clips a far point to the edge as an outlier instead of stretching the axis', () => {
    const band = residualBand(pts([0, 0.1, -0.1, 0.05, -0.05, 50]), 0.1)
    if (!band.show) throw new Error('expected bands')
    expect(band.outliers).toHaveLength(1)
    const [o] = band.outliers
    expect(o).toMatchObject({ t: 5 * 3_600_000, value: 50, edge: 'top' })
    // drawn on the clip limit measured from the bulk of the data (~0)
    expect(o!.drawAt).toBeCloseTo(CLIP_SD * 0.1, 6)
    expect(band.domain[1]).toBeLessThan(50)
    expect(band.domain[1]).toBeGreaterThanOrEqual(o!.drawAt)
  })

  it('marks a far negative point at the bottom edge', () => {
    const band = residualBand(pts([0, 0.1, -0.1, 0.05, -40]), 0.1)
    if (!band.show) throw new Error('expected bands')
    expect(band.outliers.map(o => o.edge)).toEqual(['bottom'])
  })
})

describe('bandCoverage', () => {
  it('counts outward from 0', () => {
    // sd 1: 0.5 (within +1), 1.5 (+1..+2), -2.5 (-2..-3), 0 (on the line)
    const c = bandCoverage([0.5, 1.5, -2.5, 0], 1)
    expect(c?.[1]).toEqual({ up: 25, down: 0 })
    expect(c?.[2]).toEqual({ up: 25, down: 0 })
    expect(c?.[3]).toEqual({ up: 0, down: 25 })
  })

  it('a biased series sits outside the bands around 0', () => {
    const c = bandCoverage([-0.04, -0.036, -0.035], 0.0028)
    expect(c?.[1]).toEqual({ up: 0, down: 0 })
    expect(c?.[3]).toEqual({ up: 0, down: 0 })
  })

  it('is null with no values or no spread', () => {
    expect(bandCoverage([], 1)).toBeNull()
    expect(bandCoverage([1, 2], 0)).toBeNull()
  })
})

describe('residualBand — reference SD fallback', () => {
  it('uses the version test-split SD while there are too few points', () => {
    const band = residualBand(pts([0.2, -0.1]), 0, 0.5)
    expect(band).toMatchObject({ show: true, sd: 0.5, sdSource: 'reference' })
  })

  it('uses the reference SD when the live SD is 0 (no spread yet)', () => {
    const band = residualBand(pts([0.3, 0.3, 0.3]), 0, 0.5)
    expect(band).toMatchObject({ show: true, sd: 0.5, sdSource: 'reference' })
  })

  it('prefers the live SD once the range has enough points of its own', () => {
    const band = residualBand(pts([0.1, -0.1, 0.05]), 0.08, 0.5)
    expect(band).toMatchObject({ show: true, sd: 0.08, sdSource: 'live' })
  })

  it('still hides the bands when there is no reference either', () => {
    expect(residualBand(pts([0.1, 0.2]), 0, null)).toMatchObject({
      show: false,
      reason: 'few-points',
    })
  })

  it('draws nothing before the first point, reference or not', () => {
    expect(residualBand([], 0, 0.5)).toMatchObject({ show: false })
  })
})

describe('beyondBandCounts', () => {
  it('counts the points beyond ±3 SD of 0 on each side', () => {
    expect(beyondBandCounts([-0.04, -0.036, 0.001, 0.02], 0.0028)).toEqual({
      above: 1,
      below: 2,
      n: 4,
    })
  })

  it('counts nothing inside the bands or without a spread', () => {
    expect(beyondBandCounts([0.1, -0.2], 1)).toEqual({
      above: 0,
      below: 0,
      n: 2,
    })
    expect(beyondBandCounts([5, -5], 0)).toEqual({ above: 0, below: 0, n: 2 })
  })
})
