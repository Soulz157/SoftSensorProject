import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import {
  mpDescriptionAtom,
  mpNameAtom,
  mpEquipmentIdAtom,
  mpPlantIdAtom,
  mpSelectedDatasetAtom,
  mpWorkspaceIdAtom,
} from '@/store/model-pipeline'
import type { SavedDataset } from '@/store/datasets'
import { useModelWizardMode } from '@/hooks/model/use-model-wizard-mode'

/**
 * MODEL-FLOW-032. Coming back from Data Studio's Save to
 * `/models/create?newDatasetId=…`: Step 1 is put back the way it was left
 * and the dataset just made is selected — exactly once.
 */

const KEY = 'softsensor.model-create-handoff'

const h = vi.hoisted(() => ({
  getDataset: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  params: new URLSearchParams(),
  toastWarning: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: h.push, replace: h.replace }),
  useSearchParams: () => h.params,
}))

vi.mock('@/services/model-draft', () => ({
  modelDraftService: { get: vi.fn() },
}))

vi.mock('@/services/dataset', () => ({
  datasetService: { get: h.getDataset },
}))

vi.mock('@/services/model', () => ({
  getModelById: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    warning: h.toastWarning,
    success: h.toastSuccess,
    error: h.toastError,
  },
}))

const STEP_ONE = {
  name: 'Boiler efficiency',
  description: 'Predicts FBP',
  workspaceId: 'ws-1',
  plantId: 'plant-1',
  nodeId: 'node-1',
}

const DATASET = {
  id: 'ds-new',
  name: 'Boiler feedwater',
  workspaceId: 'ws-1',
  tags: ['TAG_A'],
} as unknown as SavedDataset

let store: ReturnType<typeof createStore>

beforeEach(() => {
  store = createStore()
  sessionStorage.clear()
  sessionStorage.setItem(KEY, JSON.stringify(STEP_ONE))
  h.params = new URLSearchParams({ newDatasetId: 'ds-new' })
  h.getDataset.mockReset().mockResolvedValue({ data: DATASET })
  h.push.mockReset()
  h.replace.mockReset()
  h.toastWarning.mockReset()
  h.toastSuccess.mockReset()
  h.toastError.mockReset()
})

async function renderReturn() {
  const rendered = renderHook(() => useModelWizardMode(), {
    wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
  })
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
  return rendered
}

describe('useModelWizardMode — back from Create Dataset (MODEL-FLOW-032)', () => {
  it('restores Step 1 and selects the new dataset', async () => {
    const { result } = await renderReturn()

    expect(result.current.mode).toBe('create')
    expect(store.get(mpNameAtom)).toBe('Boiler efficiency')
    expect(store.get(mpDescriptionAtom)).toBe('Predicts FBP')
    expect(store.get(mpWorkspaceIdAtom)).toBe('ws-1')
    expect(store.get(mpPlantIdAtom)).toBe('plant-1')
    expect(store.get(mpEquipmentIdAtom)).toBe('node-1')
    expect(h.getDataset).toHaveBeenCalledWith('ds-new')
    expect(store.get(mpSelectedDatasetAtom)?.id).toBe('ds-new')
  })

  it('restores exactly once: the intent is cleared and the param dropped', async () => {
    await renderReturn()

    expect(sessionStorage.getItem(KEY)).toBeNull()
    expect(h.replace).toHaveBeenCalledWith('/models/create')
  })

  it('still selects the dataset when the Step 1 values were lost', async () => {
    sessionStorage.clear()

    await renderReturn()

    expect(store.get(mpNameAtom)).toBe('')
    // The dataset's own workspace, so the picker can list it.
    expect(store.get(mpWorkspaceIdAtom)).toBe('ws-1')
    expect(store.get(mpSelectedDatasetAtom)?.id).toBe('ds-new')
  })

  it('does not select a dataset from another workspace', async () => {
    h.getDataset.mockResolvedValue({
      data: { ...DATASET, workspaceId: 'ws-other' },
    })

    await renderReturn()

    expect(store.get(mpSelectedDatasetAtom)).toBeNull()
    expect(store.get(mpWorkspaceIdAtom)).toBe('ws-1')
    expect(h.toastWarning).toHaveBeenCalled()
  })

  it('keeps Step 1 and says so when the dataset cannot be loaded', async () => {
    h.getDataset.mockRejectedValue(new Error('404'))

    await renderReturn()

    expect(store.get(mpNameAtom)).toBe('Boiler efficiency')
    expect(store.get(mpSelectedDatasetAtom)).toBeNull()
    expect(h.toastError).toHaveBeenCalled()
  })

  it('clears an abandoned intent on a plain create visit', async () => {
    h.params = new URLSearchParams()

    await renderReturn()

    expect(sessionStorage.getItem(KEY)).toBeNull()
    expect(store.get(mpNameAtom)).toBe('')
    expect(h.getDataset).not.toHaveBeenCalled()
  })
})
