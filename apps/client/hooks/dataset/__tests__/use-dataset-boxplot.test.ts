import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDatasetBoxplot } from '../use-dataset-boxplot'
import { datasetDraftService } from '@/services/dataset-draft'
import { clearChartRequestCache } from '@/lib/chart-request-cache'
import type { DraftBoxplotResult } from '@/services/dataset-draft'

vi.mock('@/services/dataset-draft', () => ({
  datasetDraftService: {
    boxplot: vi.fn(),
  },
}))

const RESULT: DraftBoxplotResult = {
  source_key: 'ds-1/artifacts/a-1/data.parquet',
  tags: [
    {
      tag: 'TI-101',
      min: 0.643,
      q1: 20,
      median: 54,
      mean: 55,
      q3: 88,
      max: 110.64,
      whisker_low: 5,
      whisker_high: 105,
      outliers: [109.5],
      outlier_count: 1,
      count: 1500,
    },
  ],
  insufficient_tags: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  clearChartRequestCache() // module-level cache — must not leak between tests
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useDatasetBoxplot (DS-LAKE-005B-D-T03)', () => {
  it('disabled with no draftId/artifactId/tags — no fetch, idle state', async () => {
    const { result } = renderHook(() => useDatasetBoxplot(null, null, []))
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(datasetDraftService.boxplot).not.toHaveBeenCalled()
    expect(result.current).toEqual({
      boxplot: null,
      loading: false,
      error: null,
    })
  })

  it('a resolved response lands in boxplot, clears loading/error', async () => {
    vi.mocked(datasetDraftService.boxplot).mockResolvedValue({
      data: RESULT,
    } as never)
    const { result } = renderHook(() =>
      useDatasetBoxplot('draft-1', 'artifact-1', ['TI-101']),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })

    expect(datasetDraftService.boxplot).toHaveBeenCalledWith(
      'draft-1',
      'artifact-1',
      { operations: [], tags: ['TI-101'] },
      expect.any(AbortSignal),
    )
    expect(result.current.boxplot).toEqual(RESULT)
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('a rejected fetch lands in error, not boxplot', async () => {
    vi.mocked(datasetDraftService.boxplot).mockRejectedValue(
      new Error('The source returned no rows for the requested range.'),
    )
    const { result } = renderHook(() =>
      useDatasetBoxplot('draft-1', 'artifact-1', ['TI-101']),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })

    expect(result.current.boxplot).toBeNull()
    expect(result.current.error).toBe(
      'The source returned no rows for the requested range.',
    )
  })

  it('cache-key discipline: same tag CONTENT (fresh array identity) does not refetch; different content does', async () => {
    vi.mocked(datasetDraftService.boxplot).mockResolvedValue({
      data: RESULT,
    } as never)
    const { rerender } = renderHook(
      ({ tags }: { tags: string[] }) =>
        useDatasetBoxplot('draft-1', 'artifact-1', tags),
      { initialProps: { tags: ['TI-101'] } },
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(datasetDraftService.boxplot).toHaveBeenCalledTimes(1)

    rerender({ tags: ['TI-101'] })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(datasetDraftService.boxplot).toHaveBeenCalledTimes(1)

    rerender({ tags: ['TI-101', 'TI-102'] })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(datasetDraftService.boxplot).toHaveBeenCalledTimes(2)
  })

  it('outlierCap is forwarded only when the caller sets it — undefined lets the server default apply', async () => {
    vi.mocked(datasetDraftService.boxplot).mockResolvedValue({
      data: RESULT,
    } as never)

    const { rerender } = renderHook(
      ({ cap }: { cap?: number }) =>
        useDatasetBoxplot('draft-1', 'artifact-1', ['TI-101'], [], cap),
      { initialProps: { cap: undefined } as { cap?: number } },
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(datasetDraftService.boxplot).toHaveBeenLastCalledWith(
      'draft-1',
      'artifact-1',
      { operations: [], tags: ['TI-101'] },
      expect.any(AbortSignal),
    )

    rerender({ cap: 5 })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(datasetDraftService.boxplot).toHaveBeenLastCalledWith(
      'draft-1',
      'artifact-1',
      { operations: [], tags: ['TI-101'], outlierCap: 5 },
      expect.any(AbortSignal),
    )
  })
})
