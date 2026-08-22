import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import type { ReactNode } from 'react'
import { useDatasetFeaturePreviewSample } from '../use-dataset-feature-preview-sample'
import { datasetDraftService } from '@/services/dataset-draft'
import {
  dwDraftIdAtom,
  dwDraftArtifactIdAtom,
  dwFeaturePreviewSampleAtom,
  dwFeaturePreviewSampleStateAtom,
} from '@/store/dataset-studio'

vi.mock('@/services/dataset-draft', () => ({
  datasetDraftService: {
    rows: vi.fn(),
  },
}))

function renderWithStore(
  draftId: string | null = 'draft-1',
  artifactId: string | null = 'silver-1',
) {
  const store = createStore()
  store.set(dwDraftIdAtom, draftId)
  store.set(dwDraftArtifactIdAtom, artifactId)
  const wrapper = ({ children }: { children: ReactNode }) =>
    Provider({ store, children })
  const rendered = renderHook(() => useDatasetFeaturePreviewSample(), {
    wrapper,
  })
  return { ...rendered, store }
}

describe('useDatasetFeaturePreviewSample — dwFeaturePreviewSampleStateAtom (DS-LAKE-015-T02)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('goes idle -> loading -> ready on a successful fetch, even when the page is empty', async () => {
    vi.mocked(datasetDraftService.rows).mockResolvedValue({
      data: { tags: [], rows: [] },
    } as never)

    const { store } = renderWithStore()

    await waitFor(() =>
      expect(store.get(dwFeaturePreviewSampleStateAtom)).toBe('ready'),
    )
    expect(store.get(dwFeaturePreviewSampleAtom)).toEqual(
      expect.objectContaining({ tags: [], rows: [] }),
    )
  })

  it('goes loading -> error on a rejected fetch — the exact swallowed-failure window DS-LAKE-005B-D-T07 recorded as user-visible', async () => {
    vi.mocked(datasetDraftService.rows).mockRejectedValue(
      new Error('rows unavailable'),
    )

    const { store } = renderWithStore()

    await waitFor(() =>
      expect(store.get(dwFeaturePreviewSampleStateAtom)).toBe('error'),
    )
    // The swallow itself is unchanged — no throw escapes the hook, and the
    // sample atom stays at its initial empty value rather than crashing.
    expect(store.get(dwFeaturePreviewSampleAtom)).toEqual(
      expect.objectContaining({ tags: [], rows: [] }),
    )
  })

  it('stays idle when the draft/artifact do not exist yet — distinguishes "waiting on the artifact warm" from "loading"', () => {
    const { store } = renderWithStore(null, null)

    expect(store.get(dwFeaturePreviewSampleStateAtom)).toBe('idle')
    expect(datasetDraftService.rows).not.toHaveBeenCalled()
  })

  it('a stale in-flight response cannot resurrect a superseded state after the artifact id changes', async () => {
    let resolveFirst!: (
      v: Awaited<ReturnType<typeof datasetDraftService.rows>>,
    ) => void
    vi.mocked(datasetDraftService.rows).mockImplementationOnce(
      () => new Promise(res => (resolveFirst = res)),
    )
    vi.mocked(datasetDraftService.rows).mockResolvedValueOnce({
      data: { tags: ['TI-101'], rows: [] },
    } as never)

    const store = createStore()
    store.set(dwDraftIdAtom, 'draft-1')
    store.set(dwDraftArtifactIdAtom, 'artifact-1')
    const wrapper = ({ children }: { children: ReactNode }) =>
      Provider({ store, children })
    const { rerender } = renderHook(() => useDatasetFeaturePreviewSample(), {
      wrapper,
    })
    expect(store.get(dwFeaturePreviewSampleStateAtom)).toBe('loading')

    // Supersede before the first call resolves.
    store.set(dwDraftArtifactIdAtom, 'artifact-2')
    rerender()

    await waitFor(() =>
      expect(store.get(dwFeaturePreviewSampleStateAtom)).toBe('ready'),
    )
    // Now let the STALE first request resolve — it must not overwrite the
    // already-settled 'ready' state from the second, current request.
    resolveFirst({ data: { tags: [], rows: [] } } as never)
    await Promise.resolve()
    await Promise.resolve()
    expect(store.get(dwFeaturePreviewSampleStateAtom)).toBe('ready')
    expect(store.get(dwFeaturePreviewSampleAtom)).toEqual(
      expect.objectContaining({ tags: ['TI-101'] }),
    )
  })
})
