import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import type { ReactNode } from 'react'
import { useDatasetBronzeWarm } from '../use-dataset-bronze-warm'
import { datasetDraftService } from '@/services/dataset-draft'
import {
  dwWorkspaceIdAtom,
  dwSelectedSourcesAtom,
  dwCustomDateRangeAtom,
  dwDraftIdAtom,
  dwDraftArtifactIdAtom,
  dwDraftSyncStateAtom,
} from '@/store/dataset-studio'
import type { SavedDataSource } from '@/lib/mock-data-sources'

vi.mock('@/services/dataset-draft', () => ({
  datasetDraftService: {
    create: vi.fn(),
    materialize: vi.fn(),
  },
}))

const SOURCE: SavedDataSource = {
  id: 'src-1',
  name: 'PI Prod',
  type: 'aveva',
  host: 'pi.example.com',
  username: 'svc',
  dbName: 'PIServer',
  status: 'connected',
} as SavedDataSource

function renderWithStore() {
  const store = createStore()
  store.set(dwWorkspaceIdAtom, 'ws-1')
  store.set(dwSelectedSourcesAtom, [SOURCE])
  store.set(dwCustomDateRangeAtom, {
    from: '2026-01-01T00:00',
    to: '2026-01-02T00:00',
  })
  const wrapper = ({ children }: { children: ReactNode }) =>
    Provider({ store, children })
  const rendered = renderHook(() => useDatasetBronzeWarm(), { wrapper })
  return { ...rendered, store }
}

describe('useDatasetBronzeWarm (DS-LAKE-005B-B-T01)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a draft and materializes bronze for the given tags on success', async () => {
    vi.mocked(datasetDraftService.create).mockResolvedValue({
      data: { id: 'draft-1' },
    } as never)
    vi.mocked(datasetDraftService.materialize).mockResolvedValue({
      data: { id: 'artifact-1' },
    } as never)

    const { result, store } = renderWithStore()

    act(() => {
      result.current(['TI-101', 'TI-102'])
    })

    await waitFor(() =>
      expect(store.get(dwDraftArtifactIdAtom)).toBe('artifact-1'),
    )
    expect(store.get(dwDraftIdAtom)).toBe('draft-1')
    expect(datasetDraftService.materialize).toHaveBeenCalledWith(
      'draft-1',
      expect.objectContaining({
        sourceId: 'src-1',
        tags: ['TI-101', 'TI-102'],
      }),
    )
    // The one guarantee this hook exists for: it must NOT touch the atom
    // Step 3.2 renders as a "Server sync..." banner. A background warm
    // succeeding must be invisible.
    expect(store.get(dwDraftSyncStateAtom)).toEqual({ status: 'idle' })
  })

  it('swallows a materialize failure silently — no throw, no sync-state banner', async () => {
    vi.mocked(datasetDraftService.create).mockResolvedValue({
      data: { id: 'draft-1' },
    } as never)
    vi.mocked(datasetDraftService.materialize).mockRejectedValue(
      new Error('source unreachable'),
    )

    const { result, store } = renderWithStore()

    await act(async () => {
      result.current(['TI-101'])
      // Flush the fire-and-forget async IIFE inside the hook.
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(store.get(dwDraftArtifactIdAtom)).toBeNull()
    expect(store.get(dwDraftSyncStateAtom)).toEqual({ status: 'idle' })
  })

  it('reuses an already-warmed artifact rather than re-materializing', async () => {
    vi.mocked(datasetDraftService.create).mockResolvedValue({
      data: { id: 'draft-1' },
    } as never)
    vi.mocked(datasetDraftService.materialize).mockResolvedValue({
      data: { id: 'artifact-1' },
    } as never)

    const { result, store } = renderWithStore()

    act(() => {
      result.current(['TI-101'])
    })
    await waitFor(() =>
      expect(store.get(dwDraftArtifactIdAtom)).toBe('artifact-1'),
    )

    act(() => {
      result.current(['TI-101'])
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(datasetDraftService.create).toHaveBeenCalledTimes(1)
    expect(datasetDraftService.materialize).toHaveBeenCalledTimes(1)
  })
})
