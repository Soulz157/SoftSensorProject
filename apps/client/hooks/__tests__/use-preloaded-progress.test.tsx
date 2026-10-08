import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  PRELOAD_DELAY_MS,
  usePreloadedProgress,
} from '@/hooks/dataset/use-preloaded-progress'
import { preloadProgress } from '@/lib/dataset-fetch'

/** DS-LAKE-033 — the Step 2 fetch bar runs ahead while a batch is in flight. */

describe('preloadProgress', () => {
  it('one batch runs ahead to 66, not 100', () => {
    expect(preloadProgress(0, 1)).toBe(66)
  })

  it('runs ahead by 66% of the batches in flight, at most four', () => {
    // 10 batches, 4 in flight: (0 + 4 * 0.66) / 10.
    expect(preloadProgress(0, 10)).toBe(26)
    // 8 done, 2 left in flight: (8 + 2 * 0.66) / 10.
    expect(preloadProgress(8, 10)).toBe(93)
  })

  it('never claims 100 before the last batch lands, and is 100 after', () => {
    expect(preloadProgress(199, 200)).toBeLessThanOrEqual(99)
    expect(preloadProgress(3, 3)).toBe(100)
  })

  it('is 0 with nothing to fetch', () => {
    expect(preloadProgress(0, 0)).toBe(0)
  })
})

describe('usePreloadedProgress', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const base = {
    active: true,
    progress: 0,
    completedBatches: 0,
    totalBatches: 1,
    runStartedAt: 1,
  }

  it('holds real progress until the delay, then runs ahead', () => {
    const { result } = renderHook(() => usePreloadedProgress(base))
    expect(result.current).toBe(0)
    act(() => vi.advanceTimersByTime(PRELOAD_DELAY_MS))
    expect(result.current).toBe(66)
  })

  it('never steps back when a batch lands below what was shown', () => {
    const { result, rerender } = renderHook(p => usePreloadedProgress(p), {
      initialProps: { ...base, totalBatches: 2 },
    })
    act(() => vi.advanceTimersByTime(PRELOAD_DELAY_MS))
    expect(result.current).toBe(66)
    rerender({ ...base, totalBatches: 2, progress: 50, completedBatches: 1 })
    expect(result.current).toBe(66)
    act(() => vi.advanceTimersByTime(PRELOAD_DELAY_MS))
    expect(result.current).toBe(83)
  })

  it('returns real progress once the run is no longer active', () => {
    const { result, rerender } = renderHook(p => usePreloadedProgress(p), {
      initialProps: base,
    })
    act(() => vi.advanceTimersByTime(PRELOAD_DELAY_MS))
    rerender({ ...base, active: false, progress: 100, completedBatches: 1 })
    expect(result.current).toBe(100)
    rerender({ ...base, active: false, progress: 0 })
    expect(result.current).toBe(0)
  })

  it('a new run starts from 0, not the last run’s preload', () => {
    const { result, rerender } = renderHook(p => usePreloadedProgress(p), {
      initialProps: base,
    })
    act(() => vi.advanceTimersByTime(PRELOAD_DELAY_MS))
    expect(result.current).toBe(66)
    rerender({ ...base, runStartedAt: 2 })
    expect(result.current).toBe(0)
  })
})
