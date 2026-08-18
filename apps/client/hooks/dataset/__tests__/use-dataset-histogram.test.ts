import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDatasetHistogram } from '../use-dataset-histogram'
import { datasetDraftService } from '@/services/dataset-draft'
import { clearChartRequestCache } from '@/lib/chart-request-cache'
import type { DraftHistogramResult } from '@/services/dataset-draft'

vi.mock('@/services/dataset-draft', () => ({
  datasetDraftService: {
    histogram: vi.fn(),
  },
}))

const RESULT: DraftHistogramResult = {
  source_key: 'ds-1/artifacts/a-1/data.parquet',
  domain_min: 0.643,
  domain_max: 110.64,
  tags: [
    {
      tag: 'TI-101',
      mean: 55,
      median: 54,
      mode: 50,
      std: 12,
      min: 0.643,
      max: 110.64,
      range: 109.997,
      count: 1500,
      kde: [{ x: 10, y: 2 }],
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

describe('useDatasetHistogram (DS-LAKE-005B-D-T01)', () => {
  it('disabled with no draftId/artifactId/tags — no fetch, idle state', async () => {
    const { result } = renderHook(() => useDatasetHistogram(null, null, []))
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(datasetDraftService.histogram).not.toHaveBeenCalled()
    expect(result.current).toEqual({
      histogram: null,
      loading: false,
      error: null,
    })
  })

  it('a resolved response lands in histogram, clears loading/error', async () => {
    vi.mocked(datasetDraftService.histogram).mockResolvedValue({
      data: RESULT,
    } as never)
    const { result } = renderHook(() =>
      useDatasetHistogram('draft-1', 'artifact-1', ['TI-101']),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })

    expect(datasetDraftService.histogram).toHaveBeenCalledWith(
      'draft-1',
      'artifact-1',
      { operations: [], tags: ['TI-101'] },
      expect.any(AbortSignal),
    )
    expect(result.current.histogram).toEqual(RESULT)
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('a rejected fetch lands in error, not histogram', async () => {
    vi.mocked(datasetDraftService.histogram).mockRejectedValue(
      new Error('The source returned no rows for the requested range.'),
    )
    const { result } = renderHook(() =>
      useDatasetHistogram('draft-1', 'artifact-1', ['TI-101']),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })

    expect(result.current.histogram).toBeNull()
    expect(result.current.error).toBe(
      'The source returned no rows for the requested range.',
    )
  })

  it('cache-key discipline: same tag CONTENT (fresh array identity) does not refetch; different content does', async () => {
    vi.mocked(datasetDraftService.histogram).mockResolvedValue({
      data: RESULT,
    } as never)
    const { rerender } = renderHook(
      ({ tags }: { tags: string[] }) =>
        useDatasetHistogram('draft-1', 'artifact-1', tags),
      { initialProps: { tags: ['TI-101'] } },
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(datasetDraftService.histogram).toHaveBeenCalledTimes(1)

    // A brand new array, same content — the hook's own tagsKey (join(','))
    // is what the cacheKey is built from, not array identity.
    rerender({ tags: ['TI-101'] })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(datasetDraftService.histogram).toHaveBeenCalledTimes(1)

    rerender({ tags: ['TI-101', 'TI-102'] })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(datasetDraftService.histogram).toHaveBeenCalledTimes(2)
  })
})
