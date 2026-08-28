import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import { useModelPipelineNav } from '../use-model-pipeline-nav'
import {
  mpCurrentStepAtom,
  mpHighestUnlockedAtom,
  mpTrainStateAtom,
} from '@/store/model-pipeline'
import type { SavedDataset } from '@/store/datasets'

/**
 * MODEL-FLOW-010-T02 / V01, superseded by MODEL-FLOW-013-T01. The wizard
 * first went from 4 steps to 5 (Dataset Review inserted at 2, Training
 * Config/Evaluation/Save Model shifted to 3/4/5 — nine
 * `setHighestUnlocked(prev => Math.min(prev, 2))` relock calls became
 * `Math.min(prev, 3)`), then from 5 to 6 (Model Selection inserted at 4,
 * Evaluation/Save Model shifted to 5/6 — the nine relock calls stay at `3`
 * unchanged, since a step inserted AFTER Training Config doesn't change
 * what a Training-Config edit invalidates). Both renumberings typecheck
 * regardless of correctness; this is the unit-level regression guard for
 * both, at a fraction of a live browser walk's cost.
 */

let store: ReturnType<typeof createStore>

const DATASET: SavedDataset = {
  id: 'ds-1',
  name: 'Dataset 1',
  workspaceId: 'ws-1',
  currentArtifactId: 'art-1',
} as SavedDataset

beforeEach(() => {
  store = createStore()
})

function renderNav() {
  return renderHook(() => useModelPipelineNav(), {
    wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
  })
}

describe('useModelPipelineNav — 6-step renumbering (MODEL-FLOW-013-T01)', () => {
  it('canAdvance(2) (Dataset Review) gates on a selected dataset alone', () => {
    const { result } = renderNav()
    expect(result.current.canAdvance(2)).toBe(false)

    act(() => result.current.setSelectedDataset(DATASET))
    expect(result.current.canAdvance(2)).toBe(true)
  })

  it('canAdvance(3) (Training Config) gates on training being done, not on step 2', () => {
    const { result } = renderNav()
    expect(result.current.canAdvance(3)).toBe(false)

    act(() => store.set(mpTrainStateAtom, { status: 'done', progress: 100 }))
    expect(result.current.canAdvance(3)).toBe(true)
  })

  it('canAdvance(4) (Model Selection) mirrors canAdvance(3) — the same trainState gate, so a re-triggered failure blocks advancing past it', () => {
    const { result } = renderNav()
    expect(result.current.canAdvance(4)).toBe(false)

    act(() => store.set(mpTrainStateAtom, { status: 'done', progress: 100 }))
    expect(result.current.canAdvance(4)).toBe(true)

    act(() => store.set(mpTrainStateAtom, { status: 'error', progress: 0 }))
    expect(result.current.canAdvance(4)).toBe(false)
  })

  it('canAdvance(5) (Evaluation) is unconditionally true once reached; canAdvance(6) (Save Model) is always false', () => {
    const { result } = renderNav()
    expect(result.current.canAdvance(5)).toBe(true)
    expect(result.current.canAdvance(6)).toBe(false)
  })

  it('editing the algorithm from step 4 relocks highestUnlocked to 3, not 2', () => {
    store.set(mpHighestUnlockedAtom, 4)
    const { result } = renderNav()

    act(() => result.current.setAlgorithm('random_forest'))

    expect(result.current.highestUnlocked).toBe(3)
  })

  it('editing the target variable from step 5 relocks highestUnlocked to 3', () => {
    store.set(mpHighestUnlockedAtom, 5)
    const { result } = renderNav()

    act(() => result.current.setTargetVariable(['TI-101']))

    expect(result.current.highestUnlocked).toBe(3)
  })

  it('editing hyperparameters relocks highestUnlocked to 3 but does not touch a lower value', () => {
    store.set(mpHighestUnlockedAtom, 2)
    const { result } = renderNav()

    act(() => result.current.setHyperparameter('n_estimators', 100))

    // Math.min(2, 3) === 2 — a relock must never RAISE highestUnlocked.
    expect(result.current.highestUnlocked).toBe(2)
  })

  it('picking a different dataset still relocks highestUnlocked to 1, unchanged by the renumbering', () => {
    store.set(mpHighestUnlockedAtom, 5)
    const { result } = renderNav()

    act(() => result.current.setSelectedDataset(DATASET))

    expect(result.current.highestUnlocked).toBe(1)
  })

  it('goTo clamps to [1, 6] and to highestUnlocked', () => {
    store.set(mpHighestUnlockedAtom, 3)
    const { result } = renderNav()

    act(() => result.current.goTo(99))
    expect(result.current.currentStep).toBe(1) // 99 > highestUnlocked(3), rejected

    act(() => result.current.goTo(6))
    expect(result.current.currentStep).toBe(1) // 6 > highestUnlocked(3), rejected

    act(() => result.current.goTo(3))
    expect(result.current.currentStep).toBe(3)
  })

  it('goTo rejects a step beyond MP_TOTAL_STEPS(6) even when highestUnlocked would allow it', () => {
    store.set(mpHighestUnlockedAtom, 10)
    const { result } = renderNav()

    act(() => result.current.goTo(7))
    expect(result.current.currentStep).toBe(1) // 7 > MP_TOTAL_STEPS(6), rejected

    act(() => result.current.goTo(6))
    expect(result.current.currentStep).toBe(6)
  })

  it('next() walks Dataset Review (2) forward into Training Config (3) once a dataset is selected', () => {
    const { result } = renderNav()
    act(() => result.current.setSelectedDataset(DATASET))
    act(() => store.set(mpCurrentStepAtom, 2))

    act(() => result.current.next())

    expect(result.current.currentStep).toBe(3)
    expect(result.current.highestUnlocked).toBe(3)
  })
})
