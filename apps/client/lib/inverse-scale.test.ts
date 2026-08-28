import { describe, it, expect } from 'vitest'
import { inferScalerMethod, inverseScale, isInvertible } from './inverse-scale'

/**
 * DS-LAKE-025-T06. The point of these is not arithmetic — it is that every
 * case which CANNOT be stated in engineering units comes back `null` rather
 * than a plausible-looking number. A wrong value here renders as a real
 * measurement on a chart axis.
 */
describe('inferScalerMethod', () => {
  it('reads the method off the params keys, not off feature_spec.scaling', () => {
    // The live case that motivated this: a dataset scaled entirely by
    // DEFAULT_SCALER carries `"scaling": []` while scalingParams is full.
    expect(inferScalerMethod({ min: 70, max: 75 })).toBe('minmax')
    expect(inferScalerMethod({ mean: 12.5, std: 2 })).toBe('standard')
    expect(inferScalerMethod({ median: 40, iqr: 8 })).toBe('robust')
  })

  it('returns null for a shape it does not recognise', () => {
    expect(inferScalerMethod({})).toBeNull()
    expect(inferScalerMethod({ min: 70 })).toBeNull()
  })
})

describe('inverseScale — round trips', () => {
  it('minmax: 0 and 1 land on the recorded bounds', () => {
    const p = { min: 70, max: 75 }
    expect(inverseScale(0, p)).toBe(70)
    expect(inverseScale(1, p)).toBe(75)
    expect(inverseScale(0.5, p)).toBe(72.5)
  })

  it('standard: 0 lands on the mean, 1 lands one sd above it', () => {
    const p = { mean: 12.5, std: 2 }
    expect(inverseScale(0, p)).toBe(12.5)
    expect(inverseScale(1, p)).toBe(14.5)
    expect(inverseScale(-1.5, p)).toBe(9.5)
  })

  it('robust: 0 lands on the median, 1 lands one iqr above it', () => {
    const p = { median: 40, iqr: 8 }
    expect(inverseScale(0, p)).toBe(40)
    expect(inverseScale(1, p)).toBe(48)
  })

  it('recovers a realistic engineering value from a large span', () => {
    // The reported symptom: a tag in the tens of thousands reading below 1.
    const p = { min: 0, max: 45000 }
    expect(inverseScale(0.734, p)).toBeCloseTo(33030, 5)
  })
})

describe('inverseScale — degenerate params that ARE still invertible', () => {
  it('minmax with a zero span returns the constant, not null', () => {
    // Every finite value equalled `min`; Python wrote 0.0 for all of them.
    expect(inverseScale(0, { min: 70, max: 70 })).toBe(70)
  })

  it('standard with a zero std returns the mean, not null', () => {
    expect(inverseScale(0, { mean: 12.5, std: 0 })).toBe(12.5)
  })
})

describe('inverseScale — cases that must NOT produce a number', () => {
  it('robust with a zero iqr is null — a tight middle does not mean a constant column', () => {
    // The one genuinely destroyed case: Python wrote 0.0 for every row, and
    // returning `median` would invent a measurement for each of them.
    expect(inverseScale(0, { median: 40, iqr: 0 })).toBeNull()
    expect(inverseScale(2.5, { median: 40, iqr: 0 })).toBeNull()
  })

  it('unrecorded params are null — "not recorded" is not "not scaled"', () => {
    expect(inverseScale(0.5, undefined)).toBeNull()
  })

  it('an unrecognised params shape is null rather than a guess', () => {
    expect(inverseScale(0.5, {})).toBeNull()
    expect(inverseScale(0.5, { min: 70 })).toBeNull()
  })

  it('a null or non-finite scaled value stays null', () => {
    expect(inverseScale(null, { min: 70, max: 75 })).toBeNull()
    expect(inverseScale(Number.NaN, { min: 70, max: 75 })).toBeNull()
    expect(
      inverseScale(Number.POSITIVE_INFINITY, { min: 70, max: 75 }),
    ).toBeNull()
  })
})

describe('isInvertible', () => {
  it('separates the tags a surface may plot in engineering units from those it may not', () => {
    expect(isInvertible({ min: 70, max: 75 })).toBe(true)
    expect(isInvertible({ min: 70, max: 70 })).toBe(true)
    expect(isInvertible({ mean: 12.5, std: 0 })).toBe(true)
    expect(isInvertible({ median: 40, iqr: 0 })).toBe(false)
    expect(isInvertible(undefined)).toBe(false)
  })
})
