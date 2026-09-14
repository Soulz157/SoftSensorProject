import { describe, expect, it } from 'vitest'
import { formatDayMonth } from './chart-format'

describe('formatDayMonth', () => {
  // Naive strings (no Z / no offset) are the pipeline's own dialect — Bangkok
  // wall-clock with the zone already stripped (aveva_connect.py). Reading
  // calendar fields verbatim from the string makes these assertions
  // zone-invariant: correct regardless of the machine running the test.
  it('reads a naive "YYYY-MM-DD HH:mm:ss" string verbatim, zone-invariant', () => {
    expect(formatDayMonth('2026-09-11 03:00:00')).toBe('11 Sep')
  })

  it('reads a naive "YYYY-MM-DDTHH:mm:ss" string verbatim', () => {
    expect(formatDayMonth('2026-01-05T23:59:00')).toBe('5 Jan')
  })

  it('does not roll a near-midnight naive timestamp to the wrong day', () => {
    // This is the regression guard: routing this through `timeZone: 'UTC'`
    // (or any zone) would shift it and could flip the date. Reading the
    // string's own calendar fields cannot.
    expect(formatDayMonth('2026-09-12 01:00:00')).toBe('12 Sep')
  })

  it('reads a bare "YYYY-MM-DD" naive date', () => {
    expect(formatDayMonth('2026-12-31')).toBe('31 Dec')
  })

  // Offset-bearing strings (Z / +07:00) are true instants — read through the
  // Date object, in the runner's local zone. Pinned to UTC noon so the local
  // day cannot flip regardless of the machine's timezone offset (-12..+14).
  it('reads an offset-bearing ("Z") string as an instant', () => {
    expect(formatDayMonth('2026-06-15T12:00:00.000Z')).toBe('15 Jun')
  })

  it('reads an epoch number as an instant', () => {
    // 2026-03-10T12:00:00.000Z
    expect(formatDayMonth(1773144000000)).toBe('10 Mar')
  })

  it('reads a Date object as an instant', () => {
    expect(formatDayMonth(new Date('2026-07-04T12:00:00.000Z'))).toBe('4 Jul')
  })

  it('returns empty string for an unparseable value', () => {
    expect(formatDayMonth('not-a-date')).toBe('')
  })
})
