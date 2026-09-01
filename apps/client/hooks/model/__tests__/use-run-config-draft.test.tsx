import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import { useModelPipelineNav } from '../use-model-pipeline-nav'
import { useRunConfigDraft } from '../use-run-config-draft'
import {
  mpAlgorithmAtom,
  mpAlgorithmsAtom,
  mpHighestUnlockedAtom,
  mpHyperparamsAtom,
  mpTargetVariableAtom,
  mpTrainStateAtom,
  mpTrainTestSplitAtom,
} from '@/store/model-pipeline'

/**
 * MODEL-FLOW-014-T08. Direct coverage of the mechanism `Phase3TrainingConfig`
 * now delegates to: edits land in `draft` only, `dirty` tracks divergence
 * from the committed atoms, and `apply()` is the only thing that writes them
 * — replicating the same relock (`resetTraining` + `Math.min(prev, 3)`) the
 * deleted per-field nav setters used to perform inline, in one place now.
 * Supersedes the three relock assertions removed from
 * use-model-pipeline-nav.test.tsx.
 */

let store: ReturnType<typeof createStore>

beforeEach(() => {
  store = createStore()
})

function renderDraft() {
  return renderHook(
    () => {
      const nav = useModelPipelineNav()
      const runConfig = useRunConfigDraft(nav)
      return { nav, runConfig }
    },
    {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    },
  )
}

describe('useRunConfigDraft — edits stay local until Apply', () => {
  it('starts clean: draft mirrors the committed atoms, dirty is false', () => {
    const { result } = renderDraft()
    expect(result.current.runConfig.draft.trainTestSplit).toBe(80)
    expect(result.current.runConfig.draft.lossFunction).toBe('mse')
    expect(result.current.runConfig.draft.algorithms).toEqual(['ols'])
    expect(result.current.runConfig.dirty).toBe(false)
  })

  it('editing the split changes the draft but writes nothing committed and does not relock', () => {
    store.set(mpHighestUnlockedAtom, 5)
    const { result } = renderDraft()

    act(() => result.current.runConfig.setTrainTestSplit(60))

    expect(result.current.runConfig.draft.trainTestSplit).toBe(60)
    expect(result.current.runConfig.dirty).toBe(true)
    // Committed atom untouched.
    expect(store.get(mpHighestUnlockedAtom)).toBe(5)
  })

  it('editing the target variable does not touch the committed atom or relock', () => {
    store.set(mpHighestUnlockedAtom, 5)
    const { result } = renderDraft()

    act(() => result.current.runConfig.setTargetVariable(['TI-101']))

    expect(result.current.runConfig.draft.targetVariables).toEqual(['TI-101'])
    expect(store.get(mpTargetVariableAtom)).toEqual([])
    expect(store.get(mpHighestUnlockedAtom)).toBe(5)
  })

  it('editing hyperparameters does not touch the committed atom or relock', () => {
    store.set(mpHighestUnlockedAtom, 2)
    const { result } = renderDraft()

    act(() => result.current.runConfig.setHyperparameter('n_estimators', 100))

    expect(result.current.runConfig.draft.hyperparameters.n_estimators).toBe(
      100,
    )
    expect(store.get(mpHyperparamsAtom).n_estimators).toBeUndefined()
    expect(store.get(mpHighestUnlockedAtom)).toBe(2)
  })

  it('setAlgorithms cascades default hyperparameters in the DRAFT only, mirroring the deleted nav.setAlgorithms', () => {
    const { result } = renderDraft()

    act(() => result.current.runConfig.setHyperparameter('alpha', 0.5))
    act(() => result.current.runConfig.setAlgorithms(['random_forest']))

    expect(result.current.runConfig.draft.algorithms).toEqual(['random_forest'])
    // random_forest's clean defaults, not ridge's leftover alpha.
    expect(result.current.runConfig.draft.hyperparameters.alpha).toBeUndefined()
    expect(store.get(mpAlgorithmsAtom)).toEqual(['ols']) // still uncommitted
  })

  it('setFindBestModel(false) cascades findBestParams off in the draft, mirroring the deleted cascade', () => {
    const { result } = renderDraft()

    act(() => result.current.runConfig.setFindBestModel(true))
    act(() => result.current.runConfig.setFindBestParams(true))
    act(() => result.current.runConfig.setFindBestModel(false))

    expect(result.current.runConfig.draft.findBestModel).toBe(false)
    expect(result.current.runConfig.draft.findBestParams).toBe(false)
  })
})

