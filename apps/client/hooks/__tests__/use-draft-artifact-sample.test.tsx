import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useDraftArtifactSample } from '@/hooks/dataset/use-draft-artifact-sample'
import { datasetDraftService } from '@/services/dataset-draft'
import { previewRowLimit } from '@/lib/downsample'

/** DS-LAKE-034-T03 — the GOLD row page behind Step 6's analysis card. */

vi.mock('@/services/dataset-draft', () => ({
  datasetDraftService: { rows: vi.fn() },
}))

const rows = vi.mocked(datasetDraftService.rows)

function page(tag: string) {
  return {
    data: {
      totalRowCount: 900,
      offset: 0,
      tags: [tag],
      rows: [
        {
          timestamp: '2026-01-01 00:00:00',
          cells: { [tag]: { value: 1, status: 'Good' as const } },
        },
      ],
    },
  } as unknown as Awaited<ReturnType<typeof datasetDraftService.rows>>
}

afterEach(() => vi.clearAllMocks())

describe('useDraftArtifactSample', () => {
  it('pages the named artifact, sized from its column count', async () => {
    rows.mockResolvedValue(page('G1'))
    const { result } = renderHook(() =>
      useDraftArtifactSample('d1', 'gold-1', 400),
    )
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.sample.tags).toEqual(['G1']))
    expect(result.current.totalRowCount).toBe(900)
    expect(rows).toHaveBeenCalledWith('d1', 'gold-1', {
      offset: 0,
      limit: previewRowLimit(400),
    })
  })

  it('never shows the old page under a rotated artifact', async () => {
    rows.mockResolvedValueOnce(page('OLD'))
    const { result, rerender } = renderHook(
      ({ id }) => useDraftArtifactSample('d1', id, 10),
      { initialProps: { id: 'gold-1' } },
    )
    await waitFor(() => expect(result.current.sample.tags).toEqual(['OLD']))
    rows.mockReturnValueOnce(new Promise(() => {}))
    rerender({ id: 'gold-2' })
    expect(result.current.sample.tags).toEqual([])
    expect(result.current.loading).toBe(true)
  })

  it('stays empty and idle without an artifact', () => {
    const { result } = renderHook(() => useDraftArtifactSample('d1', null, 10))
    expect(result.current.loading).toBe(false)
    expect(result.current.sample.rows).toEqual([])
    expect(rows).not.toHaveBeenCalled()
  })

  it('reports a failed page as an error, not as data', async () => {
    rows.mockRejectedValue(new Error('gone'))
    const { result } = renderHook(() => useDraftArtifactSample('d1', 'g', 10))
    await waitFor(() => expect(result.current.error).toBe('gone'))
    expect(result.current.sample.rows).toEqual([])
  })
})
