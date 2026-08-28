'use client'

import { useCallback } from 'react'
import { useSetAtom } from 'jotai'
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
  type Algorithm,
} from '@/store/model-pipeline'
import type { ModelTrainingRunListItem } from '@/services/model-draft'
import { splitPercentFromRun, toApplyPatch } from '@/lib/run-params'

export interface UseApplyRunParamsResult {
  applyRun: (run: ModelTrainingRunListItem) => { dropped: string[] }
}

/**
 * MODEL-FLOW-012-T06/T07/T08 — Apply, written entirely through RAW atom
 * setters. Deliberately does NOT import `useModelPipelineNav`:
 * `setAlgorithm` there overwrites hyperparameters with that algorithm's
 * clean defaults (`use-model-pipeline-nav.ts:206-221`), which would erase
 * the very values this hook exists to apply.
 *
 * Because it bypasses the nav hook, it must replicate the two side effects
 * that live INSIDE every nav setter, or Apply leaves a stale `trainState`
 * ('done') and later steps unlocked beside freshly-applied parameters that
 * do not match what is on screen at Step 4+:
 *   - resetTraining()                              -> trainState idle
 *   - setHighestUnlocked(prev => Math.min(prev, 3)) -> relock to Training Config
 *
 * Cross-algorithm Apply SWITCHES the form to the run's algorithm (decided
 * 2026-08-27) rather than refusing — run-create itself requires exactly one
 * algorithm selected with both AutoML toggles off
 * (`use-model-training.ts:216-233`), so `mpAlgorithmsAtom` is written, not
 * just the mirrored `mpAlgorithmAtom`, and both AutoML atoms are forced off
 * so the applied hyperparameters are the ones `showHyperparams` reveals
 * (`phase-3-training-config.tsx:40`) instead of being applied invisibly.
 */
export function useApplyRunParams(): UseApplyRunParamsResult {
  const setAlgorithm = useSetAtom(mpAlgorithmAtom)
  const setAlgorithms = useSetAtom(mpAlgorithmsAtom)
  const setFindBestModel = useSetAtom(mpFindBestModelAtom)
  const setFindBestParams = useSetAtom(mpFindBestParamsAtom)
  const setHyperparameters = useSetAtom(mpHyperparamsAtom)
  const setTargetVariable = useSetAtom(mpTargetVariableAtom)
  const setTrainTestSplit = useSetAtom(mpTrainTestSplitAtom)
  const setTrainState = useSetAtom(mpTrainStateAtom)
  const setHighestUnlocked = useSetAtom(mpHighestUnlockedAtom)

  const applyRun = useCallback(
    (run: ModelTrainingRunListItem) => {
      const { hyperparameters, dropped } = toApplyPatch(run)
      const algorithm = run.algorithm as Algorithm

      setAlgorithms([algorithm])
      setAlgorithm(algorithm)
      setHyperparameters(hyperparameters)
      setTargetVariable([run.targetY])
      setTrainTestSplit(splitPercentFromRun(run.splitSpec))
      setFindBestModel(false)
      setFindBestParams(false)

      // Replicated nav-setter side effects — see doc comment above.
      setTrainState({ status: 'idle', progress: 0 })
      setHighestUnlocked(prev => Math.min(prev, 3))

      return { dropped }
    },
    [
      setAlgorithm,
      setAlgorithms,
      setFindBestModel,
      setFindBestParams,
      setHighestUnlocked,
      setHyperparameters,
      setTargetVariable,
      setTrainState,
      setTrainTestSplit,
    ],
  )

  return { applyRun }
}
