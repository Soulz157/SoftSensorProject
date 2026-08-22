import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDelayedFlag } from '../use-delayed-flag'

describe('useDelayedFlag', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('stays false immediately after activation', () => {
    const { result } = renderHook(() => useDelayedFlag(true, 150))
    expect(result.current).toBe(false)
  })

  it('flips true only after the delay elapses', () => {
    const { result } = renderHook(() => useDelayedFlag(true, 150))

    act(() => {
      vi.advanceTimersByTime(149)
    })
    expect(result.current).toBe(false)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current).toBe(true)
  })

  it('never flips true if deactivated before the delay elapses', () => {
    const { result, rerender } = renderHook(
      ({ active }) => useDelayedFlag(active, 150),
      { initialProps: { active: true } },
    )

    act(() => {
      vi.advanceTimersByTime(100)
    })
    rerender({ active: false })

    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(result.current).toBe(false)
  })

  it('resets to false the instant active goes false, even after having flipped true', () => {
    const { result, rerender } = renderHook(
      ({ active }) => useDelayedFlag(active, 150),
      { initialProps: { active: true } },
    )

    act(() => {
      vi.advanceTimersByTime(150)
    })
    expect(result.current).toBe(true)

    rerender({ active: false })
    expect(result.current).toBe(false)
  })

  it('starts a fresh delay if reactivated after deactivation', () => {
    const { result, rerender } = renderHook(
      ({ active }) => useDelayedFlag(active, 150),
      { initialProps: { active: true } },
    )

    rerender({ active: false })
    rerender({ active: true })

    act(() => {
      vi.advanceTimersByTime(149)
    })
    expect(result.current).toBe(false)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current).toBe(true)
  })
})
