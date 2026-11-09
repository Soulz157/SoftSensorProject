import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import { useModelPipelineNav } from '../use-model-pipeline-nav'
import {
  mpEditModelIdAtom,
  mpEquipmentIdAtom,
  mpNameAtom,
  mpPlantIdAtom,
  mpSelectedDatasetAtom,
  mpWorkspaceIdAtom,
} from '@/store/model-pipeline'
import type { SavedDataset } from '@/store/datasets'

/**
 * MODEL-SERVE-041. A workspace at its model cap stops the wizard at Step 1,
 * instead of letting the user train and fine-tune and refuse at Save Model.
 */
const limitHook = vi.fn()
vi.mock('@/hooks/workspace/use-workspace-model-limit', () => ({
  useWorkspaceModelLimit: (id: string, enabled: boolean) =>
    limitHook(id, enabled) as unknown,
}))
vi.mock('@/hooks/workspace/use-models', () => ({
  useModels: () => ({ data: [], isFetching: false }),
}))

let store: ReturnType<typeof createStore>

beforeEach(() => {
  store = createStore()
  limitHook.mockReset()
  store.set(mpNameAtom, 'Model A')
  store.set(mpWorkspaceIdAtom, 'ws-1')
  store.set(mpPlantIdAtom, 'plant-1')
  store.set(mpEquipmentIdAtom, 'eq-1')
  store.set(mpSelectedDatasetAtom, { id: 'ds-1' } as SavedDataset)
})

function renderNav() {
  return renderHook(() => useModelPipelineNav(), {
    wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
  })
}

describe('useModelPipelineNav — workspace model cap (MODEL-SERVE-041)', () => {
  it('Step 1 can advance while the workspace has room', () => {
    limitHook.mockReturnValue(null)
    const { result } = renderNav()
    expect(result.current.modelLimitNote).toBeNull()
    expect(result.current.canAdvance(1)).toBe(true)
  })

  it('Step 1 cannot advance when the workspace is full, and exposes why', () => {
    limitHook.mockReturnValue('Model limit reached (5). An admin can raise it.')
    const { result } = renderNav()
    expect(result.current.modelLimitNote).toBe(
      'Model limit reached (5). An admin can raise it.',
    )
    expect(result.current.canAdvance(1)).toBe(false)
  })

  it('asks the limit hook about the chosen workspace, and not when editing a saved model', () => {
    limitHook.mockReturnValue(null)
    renderNav()
    expect(limitHook).toHaveBeenLastCalledWith('ws-1', true)

    store.set(mpEditModelIdAtom, 'model-9')
    renderNav()
    expect(limitHook).toHaveBeenLastCalledWith('ws-1', false)
  })
})
