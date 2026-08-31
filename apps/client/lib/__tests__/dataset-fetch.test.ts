import { describe, expect, it } from 'vitest'
import { formatElapsed } from '@/lib/dataset-fetch'

describe('formatElapsed', () => {
  it('zero-pads every field', () => {
    expect(formatElapsed(0)).toBe('00:00:00')
    expect(formatElapsed(83_000)).toBe('00:01:23')
    expect(formatElapsed(3_661_000)).toBe('01:01:01')
  })

  it('truncates sub-second remainders instead of rounding up', () => {
    expect(formatElapsed(1_999)).toBe('00:00:01')
  })

  it('does not wrap hours at 24 — a long pull must read as 30h, not 6h', () => {
    expect(formatElapsed(30 * 3_600_000)).toBe('30:00:00')
  })

  it('clamps unusable input rather than rendering NaN', () => {
    expect(formatElapsed(-5_000)).toBe('00:00:00')
    expect(formatElapsed(Number.NaN)).toBe('00:00:00')
    expect(formatElapsed(Number.POSITIVE_INFINITY)).toBe('00:00:00')
  })
})
