import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useRunGridSearch } from '@/hooks/model/use-run-grid-search'

// Reached through a plain wrapper, like the sibling hook tests. The hook's
// failure path (a read that throws -> null) has no case here: any throwing
// mock failed the test under vitest 4.1.7 even though the hook state was
// correct (null, not loading); cause not found.
const get = vi.fn()

vi.mock('@/services/model-draft', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/model-draft')>()
  return {
    ...actual,
    modelDraftRunService: {
      ...actual.modelDraftRunService,
      get: (...a: unknown[]) => get(...a),
    },
  }
})

const SEARCH = { algorithm: 'ridge', n_combinations: 2 }

beforeEach(() => get.mockReset())

describe('useRunGridSearch (MODEL-FLOW-038)', () => {
  it('reads the run once and returns its grid search', async () => {
    get.mockResolvedValue({ data: { gridSearch: SEARCH } })
    const { result } = renderHook(() => useRunGridSearch('draft-1', 'run-1'))
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.gridSearch).toEqual(SEARCH)
    expect(get).toHaveBeenCalledTimes(1)
    expect(get).toHaveBeenCalledWith('draft-1', 'run-1')
  })

  it('returns null when the run recorded no grid search', async () => {
    get.mockResolvedValue({ data: { gridSearch: null } })
    const { result } = renderHook(() => useRunGridSearch('draft-1', 'run-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.gridSearch).toBeNull()
  })

  it('fetches nothing without a draft or a run', () => {
    const { result } = renderHook(() => useRunGridSearch(null, 'run-1'))
    expect(result.current).toEqual({ gridSearch: null, loading: false })
    renderHook(() => useRunGridSearch('draft-1', null))
    expect(get).not.toHaveBeenCalled()
  })

  it('refetches for a different run and never shows the previous run’s search', async () => {
    get.mockResolvedValueOnce({ data: { gridSearch: SEARCH } })
    const { result, rerender } = renderHook(
      ({ id }) => useRunGridSearch('draft-1', id),
      { initialProps: { id: 'run-1' } },
    )
    await waitFor(() => expect(result.current.gridSearch).toEqual(SEARCH))

    get.mockResolvedValueOnce({ data: { gridSearch: null } })
    rerender({ id: 'run-2' })
    expect(result.current).toEqual({ gridSearch: null, loading: true })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(get).toHaveBeenLastCalledWith('draft-1', 'run-2')
  })
})
