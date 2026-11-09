import { describe, expect, it } from 'vitest'
import { formatDayMonth, spansMultipleDays } from '@/lib/chart-format'

const rows = (...ts: string[]) => ts.map(timestamp => ({ timestamp }))

describe('spansMultipleDays', () => {
  it('is true for a months-long hourly dataset, so ticks read 9 Jan', () => {
    expect(
      spansMultipleDays(rows('2026-01-09 00:00:00', '2026-03-31 23:00:00')),
    ).toBe(true)
    expect(formatDayMonth('2026-01-09 00:00:00')).toBe('9 Jan')
  })

  it('is false within a day and a half, where clock times are the useful label', () => {
    expect(
      spansMultipleDays(rows('2026-01-09 00:00:00', '2026-01-10 06:00:00')),
    ).toBe(false)
    expect(spansMultipleDays(rows('2026-01-09 00:00:00'))).toBe(false)
    expect(spansMultipleDays([])).toBe(false)
  })

  it('reads ISO stamps too, and ignores unparseable ones', () => {
    expect(
      spansMultipleDays(rows('2026-01-09T00:00:00Z', '2026-01-12T00:00:00Z')),
    ).toBe(true)
    expect(spansMultipleDays(rows('x', 'y'))).toBe(false)
  })
})
