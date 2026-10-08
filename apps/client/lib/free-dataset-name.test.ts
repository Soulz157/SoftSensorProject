import { describe, it, expect } from 'vitest'
import { freeDatasetName } from './free-dataset-name'

describe('freeDatasetName (DS-LAKE-036)', () => {
  const base = 'Dataset 6 month — new data'

  it('returns the base name when it is free', () => {
    expect(freeDatasetName(base, ['Dataset 6 month'])).toBe(base)
  })

  it('appends (2) when the base name is taken', () => {
    expect(freeDatasetName(base, ['Dataset 6 month', base])).toBe(`${base} (2)`)
  })

  it('skips every suffix already taken', () => {
    expect(freeDatasetName(base, [base, `${base} (2)`, `${base} (3)`])).toBe(
      `${base} (4)`,
    )
  })

  it('compares trimmed names, case-sensitively like the database index', () => {
    expect(freeDatasetName(base, [`  ${base} `])).toBe(`${base} (2)`)
    expect(freeDatasetName(base, [base.toUpperCase()])).toBe(base)
  })
})
