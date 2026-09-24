import { describe, expect, it } from 'vitest'
import {
  dateBoundsFrom,
  validationWindowError,
} from './retrain-validation-window'

describe('dateBoundsFrom', () => {
  it('takes the calendar day of the naive metadata timestamps', () => {
    expect(
      dateBoundsFrom('2026-01-01 00:00:00', '2026-05-31 23:00:00'),
    ).toEqual({ min: '2026-01-01', max: '2026-05-31' })
  })

  it('accepts an ISO T-separated timestamp too', () => {
    expect(
      dateBoundsFrom('2026-01-01T00:00:00', '2026-02-01T00:00:00'),
    ).toEqual({ min: '2026-01-01', max: '2026-02-01' })
  })

  it('is null when either end is missing — the inputs stay unbounded', () => {
    expect(dateBoundsFrom(null, '2026-05-31 00:00:00')).toBeNull()
    expect(dateBoundsFrom('2026-01-01 00:00:00', undefined)).toBeNull()
    expect(dateBoundsFrom('not a date', '2026-05-31 00:00:00')).toBeNull()
  })
})

describe('validationWindowError', () => {
  const bounds = { min: '2026-01-01', max: '2026-05-31' }

  it('accepts a range inside the data, including both edge days', () => {
    expect(validationWindowError('2026-01-01', '2026-05-31', bounds)).toBeNull()
    expect(validationWindowError('2026-03-01', '2026-03-15', bounds)).toBeNull()
  })

  it('refuses an end after the last day of data', () => {
    expect(validationWindowError('2026-05-01', '2026-06-01', bounds)).toMatch(
      /after the last day of data \(2026-05-31\)/,
    )
  })

  it('refuses a start before the first day of data', () => {
    expect(validationWindowError('2025-12-31', '2026-02-01', bounds)).toMatch(
      /before the first day of data \(2026-01-01\)/,
    )
  })

  it('refuses a start after the last day of data', () => {
    expect(validationWindowError('2026-06-02', '', bounds)).toMatch(
      /Start can't be after the last day/,
    )
  })

  it('refuses an inverted range, with or without bounds', () => {
    expect(validationWindowError('2026-04-01', '2026-03-01', bounds)).toMatch(
      /on or before the end/,
    )
    expect(validationWindowError('2026-04-01', '2026-03-01', null)).toMatch(
      /on or before the end/,
    )
  })

  it('does not flag a half-typed range', () => {
    expect(validationWindowError('2026-03-01', '', bounds)).toBeNull()
    expect(validationWindowError('', '', bounds)).toBeNull()
  })
})
