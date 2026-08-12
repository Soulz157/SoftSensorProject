import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import type { ReactNode } from 'react'
import { useDatasetGoldWarm } from '../use-dataset-gold-warm'
import { datasetDraftService } from '@/services/dataset-draft'
import {
  dwDraftIdAtom,
  dwDraftArtifactIdAtom,
  dwDraftGoldArtifactIdAtom,
} from '@/store/dataset-studio'

vi.mock('@/services/dataset-draft', () => ({
  datasetDraftService: {
    createFeatures: vi.fn(),
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
  const rendered = renderHook(() => useDatasetGoldWarm(), { wrapper })
  return { ...rendered, store }
}

describe('useDatasetGoldWarm (DS-LAKE-006-T06)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('no-ops when there is no draft or source artifact yet — nothing to derive GOLD from', () => {
    const { result } = renderWithStore(null, null)

    act(() => {
      result.current([], null, {})
    })
    vi.runAllTimers()

    expect(datasetDraftService.createFeatures).not.toHaveBeenCalled()
  })

  it('debounces a burst of recipe edits into one call for the LATEST recipe', async () => {
    vi.mocked(datasetDraftService.createFeatures).mockResolvedValue({
      data: { id: 'gold-1' },
    } as never)
    const { result, store } = renderWithStore()

    act(() => {
      result.current([{ id: 'f1', kind: 'lag', tag: 'TI-101', k: 1 }], null, {})
      result.current([{ id: 'f1', kind: 'lag', tag: 'TI-101', k: 2 }], null, {})
      result.current(
        [{ id: 'f1', kind: 'lag', tag: 'TI-101', k: 2 }],
        ['TI-101'],
        { 'TI-101': 'minmax' },
      )
    })

    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(datasetDraftService.createFeatures).toHaveBeenCalledTimes(1)
    expect(datasetDraftService.createFeatures).toHaveBeenCalledWith(
      'draft-1',
      'silver-1',
      {
        features: [{ id: 'f1', kind: 'lag', tag: 'TI-101', k: 2 }],
        selectedColumns: ['TI-101'],
        scalers: { 'TI-101': 'minmax' },
      },
    )
    expect(store.get(dwDraftGoldArtifactIdAtom)).toBe('gold-1')
  })

  it('swallows a failure silently — no throw, atom stays untouched', async () => {
    vi.mocked(datasetDraftService.createFeatures).mockRejectedValue(
      new Error('features endpoint unreachable'),
    )
    const { result, store } = renderWithStore()

    act(() => {
      result.current([], null, {})
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(store.get(dwDraftGoldArtifactIdAtom)).toBeNull()
  })
})
