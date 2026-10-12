import { createElement, type ReactNode } from 'react'
import { renderHook } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SavedDataSource } from '@/lib/mock-data-sources'
import {
  dwCurrentStepAtom,
  dwDraftIdAtom,
  dwFromRetrainAtom,
  dwModeAtom,
  dwNameAtom,
  dwSelectedSourcesAtom,
  dwSelectedTagsAtom,
  dwWorkspaceIdAtom,
} from '@/store/dataset-studio'
import {
  datasetResumeTargetAtom,
  datasetSnapshotDraftIdAtom,
} from '@/hooks/dataset/dataset-draft-resume-state'
import { useDatasetDraftSync } from '@/hooks/dataset/use-dataset-draft-sync'

const replace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(''),
}))

const service = vi.hoisted(() => ({
  create: vi.fn(),
  patch: vi.fn(),
}))
vi.mock('@/services/dataset-draft', () => ({ datasetDraftService: service }))

const PI = { id: 'pi-1', type: 'aveva' } as SavedDataSource
const CSV = { id: 'csv-1', type: 'csv' } as SavedDataSource

function setup(sources: SavedDataSource[], step: number) {
  const store = createStore()
  store.set(dwWorkspaceIdAtom, 'ws-1')
  store.set(dwNameAtom, 'Boiler')
  store.set(dwSelectedSourcesAtom, sources)
  store.set(dwSelectedTagsAtom, ['T1'])
  store.set(dwCurrentStepAtom, step)
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(Provider, { store }, children)
  renderHook(() => useDatasetDraftSync(), { wrapper })
  return store
}

const flush = () => vi.advanceTimersByTimeAsync(700)

describe('useDatasetDraftSync (DS-LAKE-037)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    replace.mockClear()
    service.create.mockReset().mockResolvedValue({ data: { id: 'draft-1' } })
    service.patch.mockReset().mockResolvedValue({ data: {} })
  })
  afterEach(() => vi.useRealTimers())

  it('does not create a draft while the user is still on Step 1', async () => {
    setup([PI], 1)
    await flush()
    expect(service.create).not.toHaveBeenCalled()
    expect(service.patch).not.toHaveBeenCalled()
  })

  it('a CSV-only session gets a snapshot draft but NEVER dwDraftIdAtom', async () => {
    const store = setup([CSV], 2)
    await flush()

    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({ sourceIds: ['csv-1'] }),
    )
    expect(store.get(datasetSnapshotDraftIdAtom)).toBe('draft-1')
    // Every "has a draft" branch downstream (Step 6 save path, gold warm,
    // validation) must see exactly what it saw before this feature.
    expect(store.get(dwDraftIdAtom)).toBeNull()
  })

  it('a PI session takes the pipeline slot, so the bronze warm reuses the same draft', async () => {
    const store = setup([PI], 2)
    await flush()

    expect(store.get(dwDraftIdAtom)).toBe('draft-1')
    expect(store.get(datasetSnapshotDraftIdAtom)).toBeNull()
    expect(service.create).toHaveBeenCalledTimes(1)
    const [, body] = service.patch.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ]
    expect(body.wizardStateVersion).toBe(1)
    expect(JSON.stringify(body.wizardState)).not.toMatch(/"rows"/)
    expect(replace).toHaveBeenCalledWith('/data-studio/create?draftId=draft-1')
  })

  it('writes nothing in edit mode or a retrain session', async () => {
    for (const apply of [
      (s: ReturnType<typeof createStore>) => s.set(dwModeAtom, 'edit'),
      (s: ReturnType<typeof createStore>) => s.set(dwFromRetrainAtom, true),
    ]) {
      service.create.mockClear()
      const store = createStore()
      store.set(dwWorkspaceIdAtom, 'ws-1')
      store.set(dwSelectedSourcesAtom, [PI])
      store.set(dwCurrentStepAtom, 3)
      apply(store)
      renderHook(() => useDatasetDraftSync(), {
        wrapper: ({ children }: { children: ReactNode }) =>
          createElement(Provider, { store }, children),
      })
      await flush()
      expect(service.create).not.toHaveBeenCalled()
      expect(service.patch).not.toHaveBeenCalled()
    }
  })

  it('while a resume is parked on Step 2 it saves the real destination, not Step 2', async () => {
    const store = createStore()
    store.set(dwWorkspaceIdAtom, 'ws-1')
    store.set(dwSelectedSourcesAtom, [PI])
    store.set(dwDraftIdAtom, 'draft-1')
    store.set(dwCurrentStepAtom, 2)
    store.set(datasetResumeTargetAtom, { step: 4, highestUnlocked: 5 })
    renderHook(() => useDatasetDraftSync(), {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(Provider, { store }, children),
    })
    await flush()

    const [, body] = service.patch.mock.calls[0] as [
      string,
      { wizardState: { currentStep: number; highestUnlocked: number } },
    ]
    expect(body.wizardState.currentStep).toBe(4)
    expect(body.wizardState.highestUnlocked).toBe(5)
  })
})
