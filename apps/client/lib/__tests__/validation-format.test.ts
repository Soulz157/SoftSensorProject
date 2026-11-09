import { describe, expect, it } from 'vitest'
import { formatCheckMeasure } from '@/lib/validation-format'

describe('formatCheckMeasure', () => {
  it('missing_values is already a percent', () => {
    expect(formatCheckMeasure('missing_values', 37.5, 20)).toBe(
      'worst 37.5% missing (limit 20%)',
    )
  })

  it('statistical outliers are fractions, shown as percents', () => {
    expect(formatCheckMeasure('statistical', 0.1234, 0.05)).toBe(
      'worst 12.3% outliers (limit 5%)',
    )
  })

  it('statistical with only stuck tags reports their count', () => {
    expect(formatCheckMeasure('statistical', 3, 0.05)).toBe(
      '3 zero-variance tags',
    )
    expect(formatCheckMeasure('statistical', 1, 0.05)).toBe(
      '1 zero-variance tag',
    )
  })

  it('count checks read as a count; nothing when unmeasured', () => {
    expect(formatCheckMeasure('duplicate_timestamps', 4, 0)).toBe('4 found')
    expect(formatCheckMeasure('completeness', null, 0)).toBeNull()
    expect(formatCheckMeasure('schema', undefined, undefined)).toBeNull()
  })
})
