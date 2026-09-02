import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import { useApplyRunParams } from '../use-apply-run-params'
import {
  mpAlgorithmAtom,
  mpAlgorithmsAtom,
  mpFindBestModelAtom,
  mpFindBestParamsAtom,
  mpHighestUnlockedAtom,
  mpHyperparamsAtom,
  mpTargetVariableAtom,
  mpTrainStateAtom,
  mpTrainTestSplitAtom,
} from '@/store/model-pipeline'
import type { ModelTrainingRun } from '@/services/model-draft'

/**
 * MODEL-FLOW-012-V01/V03. `alpha: 0.037` is deliberately NOT ridge's default
 * (1.0, lib/training-config.ts:50-59) — a defaults-valued fixture would pass
 * even if Apply were routed through `setAlgorithm`, which overwrites
 * hyperparameters with `defaultHyperparams(value)`. This is the exact trap
 * MODEL-FLOW-010-V05 pinned for draft resume; T06 names it again here.
 */
function ridgeRun(overrides: Partial<ModelTrainingRun> = {}): ModelTrainingRun {
  return {
    id: 'run-1',
    status: 'SUCCEEDED',
    failureReason: null,
    datasetId: 'ds-1',
    goldArtifactId: 'art-1',
    artifactChecksum: 'sha256:abc',
    featureSpecKey: 'feature_spec.json',
    targetY: 'TI-101',
    algorithm: 'ridge',
    hyperparameters: { alpha: 0.037 },
    seed: 4242,
    splitSpec: { method: 'chronological', ratio: 0.7 },
    imageDigest: 'sha256:def',
    modelKey: 'model.joblib',
    metrics: { r2: 0.9, rmse: 1.2 },
    holdoutMetrics: null,
    cvFoldsKey: null,
    predictionsKey: null,
    scoringContainerId: null,
    lossHistoryKey: null,
    candidateJobId: null,
    createdAt: '2026-08-27T00:00:00.000Z',
    startedAt: '2026-08-27T00:00:01.000Z',
    finishedAt: '2026-08-27T00:00:30.000Z',
    logs: [],
    ...overrides,
  }
}

let store: ReturnType<typeof createStore>

beforeEach(() => {
  store = createStore()
})

function renderApply() {
  return renderHook(() => useApplyRunParams(), {
    wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
  })
}

describe('useApplyRunParams', () => {
  it('applies the run values verbatim into raw atoms, never the algorithm defaults', () => {
    store.set(mpAlgorithmsAtom, ['svm'])
    store.set(mpAlgorithmAtom, 'svm')
    store.set(mpHyperparamsAtom, { C: 1.0, kernel: 'rbf', epsilon: 0.1 })

    const { result } = renderApply()
    act(() => result.current.applyRun(ridgeRun()))

    expect(store.get(mpAlgorithmsAtom)).toEqual(['ridge'])
    expect(store.get(mpAlgorithmAtom)).toBe('ridge')
    // The load-bearing assertion: 0.037, not ridge's default of 1.0.
    expect(store.get(mpHyperparamsAtom)).toEqual({ alpha: 0.037 })
    expect(store.get(mpTargetVariableAtom)).toEqual(['TI-101'])
    expect(store.get(mpTrainTestSplitAtom)).toBe(70)
  })

  it('forces both AutoML toggles off so the applied hyperparameters are visible', () => {
    store.set(mpFindBestModelAtom, true)
    store.set(mpFindBestParamsAtom, true)

    const { result } = renderApply()
    act(() => result.current.applyRun(ridgeRun()))

    expect(store.get(mpFindBestModelAtom)).toBe(false)
    expect(store.get(mpFindBestParamsAtom)).toBe(false)
  })

  it('resets trainState to idle and relocks highestUnlocked to 3, replicating the nav-setter side effects it bypasses', () => {
    store.set(mpTrainStateAtom, { status: 'done', progress: 100 })
    store.set(mpHighestUnlockedAtom, 5)

    const { result } = renderApply()
    act(() => result.current.applyRun(ridgeRun()))

    expect(store.get(mpTrainStateAtom)).toEqual({ status: 'idle', progress: 0 })
    expect(store.get(mpHighestUnlockedAtom)).toBe(3)
  })

  it('never RAISES highestUnlocked above its current value', () => {
    store.set(mpHighestUnlockedAtom, 2)

    const { result } = renderApply()
    act(() => result.current.applyRun(ridgeRun()))

    expect(store.get(mpHighestUnlockedAtom)).toBe(2)
  })

  it("cross-algorithm apply switches the form to the run algorithm — never a form showing one algorithm with another's values", () => {
    store.set(mpAlgorithmsAtom, ['svm', 'xgboost'])
    store.set(mpAlgorithmAtom, 'svm')

    const { result } = renderApply()
    act(() => result.current.applyRun(ridgeRun()))

    expect(store.get(mpAlgorithmsAtom)).toEqual(['ridge'])
    expect(store.get(mpAlgorithmAtom)).toBe('ridge')
    expect(store.get(mpHyperparamsAtom)).toEqual({ alpha: 0.037 })
  })

  it('drops a non-scalar legacy hyperparameter and reports it, rather than writing invalid state', () => {
    const { result } = renderApply()
    let outcome: { dropped: string[] } | undefined

    act(() => {
      outcome = result.current.applyRun(
        ridgeRun({ hyperparameters: { alpha: 0.5, weird: { nested: true } } }),
      )
    })

    expect(outcome?.dropped).toEqual(['weird'])
    expect(store.get(mpHyperparamsAtom)).toEqual({ alpha: 0.5 })
  })
})
