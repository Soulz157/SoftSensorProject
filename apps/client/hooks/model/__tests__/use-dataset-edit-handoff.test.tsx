import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { SavedDataset } from '@/store/datasets'
import type { SavedDataSource } from '@/lib/mock-data-sources'
import { useDatasetEditHandoff } from '@/hooks/model/use-dataset-edit-handoff'

/**
 * MODEL-FLOW-010-T07. The hand-off's only real failure mode is ORDER: the
 * draft must be written to the server BEFORE the navigation, and a failed
 * write must abort it. Both are invisible in a happy-path click-through — the
 * user only discovers a stranded draft later, when the resume they were
 * promised restores a stale configuration or nothing at all.
 */

// `vi.hoisted` because `vi.mock` factories are lifted above every `const` in
// this file — declaring the spies normally makes them unreachable from inside.
const h = vi.hoisted(() => ({
  flush: vi.fn<() => Promise<void>>(),
  openDatasetForEdit: vi.fn(),
  toastError: vi.fn(),
  autoSyncSeen: { value: undefined as boolean | undefined },
}))

const { flush, openDatasetForEdit, toastError, autoSyncSeen } = h
const calls: string[] = []

vi.mock('@/hooks/model/use-model-draft-sync', () => ({
  useModelDraftSync: (options?: { autoSync?: boolean }) => {
    h.autoSyncSeen.value = options?.autoSync
    return { draftId: 'draft-1', ensureDraftId: vi.fn(), flush: h.flush }
  },
}))

vi.mock('@/hooks/dataset/use-dataset-edit-navigation', () => ({
  useDatasetEditNavigation: () => h.openDatasetForEdit,
}))

vi.mock('sonner', () => ({
  toast: { error: h.toastError, warning: vi.fn(), success: vi.fn() },
}))

const DATASET = {
  id: 'ds-1',
  name: 'Boiler feedwater',
  sourceIds: ['src-1'],
  tags: ['TAG_A'],
} as unknown as SavedDataset

const SOURCES = [
  { id: 'src-1', name: 'PI Server' },
] as unknown as SavedDataSource[]

beforeEach(() => {
  calls.length = 0
  flush.mockReset().mockImplementation(async () => {
    calls.push('flush')
  })
  openDatasetForEdit.mockReset().mockImplementation(() => {
    calls.push('navigate')
  })
  toastError.mockReset()
})

describe('useDatasetEditHandoff (MODEL-FLOW-010-T07)', () => {
  it('never leaves the debounced sync running in a step that configures nothing', () => {
    renderHook(() => useDatasetEditHandoff())
    expect(autoSyncSeen.value).toBe(false)
  })

  it('writes the draft BEFORE navigating', async () => {
    const { result } = renderHook(() => useDatasetEditHandoff())

    await act(async () => {
      await result.current.handOff(DATASET, SOURCES)
    })

    expect(calls).toEqual(['flush', 'navigate'])
    expect(openDatasetForEdit).toHaveBeenCalledWith(DATASET, SOURCES)
  })

  it('aborts the navigation when the draft could not be saved', async () => {
    flush.mockRejectedValueOnce(new Error('500'))
    const { result } = renderHook(() => useDatasetEditHandoff())

    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.handOff(DATASET, SOURCES)
    })

    // The dialog promises the draft is saved — navigating anyway would make
    // that promise false and strand the configuration.
    expect(ok).toBe(false)
    expect(openDatasetForEdit).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalled()
    // Released, so the user can retry rather than face a stuck button.
    expect(result.current.leaving).toBe(false)
  })

  it('reports success so the caller can close its dialog', async () => {
    const { result } = renderHook(() => useDatasetEditHandoff())

    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.handOff(DATASET, SOURCES)
    })

    expect(ok).toBe(true)
  })
})
