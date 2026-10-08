import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import type { ReactNode } from 'react'
import { useDatasetFeaturePreviewSample } from '../use-dataset-feature-preview-sample'
import { datasetDraftService } from '@/services/dataset-draft'
import { monthWindow } from '@/lib/time-window'
import {
  dwDraftIdAtom,
  dwDraftArtifactIdAtom,
  dwEdaSampleTotalAtom,
  dwEdaWindowAtom,
  dwFeaturePreviewSampleAtom,
  dwFeaturePreviewSampleStateAtom,
  dwSelectedTagsAtom,
} from '@/store/dataset-studio'

vi.mock('@/services/dataset-draft', () => ({
  datasetDraftService: {
    rows: vi.fn(),
  },
}))

function renderWithStore(
  draftId: string | null = 'draft-1',
  artifactId: string | null = 'silver-1',
  seed?: (store: ReturnType<typeof createStore>) => void,
) {
  const store = createStore()
  store.set(dwDraftIdAtom, draftId)
  store.set(dwDraftArtifactIdAtom, artifactId)
  seed?.(store)
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

describe('useDatasetFeaturePreviewSample — EDA period and row limit', () => {
  const page = (totalRowCount: number) =>
    ({ data: { tags: ['TI-101'], rows: [], totalRowCount } }) as never
  const firstParams = () =>
    vi.mocked(datasetDraftService.rows).mock.calls[0]?.[2]

  beforeEach(() => {
    vi.mocked(datasetDraftService.rows).mockReset()
  })

  it('asks for up to 10,000 rows, sends no window while none is chosen, and keeps the server total', async () => {
    vi.mocked(datasetDraftService.rows).mockResolvedValue(page(2_150))

    const { store } = renderWithStore('draft-1', 'silver-1', s =>
      s.set(dwSelectedTagsAtom, ['TI-101', 'TI-102']),
    )
    await waitFor(() =>
      expect(store.get(dwFeaturePreviewSampleStateAtom)).toBe('ready'),
    )

    expect(firstParams()).toMatchObject({ offset: 0, limit: 10_000 })
    expect(firstParams()).not.toHaveProperty('startTime')
    expect(firstParams()).not.toHaveProperty('endTime')
    expect(store.get(dwEdaSampleTotalAtom)).toBe(2_150)
  })

  it('sends the chosen window as startTime/endTime', async () => {
    vi.mocked(datasetDraftService.rows).mockResolvedValue(page(720))
    const march = monthWindow(2026, 3)

    const { store } = renderWithStore('draft-1', 'silver-1', s => {
      s.set(dwSelectedTagsAtom, ['TI-101'])
      s.set(dwEdaWindowAtom, march)
    })
    await waitFor(() =>
      expect(store.get(dwFeaturePreviewSampleStateAtom)).toBe('ready'),
    )

    expect(firstParams()).toMatchObject({
      startTime: '2026-03-01 00:00:00',
      endTime: '2026-03-31 23:59:59.999999',
    })
  })

  it('sizes the row limit to the FULL selected width, not the 50-tag cap — the draft leg returns every column', async () => {
    vi.mocked(datasetDraftService.rows).mockResolvedValue(page(50_000))
    // 200 selected tags: 250,000 cells / 200 = 1,250 rows. Sizing from the
    // capped 50 would have asked for 5,000 rows × 200 columns.
    const wide = Array.from({ length: 200 }, (_, i) => `TI-${i}`)

    const { store } = renderWithStore('draft-1', 'silver-1', s =>
      s.set(dwSelectedTagsAtom, wide),
    )
    await waitFor(() =>
      expect(store.get(dwFeaturePreviewSampleStateAtom)).toBe('ready'),
    )

    expect(firstParams()).toMatchObject({ limit: 1_250 })
  })

  it('an extremely wide selection falls back to the 1,000-row floor the preview always had', async () => {
    vi.mocked(datasetDraftService.rows).mockResolvedValue(page(50_000))
    const huge = Array.from({ length: 8_000 }, (_, i) => `TI-${i}`)

    const { store } = renderWithStore('draft-1', 'silver-1', s =>
      s.set(dwSelectedTagsAtom, huge),
    )
    await waitFor(() =>
      expect(store.get(dwFeaturePreviewSampleStateAtom)).toBe('ready'),
    )

    expect(firstParams()).toMatchObject({ limit: 1_000 })
  })

  it('a new window over a sample already on screen goes ready -> refreshing -> ready, never back to loading', async () => {
    // 'loading' would drop Step 3.1 to a skeleton and unmount the analysis
    // card (and the period picker in it) on every month change.
    let resolveSecond!: (v: never) => void
    vi.mocked(datasetDraftService.rows)
      .mockResolvedValueOnce(page(100))
      .mockImplementationOnce(() => new Promise(res => (resolveSecond = res)))

    const { store } = renderWithStore('draft-1', 'silver-1', s =>
      s.set(dwSelectedTagsAtom, ['TI-101']),
    )
    await waitFor(() =>
      expect(store.get(dwFeaturePreviewSampleStateAtom)).toBe('ready'),
    )

    act(() => {
      store.set(dwEdaWindowAtom, monthWindow(2026, 3))
    })
    await waitFor(() =>
      expect(store.get(dwFeaturePreviewSampleStateAtom)).toBe('refreshing'),
    )
    // The old sample stays until the new page lands.
    expect(store.get(dwEdaSampleTotalAtom)).toBe(100)

    await act(async () => {
      resolveSecond(page(31))
    })
    await waitFor(() =>
      expect(store.get(dwFeaturePreviewSampleStateAtom)).toBe('ready'),
    )
    expect(store.get(dwEdaSampleTotalAtom)).toBe(31)
    expect(datasetDraftService.rows).toHaveBeenCalledTimes(2)
  })
})
