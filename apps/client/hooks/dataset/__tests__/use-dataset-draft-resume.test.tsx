import { createElement, type ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SavedDataSource } from '@/lib/mock-data-sources'
import {
  WIZARD_SNAPSHOT_VERSION,
  buildWizardSnapshot,
  type WizardSnapshotValues,
} from '@/lib/dataset-wizard-snapshot'
import { readWizardSnapshotValues } from '@/hooks/dataset/dataset-wizard-snapshot-atoms'
import {
  dwCleanedTagsAtom,
  dwCleaningPipelinesAtom,
  dwCurrentStepAtom,
  dwDraftArtifactIdAtom,
  dwDraftIdAtom,
  dwFeatureArtifactStampAtom,
  dwHighestUnlockedAtom,
  dwRawDatasetAtom,
} from '@/store/dataset-studio'
import {
  datasetResumeTargetAtom,
  datasetSnapshotDraftIdAtom,
} from '@/hooks/dataset/dataset-draft-resume-state'
import { useDatasetDraftResume } from '@/hooks/dataset/use-dataset-draft-resume'

const replace = vi.fn()
let draftIdInUrl: string | null = 'draft-1'
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () =>
    new URLSearchParams(draftIdInUrl ? `draftId=${draftIdInUrl}` : ''),
}))

const get = vi.hoisted(() => vi.fn())
vi.mock('@/services/dataset-draft', () => ({ datasetDraftService: { get } }))

const toast = vi.hoisted(() => ({
  error: vi.fn(),
  warning: vi.fn(),
  success: vi.fn(),
}))
vi.mock('sonner', () => ({ toast }))

const sources = vi.hoisted(() => ({ list: [] as unknown[] }))
vi.mock('@/hooks/use-data-sources', () => ({
  useDataSources: () => ({ sources: sources.list, loading: false }),
}))

const PI = { id: 'pi-1', type: 'aveva', username: 'svc' } as SavedDataSource
const CSV = { id: 'csv-1', type: 'csv', username: '' } as SavedDataSource

function snapshot(patch: Partial<WizardSnapshotValues>) {
  const base = readWizardSnapshotValues(createStore())
  return buildWizardSnapshot({
    ...base,
    name: 'Boiler',
    workspaceId: 'ws-1',
    sourceIds: ['pi-1'],
    selectedTags: ['T1'],
    cleaningPipelines: { T1: {} as never },
    cleaningTags: ['T1'],
    cleanedTags: ['T1'],
    featureArtifactStamp: 'stamp-1',
    currentStep: 5,
    highestUnlocked: 6,
    ...patch,
  })
}

function draft(over: Record<string, unknown> = {}) {
  return {
    data: {
      id: 'draft-1',
      status: 'ABANDONED',
      isCreator: true,
      editingDatasetId: null,
      wizardStateVersion: WIZARD_SNAPSHOT_VERSION,
      wizardState: snapshot({}),
      ...over,
    },
  }
}

function mount() {
  const store = createStore()
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(Provider, { store }, children)
  renderHook(() => useDatasetDraftResume(), { wrapper })
  return store
}

describe('useDatasetDraftResume (DS-LAKE-037)', () => {
  beforeEach(() => {
    replace.mockClear()
    Object.values(toast).forEach(fn => fn.mockClear())
    get.mockReset()
    draftIdInUrl = 'draft-1'
    sources.list = [PI, CSV]
  })

  it('restores configuration for a PI draft, parks on Step 2, and drops artifact claims', async () => {
    get.mockResolvedValue(draft())
    const store = mount()

    await waitFor(() => expect(store.get(dwDraftIdAtom)).toBe('draft-1'))

    // Rows are not restored from anywhere - they come back by re-fetch.
    expect(store.get(dwRawDatasetAtom).rows).toEqual([])
    expect(store.get(dwDraftArtifactIdAtom)).toBeNull()
    // Saved Step 5 is pulled back to 4, destination parked behind the fetch.
    expect(store.get(datasetResumeTargetAtom)).toEqual({
      step: 4,
      highestUnlocked: 5,
    })
    expect(store.get(dwCurrentStepAtom)).toBe(2)
    expect(store.get(dwHighestUnlockedAtom)).toBe(2)
    // The cleaning WORK survives; the CLAIM that it was committed does not.
    expect(store.get(dwCleaningPipelinesAtom)).toEqual({ T1: {} })
    expect(store.get(dwCleanedTagsAtom)).toEqual([])
    expect(store.get(dwFeatureArtifactStampAtom)).toBeNull()
    expect(toast.success).toHaveBeenCalled()
  })

  it('a CSV draft never sets dwDraftIdAtom and lands on Step 1 with a re-upload prompt', async () => {
    get.mockResolvedValue(
      draft({
        wizardState: snapshot({
          sourceIds: ['csv-1'],
          csvFileName: 'plant.csv',
          currentStep: 3,
        }),
      }),
    )
    const store = mount()

    await waitFor(() =>
      expect(store.get(datasetSnapshotDraftIdAtom)).toBe('draft-1'),
    )
    expect(store.get(dwDraftIdAtom)).toBeNull()
    expect(store.get(dwCurrentStepAtom)).toBe(1)
    expect(store.get(datasetResumeTargetAtom)).toBeNull()
    expect(toast.warning).toHaveBeenCalledWith(
      expect.stringContaining('plant.csv'),
    )
  })

  it('refuses a draft the caller did not create and sends them back', async () => {
    get.mockResolvedValue(draft({ isCreator: false, wizardState: null }))
    const store = mount()

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/data-studio'))
    expect(store.get(dwDraftIdAtom)).toBeNull()
    expect(toast.error).toHaveBeenCalled()
  })

  it('refuses a SAVED draft and an unreadable snapshot', async () => {
    get.mockResolvedValueOnce(draft({ status: 'SAVED' }))
    mount()
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1))

    replace.mockClear()
    get.mockResolvedValueOnce(draft({ wizardStateVersion: 99 }))
    mount()
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/data-studio'))
  })

  it('does nothing when the URL carries no draftId, or the draft is already live', async () => {
    draftIdInUrl = null
    mount()
    expect(get).not.toHaveBeenCalled()

    draftIdInUrl = 'draft-1'
    const store = createStore()
    store.set(dwDraftIdAtom, 'draft-1')
    renderHook(() => useDatasetDraftResume(), {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(Provider, { store }, children),
    })
    expect(get).not.toHaveBeenCalled()
  })
})
