import { describe, expect, it } from 'vitest'
import {
  MONTHLY_BUCKET_LIMIT,
  sequentialRampColor,
  timeBuckets,
} from './scatter-time'

/** DS-LAKE-034-T02 / V02 — colouring the scatter cloud by time. */

describe('timeBuckets', () => {
  it('buckets a 6-month span by month, oldest first', () => {
    const scale = timeBuckets(['2026-01-05 00:00:00', '2026-06-20 12:00:00'])!
    expect(scale.unit).toBe('month')
    expect(scale.buckets.map(b => b.key)).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
    ])
    expect(scale.buckets[0]!.label).toBe('Jan 2026')
  })

  it('keeps empty months in the scale so a colour always means the same time', () => {
    const scale = timeBuckets(['2026-01-01', '2026-04-01'])!
    expect(scale.buckets).toHaveLength(4)
  })

  it(`stays monthly at exactly ${MONTHLY_BUCKET_LIMIT} months`, () => {
    expect(timeBuckets(['2025-01-01', '2025-12-31'])!.unit).toBe('month')
  })

  it('switches to per-year once the span passes 12 months', () => {
    const scale = timeBuckets(['2024-11-01', '2026-02-01'])!
    expect(scale.unit).toBe('year')
    expect(scale.buckets.map(b => b.key)).toEqual(['2024', '2025', '2026'])
  })

  it('reads the wall-clock YYYY-MM as sent, never shifting a month', () => {
    const scale = timeBuckets(['2026-01-31 23:30:00', '2026-07-01 00:00:00'])!
    expect(scale.keyOf('2026-01-31 23:30:00')).toBe('2026-01')
    const yearly = timeBuckets(['2024-01-01', '2026-01-01'])!
    expect(yearly.keyOf('2025-12-31 23:59:59')).toBe('2025')
  })

  it('is null without stamps, so the chart keeps one colour', () => {
    expect(timeBuckets([undefined, undefined])).toBeNull()
    expect(timeBuckets([])).toBeNull()
  })

  it('gives every bucket a distinct colour on the ramp', () => {
    const scale = timeBuckets(['2026-01-01', '2026-12-01'])!
    expect(new Set(scale.buckets.map(b => b.color)).size).toBe(12)
  })
})

describe('sequentialRampColor', () => {
  it('runs from teal to purple, never red or amber', () => {
    expect(sequentialRampColor(0, 5)).toContain('var(--chart-4) 100%')
    expect(sequentialRampColor(4, 5)).toContain('var(--chart-4) 0%')
    expect(sequentialRampColor(0, 1)).toBe('var(--chart-4)')
  })
})
