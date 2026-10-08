import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { TuningGridResponse } from '@/services/tuning-grid'

vi.mock('@/services/tuning-grid', () => ({
  tuningGridService: { get: vi.fn() },
}))
import { tuningGridService } from '@/services/tuning-grid'
import { useTuningGrid } from '../use-tuning-grid'

/**
 * MODEL-FLOW-025-T07. `useTuningGrid` existed unused from MODEL-FLOW-022-T03b
 * until the Step 3 variant preview became its first caller, and every test of
 * that preview mocks it — so the hook's own lifecycle had no test. The shared
 * request cache is module-level, so each case uses a size nothing else does.
 */
function response(algorithm: string, rows: number): TuningGridResponse {
  return {
    algorithm,
    variants: [{ alpha: rows }],
    maxVariantsPerJob: 4,
    tier: 'medium',
    sized: false,
  }
}

beforeEach(() => {
  vi.mocked(tuningGridService.get).mockReset()
})

describe('useTuningGrid (MODEL-FLOW-025-T07)', () => {
  it('fetches nothing and stays empty while the algorithm is null', () => {
    const { result } = renderHook(() => useTuningGrid(null, { rows: 101 }))
    expect(tuningGridService.get).not.toHaveBeenCalled()
    expect(result.current).toEqual({ grid: null, loading: false, error: null })
  })

  it('fetches the algorithm at the given size and exposes the grid', async () => {
    vi.mocked(tuningGridService.get).mockResolvedValue(response('ridge', 102))
    const size = { rows: 102 }
    const { result } = renderHook(() => useTuningGrid('ridge', size))

    await waitFor(() => expect(result.current.grid).not.toBeNull())
    expect(tuningGridService.get).toHaveBeenCalledWith('ridge', size)
    expect(result.current.grid?.variants).toEqual([{ alpha: 102 }])
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('reports an error and no grid when the request fails', async () => {
    vi.mocked(tuningGridService.get).mockRejectedValue(new Error('down'))
    const { result } = renderHook(() => useTuningGrid('ridge', { rows: 103 }))

    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.grid).toBeNull()
    expect(result.current.loading).toBe(false)
  })

  it('refetches when the size changes, and serves a repeat size from cache', async () => {
    vi.mocked(tuningGridService.get).mockImplementation((a, size) =>
      Promise.resolve(response(a, size?.rows ?? 0)),
    )
    const { result, rerender } = renderHook(
      ({ rows }) => useTuningGrid('ridge', { rows }),
      { initialProps: { rows: 104 } },
    )
    await waitFor(() =>
      expect(result.current.grid?.variants).toEqual([{ alpha: 104 }]),
    )

    rerender({ rows: 105 })
    await waitFor(() =>
      expect(result.current.grid?.variants).toEqual([{ alpha: 105 }]),
    )
    expect(tuningGridService.get).toHaveBeenCalledTimes(2)

    rerender({ rows: 104 })
    await waitFor(() =>
      expect(result.current.grid?.variants).toEqual([{ alpha: 104 }]),
    )
    expect(tuningGridService.get).toHaveBeenCalledTimes(2)
  })

  it('clears the grid when switched off', async () => {
    vi.mocked(tuningGridService.get).mockResolvedValue(response('ridge', 106))
    const { result, rerender } = renderHook(
      ({ algorithm }: { algorithm: string | null }) =>
        useTuningGrid(algorithm, { rows: 106 }),
      { initialProps: { algorithm: 'ridge' as string | null } },
    )
    await waitFor(() => expect(result.current.grid).not.toBeNull())

    rerender({ algorithm: null })
    await waitFor(() => expect(result.current.grid).toBeNull())
  })
})
