import { describe, it, expect } from 'vitest'
import {
  inverseScalePosition,
  inverseScaleSpread,
  inverseScaleHistogram,
  inverseScaleBoxplot,
} from './inverse-scale-stats'
import type {
  DraftHistogramResult,
  DraftBoxplotResult,
} from '@/services/dataset-draft'

/**
 * DS-LAKE-026. The regression these exist to catch: a SPREAD (std, range,
 * IQR) run through the full affine map picks up the transform's offset and
 * comes back a plausible-looking wrong number. A POSITION must still take
 * the offset.
 */
describe('inverseScalePosition', () => {
  it('is the full affine map — same as inverseScale', () => {
    expect(inverseScalePosition(0.5, { min: 70, max: 75 })).toBe(72.5)
  })
})

describe('inverseScaleSpread', () => {
  it('minmax: a spread scales by the span, with NO offset added', () => {
    // A std-dev of 0.1 in [0,1]-scaled space over a [70,75] fit spans 10%
    // of the 5-unit range — 0.5, not 70.5.
    expect(inverseScaleSpread(0.1, { min: 70, max: 75 })).toBeCloseTo(0.5, 10)
  })

  it('standard: a spread scales by std, with NO mean added', () => {
    expect(inverseScaleSpread(2, { mean: 12.5, std: 3 })).toBeCloseTo(6, 10)
  })

  it('robust: a spread scales by iqr, with NO median added', () => {
    expect(inverseScaleSpread(1.5, { median: 40, iqr: 8 })).toBeCloseTo(12, 10)
  })

  it('is null when the params are not invertible (zero IQR)', () => {
    expect(inverseScaleSpread(1, { median: 40, iqr: 0 })).toBeNull()
  })

  it('is null for an unrecorded or unrecognised params shape', () => {
    expect(inverseScaleSpread(1, undefined)).toBeNull()
    expect(inverseScaleSpread(1, {})).toBeNull()
  })
})

describe('inverseScaleHistogram', () => {
  const result: DraftHistogramResult = {
    source_key: 'ds-1/artifacts/gold-1/validate_data.parquet',
    domain_min: 0,
    domain_max: 1,
    tags: [
      {
        tag: 'TAG_A',
        mean: 0.5,
        median: 0.5,
        mode: 0.4,
        std: 0.1,
        min: 0,
        max: 1,
        range: 1,
        count: 100,
        kde: [
          { x: 0, y: 2 },
          { x: 0.5, y: 10 },
          { x: 1, y: 2 },
        ],
      },
    ],
    insufficient_tags: [],
  }

  it('inverts positions with the offset, spreads without it', () => {
    const inverted = inverseScaleHistogram(result, {
      TAG_A: { min: 70, max: 75 },
    })
    const tag = inverted.tags[0]!
    expect(tag.mean).toBeCloseTo(72.5, 10) // position: offset included
    expect(tag.min).toBeCloseTo(70, 10)
    expect(tag.max).toBeCloseTo(75, 10)
    expect(tag.std).toBeCloseTo(0.5, 10) // spread: slope only, not 70.5
    expect(tag.range).toBeCloseTo(5, 10)
    expect(tag.kde.map(p => p.x)).toEqual([70, 72.5, 75])
    expect(tag.kde.map(p => p.y)).toEqual([2, 10, 2]) // counts untouched
  })

  it('recomputes domain_min/domain_max from the inverted tags, not the request domain', () => {
    const inverted = inverseScaleHistogram(result, {
      TAG_A: { min: 70, max: 75 },
    })
    expect(inverted.domain_min).toBe(70)
    expect(inverted.domain_max).toBe(75)
  })

  it('drops a tag with no invertible fit into insufficient_tags rather than pass it through scaled', () => {
    const inverted = inverseScaleHistogram(result, {})
    expect(inverted.tags).toEqual([])
    expect(inverted.insufficient_tags).toEqual(['TAG_A'])
    expect(inverted.domain_min).toBeNull()
    expect(inverted.domain_max).toBeNull()
  })

  it('a null scalingParams map treats every tag as non-invertible', () => {
    const inverted = inverseScaleHistogram(result, null)
    expect(inverted.tags).toEqual([])
    expect(inverted.insufficient_tags).toEqual(['TAG_A'])
  })
})

describe('inverseScaleBoxplot', () => {
  const result: DraftBoxplotResult = {
    source_key: 'ds-1/artifacts/gold-1/validate_data.parquet',
    tags: [
      {
        tag: 'TAG_A',
        min: 0,
        q1: 0.25,
        median: 0.5,
        mean: 0.5,
        q3: 0.75,
        max: 1,
        whisker_low: 0,
        whisker_high: 1,
        outliers: [0.9],
        outlier_count: 1,
        count: 100,
      },
    ],
    insufficient_tags: [],
  }

  it('inverts every field as a position, offset included', () => {
    const inverted = inverseScaleBoxplot(result, {
      TAG_A: { min: 70, max: 75 },
    })
    const tag = inverted.tags[0]!
    expect(tag.min).toBeCloseTo(70, 10)
    expect(tag.q1).toBeCloseTo(71.25, 10)
    expect(tag.median).toBeCloseTo(72.5, 10)
    expect(tag.q3).toBeCloseTo(73.75, 10)
    expect(tag.max).toBeCloseTo(75, 10)
    expect(tag.outliers).toEqual([74.5])
    expect(tag.outlier_count).toBe(1) // count, untouched
  })

  it('drops a tag with no invertible fit into insufficient_tags', () => {
    const inverted = inverseScaleBoxplot(result, {})
    expect(inverted.tags).toEqual([])
    expect(inverted.insufficient_tags).toEqual(['TAG_A'])
  })
})
