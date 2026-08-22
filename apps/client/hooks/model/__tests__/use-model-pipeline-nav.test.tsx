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
 * MODEL-FLOW-010-T02 / V01. The wizard went from 4 steps to 5 by inserting
 * Dataset Review at 2 and shifting Training Config/Evaluation/Save Model to
 * 3/4/5. Nine `setHighestUnlocked(prev => Math.min(prev, 2))` relock calls
 * became `Math.min(prev, 3)` — a change that typechecks regardless of
 * correctness and had zero test coverage before this file. This is the
 * regression guard V01's live 5-step walk exists to protect; a unit test on
 * the reducer logic gets the same assertion for a fraction of the cost.
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

describe('useModelPipelineNav — 5-step renumbering (MODEL-FLOW-010-T02)', () => {
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

  it('canAdvance(4) (Evaluation) is unconditionally true once reached; canAdvance(5) (Save Model) is always false', () => {
    const { result } = renderNav()
    expect(result.current.canAdvance(4)).toBe(true)
    expect(result.current.canAdvance(5)).toBe(false)
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

  it('goTo clamps to [1, 5] and to highestUnlocked', () => {
    store.set(mpHighestUnlockedAtom, 3)
    const { result } = renderNav()

    act(() => result.current.goTo(99))
    expect(result.current.currentStep).toBe(1) // 99 > highestUnlocked(3), rejected

    act(() => result.current.goTo(6))
    expect(result.current.currentStep).toBe(1) // beyond MP_TOTAL_STEPS(5), rejected

    act(() => result.current.goTo(3))
    expect(result.current.currentStep).toBe(3)
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
