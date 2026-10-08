import { describe, it, expect } from 'vitest'
import {
  describePreviewWindow,
  monthOptions,
  monthWindow,
  timeQuery,
  toWallClock,
  windowKey,
  windowLabel,
  windowMonthKey,
  windowParams,
} from '@/lib/time-window'

describe('toWallClock', () => {
  it('restates a UTC instant on the artifact wall clock (Bangkok, +7)', () => {
    expect(toWallClock('2025-12-31T17:00:00.000Z')).toBe('2026-01-01 00:00:00')
    expect(toWallClock('2026-01-01T00:00:00+07:00')).toBe('2026-01-01 00:00:00')
  })

  it('passes a naive wall-clock string, and empty values, through untouched', () => {
    expect(toWallClock('2025-09-01 00:00:00')).toBe('2025-09-01 00:00:00')
    expect(toWallClock('2025-09-01T00:00:00')).toBe('2025-09-01T00:00:00')
    expect(toWallClock(null)).toBeNull()
    expect(toWallClock(undefined)).toBeUndefined()
  })

  it('leaves an unparseable value alone rather than inventing a date', () => {
    expect(toWallClock('not a dateZ')).toBe('not a dateZ')
  })

  it('is what keeps the validation picker from offering an empty first month', () => {
    // The real holdout: stored 2025-12-31 17:00 UTC, data starts 2026-01-01.
    const raw = monthOptions('2025-12-31T17:00:00.000Z', '2026-01-31 22:00:00')
    const fixed = monthOptions(
      toWallClock('2025-12-31T17:00:00.000Z'),
      '2026-01-31 22:00:00',
    )
    expect(raw.map(o => o.key)).toEqual(['2025-12', '2026-01'])
    expect(fixed.map(o => o.key)).toEqual(['2026-01'])
  })
})

describe('windowLabel', () => {
  it('names the month, or nothing without a window', () => {
    expect(windowLabel(monthWindow(2026, 3))).toBe('Mar 2026')
    expect(windowLabel(null)).toBe('')
  })
})

describe('describePreviewWindow', () => {
  const march = monthWindow(2026, 3)

  it('says everything is loaded when the page covers the whole match', () => {
    expect(
      describePreviewWindow({
        loadedRows: 2150,
        totalRows: 2150,
        window: null,
      }),
    ).toBe('All 2,150 rows in the artifact.')
    expect(
      describePreviewWindow({ loadedRows: 720, totalRows: 720, window: march }),
    ).toBe('All 720 rows in Mar 2026.')
  })

  it('says so when the page is only the head of a longer series', () => {
    expect(
      describePreviewWindow({
        loadedRows: 10_000,
        totalRows: 43_200,
        window: null,
      }),
    ).toBe(
      'First 10,000 of 43,200 rows in the artifact — pick a month to see a later period.',
    )
    expect(
      describePreviewWindow({
        loadedRows: 10_000,
        totalRows: 43_200,
        window: march,
      }),
    ).toBe(
      'First 10,000 of 43,200 rows in Mar 2026 — the rest of the month is not loaded.',
    )
  })

  it('falls back to the generic bounded-sample wording when the total is unknown', () => {
    expect(
      describePreviewWindow({ loadedRows: 500, totalRows: null, window: null }),
    ).toBe('500 rows loaded — a bounded sample, not the full artifact.')
    expect(
      describePreviewWindow({
        loadedRows: 500,
        totalRows: null,
        window: march,
      }),
    ).toBe('500 rows loaded for Mar 2026 — a bounded sample.')
  })
})

describe('timeQuery', () => {
  it('is empty without a window', () => {
    expect(timeQuery({})).toBe('')
  })

  it('URI-encodes the space and colons of a wall-clock string', () => {
    expect(timeQuery(monthWindow(2026, 3))).toBe(
      '&startTime=2026-03-01%2000%3A00%3A00' +
        '&endTime=2026-03-31%2023%3A59%3A59.999999',
    )
  })
})

describe('monthWindow', () => {
  it('spans the whole month with naive wall-clock bounds', () => {
    expect(monthWindow(2026, 3)).toEqual({
      startTime: '2026-03-01 00:00:00',
      endTime: '2026-03-31 23:59:59.999999',
    })
  })

  it('handles 30-day months and leap February', () => {
    expect(monthWindow(2026, 4).endTime).toBe('2026-04-30 23:59:59.999999')
    expect(monthWindow(2028, 2).endTime).toBe('2028-02-29 23:59:59.999999')
    expect(monthWindow(2026, 2).endTime).toBe('2026-02-28 23:59:59.999999')
  })

  it('never emits a timezone marker (pandas rejects tz-aware vs naive)', () => {
    const { startTime, endTime } = monthWindow(2026, 12)
    expect(startTime).not.toMatch(/Z|[+-]\d{2}:\d{2}$/)
    expect(endTime).not.toMatch(/Z|[+-]\d{2}:\d{2}$/)
  })
})

describe('monthOptions', () => {
  it('lists every month between the bounds, oldest first', () => {
    const opts = monthOptions('2026-01-15T08:00:00', '2026-03-02 10:00:00')
    expect(opts.map(o => o.key)).toEqual(['2026-01', '2026-02', '2026-03'])
    expect(opts[0]?.label).toBe('Jan 2026')
    expect(opts[0]?.window.startTime).toBe('2026-01-01 00:00:00')
  })

  it('crosses a year boundary', () => {
    const opts = monthOptions('2025-11-30 00:00:00', '2026-02-01 00:00:00')
    expect(opts.map(o => o.key)).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ])
  })

  it('gives one option when both bounds share a month', () => {
    expect(
      monthOptions('2026-05-01 00:00:00', '2026-05-31 23:00:00'),
    ).toHaveLength(1)
  })

  it('is empty for missing, unparseable or inverted bounds', () => {
    expect(monthOptions(null, '2026-01-01')).toEqual([])
    expect(monthOptions('2026-01-01', undefined)).toEqual([])
    expect(monthOptions('garbage', '2026-01-01')).toEqual([])
    expect(monthOptions('2026-13-01', '2026-14-01')).toEqual([])
    expect(monthOptions('2026-05-01', '2026-01-01')).toEqual([])
  })

  it('caps a runaway span', () => {
    expect(monthOptions('1900-01-01', '2100-12-31').length).toBeLessThanOrEqual(
      240,
    )
  })
})

describe('window helpers', () => {
  const w = monthWindow(2026, 3)

  it('windowKey is stable per content and empty for none', () => {
    expect(windowKey(w)).toBe(windowKey({ ...w }))
    expect(windowKey(null)).toBe('')
    expect(windowKey(undefined)).toBe('')
  })

  it('windowMonthKey gives the select value', () => {
    expect(windowMonthKey(w)).toBe('2026-03')
    expect(windowMonthKey(null)).toBe('')
  })

  it('windowParams spreads nothing without a window', () => {
    expect(windowParams(null)).toEqual({})
    expect(windowParams(w)).toEqual({
      startTime: w.startTime,
      endTime: w.endTime,
    })
  })
})
