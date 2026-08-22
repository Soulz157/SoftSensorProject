import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import {
  mpCurrentStepAtom,
  mpHighestUnlockedAtom,
  mpHyperparamsAtom,
  mpNameAtom,
  mpNodeIdAtom,
  mpPlantIdAtom,
  mpSelectedDatasetAtom,
  mpServerDraftIdAtom,
  mpTargetVariableAtom,
  mpTrainTestSplitAtom,
  mpWorkspaceIdAtom,
} from '@/store/model-pipeline'
import type { SavedDataset } from '@/store/datasets'
import { useModelWizardMode } from '@/hooks/model/use-model-wizard-mode'

/**
 * MODEL-FLOW-010-T08 / V04 / V05. Behavioural cover for the resume branch —
 * the orchestration, not the helpers `model-draft-hydration.test.ts` already
 * pins.
 *
 * The assertion that earns its keep is the HYPERPARAMETERS one. Hydration
 * deliberately uses raw atom setters rather than `useModelPipelineNav`'s,
 * because `setAlgorithm` overwrites hyperparameters with that algorithm's
 * defaults. A later "tidy-up" that routes hydration through the nav hook
 * typechecks, reads better, and silently trains every resumed draft on
 * default parameters — a failure that surfaces only as metrics nobody can
 * explain. That regression fails here.
 */

const h = vi.hoisted(() => ({
  getDraft: vi.fn(),
  getDataset: vi.fn(),
  push: vi.fn(),
  params: new URLSearchParams(),
  toastWarning: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: h.push }),
  useSearchParams: () => h.params,
}))

vi.mock('@/services/model-draft', () => ({
  modelDraftService: { get: h.getDraft },
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

const DRAFT = {
  id: 'draft-1',
  name: 'Boiler efficiency',
  workspaceId: 'ws-1',
  plantId: 'plant-1',
  nodeId: 'node-1',
  datasetId: 'ds-1',
  targetY: 'TAG_A',
  algorithm: 'ridge',
  // Deliberately NOT ridge's defaults: if hydration ever routes through
  // nav.setAlgorithm these are replaced and the assertion below fails.
  hyperparameters: { alpha: 7, max_iter: 500 },
  splitRatio: 0.8,
  status: 'ACTIVE',
  currentRunId: null,
  savedModelId: null,
  createdAt: '2026-08-20T10:00:00.000Z',
  updatedAt: '2026-08-21T11:00:00.000Z',
}

const DATASET = {
  id: 'ds-1',
  name: 'Boiler feedwater',
  workspaceId: 'ws-1',
  tags: ['TAG_A', 'TAG_B'],
  currentArtifactId: 'art-1',
} as unknown as SavedDataset

let store: ReturnType<typeof createStore>

beforeEach(() => {
  store = createStore()
  h.params = new URLSearchParams({ draftId: 'draft-1' })
  h.getDraft.mockReset().mockResolvedValue({ data: DRAFT })
  h.getDataset.mockReset().mockResolvedValue({ data: DATASET })
  h.push.mockReset()
  h.toastWarning.mockReset()
  h.toastSuccess.mockReset()
  h.toastError.mockReset()
})

async function renderResume() {
  const rendered = renderHook(() => useModelWizardMode(), {
    wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
  })
  // Let the mount effect's two awaited fetches settle.
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
  return rendered
}

describe('useModelWizardMode — resume a draft (MODEL-FLOW-010-T08)', () => {
  it('stays in create mode: a draft has no Model row to edit', async () => {
    const { result } = await renderResume()
    expect(result.current.mode).toBe('create')
  })

  it('restores Step 1’s choices (MODEL-FLOW-010-V05)', async () => {
    await renderResume()

    expect(store.get(mpNameAtom)).toBe('Boiler efficiency')
    expect(store.get(mpWorkspaceIdAtom)).toBe('ws-1')
    expect(store.get(mpPlantIdAtom)).toBe('plant-1')
    expect(store.get(mpNodeIdAtom)).toBe('node-1')
    expect(store.get(mpSelectedDatasetAtom)?.id).toBe('ds-1')
  })

  it('keeps the draft’s own hyperparameters instead of the algorithm’s defaults', async () => {
    await renderResume()
    expect(store.get(mpHyperparamsAtom)).toEqual({ alpha: 7, max_iter: 500 })
  })

  it('converts the stored FRACTION back to the wizard’s percentage', async () => {
    await renderResume()
    expect(store.get(mpTrainTestSplitAtom)).toBe(80)
  })

  it('adopts the existing draft id so Step 3 continues that row', async () => {
    // Without this the wizard would POST a second draft and the first would
    // be orphaned mid-flow.
    await renderResume()
    expect(store.get(mpServerDraftIdAtom)).toBe('draft-1')
  })

  it('lands on Step 1 and unlocks no further than Dataset Review', async () => {
    // Nothing restores a training result, so an unlocked Evaluation step
    // would offer a page with nothing in it.
    await renderResume()
    expect(store.get(mpCurrentStepAtom)).toBe(1)
    expect(store.get(mpHighestUnlockedAtom)).toBe(2)
  })

  it('keeps a target the dataset still has', async () => {
    await renderResume()
    expect(store.get(mpTargetVariableAtom)).toEqual(['TAG_A'])
    expect(h.toastWarning).not.toHaveBeenCalled()
  })

  it('clears a target the dataset edit removed, and says so (V04)', async () => {
    h.getDataset.mockResolvedValue({
      data: { ...DATASET, tags: ['TAG_B', 'TAG_C'] },
    })

    await renderResume()

    expect(store.get(mpTargetVariableAtom)).toEqual([])
    // Silently dropping it would surface later as a pyarrow
    // "No match for FieldRef.Name" that names a column and explains nothing.
    expect(h.toastWarning).toHaveBeenCalledWith(
      expect.stringContaining('TAG_A'),
    )
  })

  it('keeps the draft when the dataset itself fails to load', async () => {
    // An edit never deletes the Dataset row, so a failure here is a load
    // failure — the user is told, not silently reset.
    h.getDataset.mockRejectedValue(new Error('503'))

    await renderResume()

    expect(store.get(mpServerDraftIdAtom)).toBe('draft-1')
    expect(store.get(mpTargetVariableAtom)).toEqual([])
    expect(h.toastWarning).toHaveBeenCalled()
    expect(h.push).not.toHaveBeenCalled()
  })

  it('sends the user back to the models list when the draft is gone', async () => {
    h.getDraft.mockRejectedValue(new Error('404'))

    await renderResume()

    expect(h.toastError).toHaveBeenCalled()
    expect(h.push).toHaveBeenCalledWith('/models/views')
  })

  it('does nothing extra on a plain create URL', async () => {
    h.params = new URLSearchParams()

    await renderResume()

    expect(h.getDraft).not.toHaveBeenCalled()
    expect(store.get(mpServerDraftIdAtom)).toBeNull()
  })
})
