import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearChartRequestCache,
  getCached,
  setCached,
} from '@/lib/chart-request-cache'

afterEach(() => {
  clearChartRequestCache()
  vi.useRealTimers()
})

describe('chart-request-cache', () => {
  it('returns undefined for a key that was never set', () => {
    expect(getCached('nope')).toBeUndefined()
  })

  it('returns what was set', () => {
    setCached('k', { hello: 'world' })
    expect(getCached('k')).toEqual({ hello: 'world' })
  })

  it('expires after the TTL elapses', () => {
    vi.useFakeTimers()
    setCached('k', 42, 1_000)
    vi.advanceTimersByTime(999)
    expect(getCached('k')).toBe(42)
    vi.advanceTimersByTime(2)
    expect(getCached('k')).toBeUndefined()
  })

  it('an expired read deletes the entry (does not linger)', () => {
    vi.useFakeTimers()
    setCached('k', 'v', 100)
    vi.advanceTimersByTime(200)
    expect(getCached('k')).toBeUndefined()
    // A second read after the delete must stay a clean miss, not throw.
    expect(getCached('k')).toBeUndefined()
  })

  it('distinct keys do not collide — the cap/tags-in-key discipline this cache exists to enforce', () => {
    setCached('histogram|draft-1|artifact-1|TI-101|[]|12|100', 'A')
    setCached('histogram|draft-1|artifact-1|TI-101|[]|6|25', 'B')
    expect(getCached('histogram|draft-1|artifact-1|TI-101|[]|12|100')).toBe('A')
    expect(getCached('histogram|draft-1|artifact-1|TI-101|[]|6|25')).toBe('B')
  })

  it('clearChartRequestCache empties everything', () => {
    setCached('a', 1)
    setCached('b', 2)
    clearChartRequestCache()
    expect(getCached('a')).toBeUndefined()
    expect(getCached('b')).toBeUndefined()
  })
})