describe('useRunConfigDraft — apply()', () => {
  it('writes every field to its committed atom and clears dirty', () => {
    const { result } = renderDraft()

    act(() => {
      result.current.runConfig.setTrainTestSplit(60)
      result.current.runConfig.setTargetVariable(['TI-101'])
      result.current.runConfig.setLossFunction('mae')
      result.current.runConfig.setSeed(4242)
    })
    expect(result.current.runConfig.dirty).toBe(true)

    act(() => result.current.runConfig.apply())

    expect(store.get(mpTargetVariableAtom)).toEqual(['TI-101'])
    expect(result.current.runConfig.dirty).toBe(false)
  })

  it('relocks highestUnlocked to 3 from step 5, same as the deleted per-field setters did', () => {
    store.set(mpHighestUnlockedAtom, 5)
    const { result } = renderDraft()

    act(() => result.current.runConfig.setTargetVariable(['TI-101']))
    act(() => result.current.runConfig.apply())

    expect(store.get(mpHighestUnlockedAtom)).toBe(3)
  })

  it('relocks highestUnlocked to 3 from step 4 too', () => {
    store.set(mpHighestUnlockedAtom, 4)
    const { result } = renderDraft()

    act(() => result.current.runConfig.setAlgorithms(['random_forest']))
    act(() => result.current.runConfig.apply())

    expect(store.get(mpHighestUnlockedAtom)).toBe(3)
  })

  it('never RAISES highestUnlocked — Math.min(prev, 3) leaves a lower value alone', () => {
    store.set(mpHighestUnlockedAtom, 2)
    const { result } = renderDraft()

    act(() => result.current.runConfig.setHyperparameter('n_estimators', 100))
    act(() => result.current.runConfig.apply())

    expect(store.get(mpHighestUnlockedAtom)).toBe(2)
  })

  it('resets trainState to idle on Apply', () => {
    store.set(mpTrainStateAtom, { status: 'done', progress: 100 })
    const { result } = renderDraft()

    act(() => result.current.runConfig.setTrainTestSplit(70))
    act(() => result.current.runConfig.apply())

    expect(store.get(mpTrainStateAtom)).toEqual({
      status: 'idle',
      progress: 0,
    })
  })

  it('writes the primary algorithm mirror (mpAlgorithmAtom) alongside the array, like the deleted setAlgorithms cascade', () => {
    const { result } = renderDraft()

    act(() =>
      result.current.runConfig.setAlgorithms(['random_forest', 'ridge']),
    )
    act(() => result.current.runConfig.apply())

    expect(store.get(mpAlgorithmsAtom)).toEqual(['random_forest', 'ridge'])
    expect(store.get(mpAlgorithmAtom)).toBe('random_forest')
  })
})

describe('useRunConfigDraft — discard()', () => {
  it('reverts the draft to the committed atoms without writing anything', () => {
    const { result } = renderDraft()

    act(() => result.current.runConfig.setTrainTestSplit(60))
    expect(result.current.runConfig.dirty).toBe(true)

    act(() => result.current.runConfig.discard())

    expect(result.current.runConfig.draft.trainTestSplit).toBe(80)
    expect(result.current.runConfig.dirty).toBe(false)
  })

  it('reverts to the LAST APPLIED value, not the original default — discard means undo-the-edit, not undo-everything', () => {
    const { result } = renderDraft()

    act(() => result.current.runConfig.setTrainTestSplit(60))
    act(() => result.current.runConfig.apply())
    expect(store.get(mpTrainTestSplitAtom)).toBe(60)

    act(() => result.current.runConfig.setTrainTestSplit(70))
    expect(result.current.runConfig.draft.trainTestSplit).toBe(70)
    expect(result.current.runConfig.dirty).toBe(true)

    act(() => result.current.runConfig.discard())

    expect(result.current.runConfig.draft.trainTestSplit).toBe(60)
    expect(result.current.runConfig.dirty).toBe(false)
    // discard reads the committed atom, never writes it.
    expect(store.get(mpTrainTestSplitAtom)).toBe(60)
  })
})

describe('useRunConfigDraft — re-syncs from an external commit', () => {
  it('picks up an atom written from outside (e.g. the Recall panel Apply) and clears any prior edit', () => {
    const { result } = renderDraft()

    act(() => result.current.runConfig.setTrainTestSplit(60))
    expect(result.current.runConfig.dirty).toBe(true)

    // Simulates useApplyRunParams writing the committed atom directly while
    // Step 3 stays mounted.
    act(() => store.set(mpTargetVariableAtom, ['PI-201']))

    expect(result.current.runConfig.draft.targetVariables).toEqual(['PI-201'])
    // The split edit from before the external commit is gone too — Apply
    // elsewhere re-seeds the WHOLE draft, per the hook's own doc comment.
    expect(result.current.runConfig.draft.trainTestSplit).toBe(80)
    expect(result.current.runConfig.dirty).toBe(false)
  })
})
