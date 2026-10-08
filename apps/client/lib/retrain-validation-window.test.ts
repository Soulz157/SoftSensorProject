import { describe, expect, it } from 'vitest'
import {
  clampStamp,
  dateToDay,
  dayToDate,
  formatStamp,
  isEmptyRange,
  stampToIso,
  timeBoundsFrom,
  toStamp,
  validationWindowError,
} from './retrain-validation-window'

describe('dayToDate / dateToDay', () => {
  it('round-trips a day through a local-midnight Date without shifting it', () => {
    for (const day of ['2025-11-06', '2026-01-01', '2026-12-31']) {
      const date = dayToDate(day)
      expect(date).not.toBeNull()
      expect(date?.getHours()).toBe(0)
      expect(dateToDay(date as Date)).toBe(day)
    }
  })

  it('is null for an empty or malformed day', () => {
    expect(dayToDate('')).toBeNull()
    expect(dayToDate('2026-13-45')).toBeNull()
    expect(dayToDate('not a day')).toBeNull()
  })
})

describe('toStamp', () => {
  it('keeps the time of day from a naive or T-separated timestamp', () => {
    expect(toStamp('2025-11-17 14:00:00', 'up')).toBe('2025-11-17T14:00')
    expect(toStamp('2025-11-18T13:00:00', 'down')).toBe('2025-11-18T13:00')
  })

  it('rounds a lower bound UP and an upper bound DOWN past stray seconds', () => {
    expect(toStamp('2025-11-17 14:00:30', 'up')).toBe('2025-11-17T14:01')
    expect(toStamp('2025-11-17 14:00:30', 'down')).toBe('2025-11-17T14:00')
    // Carries across a day and a year.
    expect(toStamp('2025-12-31 23:59:00.500000', 'up')).toBe('2026-01-01T00:00')
  })

  it('is null for a missing or unparseable timestamp', () => {
    expect(toStamp(null, 'up')).toBeNull()
    expect(toStamp('2025-11-17', 'up')).toBeNull()
    expect(toStamp('not a date', 'down')).toBeNull()
  })
})

describe('timeBoundsFrom', () => {
  it('bounds by the real first and last reading, not whole days', () => {
    expect(
      timeBoundsFrom('2025-11-17 14:00:00', '2025-11-18 13:00:00'),
    ).toEqual({ min: '2025-11-17T14:00', max: '2025-11-18T13:00' })
  })

  it('is null when either end is missing — the pickers stay unbounded', () => {
    expect(timeBoundsFrom(null, '2026-05-31 00:00:00')).toBeNull()
    expect(timeBoundsFrom('2026-01-01 00:00:00', undefined)).toBeNull()
  })
})

describe('clampStamp', () => {
  const bounds = { min: '2025-11-17T14:00', max: '2025-11-18T13:00' }

  // The reported refusal: [2025-11-17 00:00, 2025-11-18 23:59:59.999] was
  // outside [2025-11-17 14:00, 2025-11-18 13:00]. Picking the same two days
  // now lands on the first and last reading.
  it('pulls a whole-day pick onto the first and last reading', () => {
    expect(clampStamp('2025-11-17', '00:00', bounds)).toBe('2025-11-17T14:00')
    expect(clampStamp('2025-11-18', '23:59', bounds)).toBe('2025-11-18T13:00')
  })

  it('leaves a time inside the bounds alone', () => {
    expect(clampStamp('2025-11-17', '18:30', bounds)).toBe('2025-11-17T18:30')
  })
})

describe('stampToIso / formatStamp', () => {
  it('sends the naive wall clock with a Z, minute-exact', () => {
    expect(stampToIso('2025-11-18T13:00')).toBe('2025-11-18T13:00:00.000Z')
  })

  it('reads as a space-separated date and time', () => {
    expect(formatStamp('2025-11-17T14:00')).toBe('2025-11-17 14:00')
  })
})

describe('isEmptyRange', () => {
  it('is true only when the first allowed instant is after the last', () => {
    expect(
      isEmptyRange({ min: '2025-11-06T00:00', max: '2025-10-31T23:00' }),
    ).toBe(true)
    expect(
      isEmptyRange({ min: '2025-11-06T00:00', max: '2025-11-06T00:00' }),
    ).toBe(false)
  })

  it('is false with no bounds — an unbounded range is never empty', () => {
    expect(isEmptyRange(null)).toBe(false)
  })
})

describe('validationWindowError', () => {
  const bounds = { min: '2025-11-17T14:00', max: '2025-11-18T13:00' }

  it('accepts a range inside the data, including both edge readings', () => {
    expect(
      validationWindowError('2025-11-17T14:00', '2025-11-18T13:00', bounds),
    ).toBeNull()
  })

  it('refuses a start before the first reading, naming it with its time', () => {
    expect(
      validationWindowError('2025-11-17T00:00', '2025-11-18T13:00', bounds),
    ).toBe("Start can't be before 2025-11-17 14:00.")
  })

  it('refuses an end after the last reading', () => {
    expect(
      validationWindowError('2025-11-17T14:00', '2025-11-18T23:59', bounds),
    ).toMatch(/after the last reading \(2025-11-18 13:00\)/)
  })

  it('refuses an inverted range, with or without bounds', () => {
    expect(
      validationWindowError('2025-11-18T10:00', '2025-11-18T09:00', bounds),
    ).toMatch(/on or before the end/)
    expect(
      validationWindowError('2025-11-18T10:00', '2025-11-18T09:00', null),
    ).toMatch(/on or before the end/)
  })

  it('does not flag a half-chosen range', () => {
    expect(validationWindowError('2025-11-17T14:00', '', bounds)).toBeNull()
    expect(validationWindowError('', '', bounds)).toBeNull()
  })
})
