'use client'

import { useCallback, useState } from 'react'
import { useSetAtom } from 'jotai'
import {
  mpAlgorithmAtom,
  mpAlgorithmsAtom,
  mpFindBestModelAtom,
  mpFindBestParamsAtom,
  mpHyperparamsAtom,
  mpLossFunctionAtom,
  mpSeedAtom,
  mpTargetVariableAtom,
  mpTrainTestSplitAtom,
  type Algorithm,
  type HyperparamValue,
} from '@/store/model-pipeline'
import { defaultHyperparams } from '@/lib/training-config'
import { useCommitRunConfig } from './use-commit-run-config'
import type { UsePipelineNavResult } from './use-model-pipeline-nav'

export interface RunConfigDraft {
  algorithms: Algorithm[]
  findBestModel: boolean
  findBestParams: boolean
  targetVariables: string[]
  hyperparameters: Record<string, HyperparamValue>
  lossFunction: string
  trainTestSplit: number
  seed: number | undefined
}

function committedSnapshot(nav: UsePipelineNavResult): RunConfigDraft {
  return {
    algorithms: nav.algorithms,
    findBestModel: nav.findBestModel,
    findBestParams: nav.findBestParams,
    targetVariables: nav.targetVariables,
    hyperparameters: nav.hyperparameters,
    lossFunction: nav.lossFunction,
    trainTestSplit: nav.trainTestSplit,
    seed: nav.seed,
  }
}

function sameValues<T>(a: T[], b: T[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

function hyperparamsEqual(
  a: Record<string, HyperparamValue>,
  b: Record<string, HyperparamValue>,
): boolean {
  const aKeys = Object.keys(a)
  if (aKeys.length !== Object.keys(b).length) return false
  return aKeys.every(k => a[k] === b[k])
}

function draftsEqual(a: RunConfigDraft, b: RunConfigDraft): boolean {
  return (
    a.findBestModel === b.findBestModel &&
    a.findBestParams === b.findBestParams &&
    a.lossFunction === b.lossFunction &&
    a.trainTestSplit === b.trainTestSplit &&
    a.seed === b.seed &&
    sameValues(a.algorithms, b.algorithms) &&
    sameValues(a.targetVariables, b.targetVariables) &&
    hyperparamsEqual(a.hyperparameters, b.hyperparameters)
  )
}

export interface UseRunConfigDraftResult {
  draft: RunConfigDraft
  /** True whenever `draft` differs from the committed atoms — Start
   * Training must refuse while this is true (MODEL-FLOW-014-T08). */
  dirty: boolean
  setAlgorithms: (algorithms: Algorithm[]) => void
  setFindBestModel: (on: boolean) => void
  setFindBestParams: (on: boolean) => void
  setTargetVariable: (tags: string[]) => void
  setHyperparameter: (key: string, value: HyperparamValue) => void
  setLossFunction: (loss: string) => void
  setTrainTestSplit: (split: number) => void
  setSeed: (seed: number | undefined) => void
  /** Writes `draft` to the committed atoms and relocks (via
   * `useCommitRunConfig`). Does NOT flush the draft-sync PATCH itself —
   * `Phase3TrainingConfig` does that from an effect on the COMMITTED atoms
   * (see its own doc comment for why: a flush called synchronously from
   * here would still be reading the PREVIOUS render's stale values). */
  apply: () => void
  /** Reverts `draft` back to the committed atoms, discarding local edits. */
  discard: () => void
}

/**
 * MODEL-FLOW-014-T08. Step 3's local draft of the nine fields the deleted
 * per-field relock setters in `use-model-pipeline-nav.ts` used to cover
 * (`setAlgorithms`, `setFindBestModel`, `setFindBestParams`,
 * `setTargetVariable`, `setHyperparameter`, `setLossFunction`,
 * `setTrainTestSplit`, `setSeed`, plus the `mpAlgorithmAtom` primary
 * mirror). Controls write here; nothing downstream (trainState,
 * highestUnlocked, the split-stats fetch, the draft-sync PATCH) moves
 * until `apply()` — see `SplitDistributionPanel`, which is deliberately
 * fed the COMMITTED `trainTestSplit`/`algorithms`/`targetVariables` from
 * `nav`, not this draft, so it keeps describing the split that will
 * actually run rather than refetching on every keystroke.
 *
 * Re-seeds from the committed atoms whenever they change — by this hook's
 * own `apply()` OR from OUTSIDE it: the Recall panel's Apply
 * (`useApplyRunParams`) writes the same atoms directly while Step 3 stays
 * mounted, and the draft must reflect that immediately rather than show
 * stale pending edits beside it. Both cases go through the one mechanism
 * below.
 */
export function useRunConfigDraft(
  nav: UsePipelineNavResult,
): UseRunConfigDraftResult {
  const [draft, setDraft] = useState<RunConfigDraft>(() =>
    committedSnapshot(nav),
  )
  // Tracks the committed SNAPSHOT `draft` was last synced FROM — not `nav`
  // itself. `useModelPipelineNav` returns a fresh object literal every
  // render, so storing `nav` would pin a stale *object* whose *fields*
  // only happen to be the right references today; a snapshot's own fields
  // are stable independent of `nav`'s object identity. A plain useEffect
  // re-seed here would fire an extra render pass for something React's own
  // docs cover directly ("Adjusting state when a prop changes"): compare
  // during render and call setState conditionally, which React applies
  // before painting rather than after a committed render. nav's array/
  // object fields are stable references between renders unless their own
  // atom was written (jotai), so this compares by reference cheaply and
  // does not fire on an unrelated re-render.
  const [syncedFrom, setSyncedFrom] = useState(() => committedSnapshot(nav))
  if (
    syncedFrom.algorithms !== nav.algorithms ||
    syncedFrom.findBestModel !== nav.findBestModel ||
    syncedFrom.findBestParams !== nav.findBestParams ||
    syncedFrom.targetVariables !== nav.targetVariables ||
    syncedFrom.hyperparameters !== nav.hyperparameters ||
    syncedFrom.lossFunction !== nav.lossFunction ||
    syncedFrom.trainTestSplit !== nav.trainTestSplit ||
    syncedFrom.seed !== nav.seed
  ) {
    const snapshot = committedSnapshot(nav)
    setSyncedFrom(snapshot)
    setDraft(snapshot)
  }

  const dirty = !draftsEqual(draft, committedSnapshot(nav))

  const setAlgorithms = useCallback((algorithms: Algorithm[]) => {
    const capped = algorithms.slice(0, 3)
    const primary = capped[0] ?? 'ols'
    // Mirrors the deleted nav.setAlgorithms cascade: switching the
    // selection resets hyperparameters to the new primary's clean
    // defaults, in the draft, so the grid never shows a stale key.
    setDraft(prev => ({
      ...prev,
      algorithms: capped,
      hyperparameters: defaultHyperparams(primary),
    }))
  }, [])

  const setFindBestModel = useCallback((on: boolean) => {
    setDraft(prev => ({
      ...prev,
      findBestModel: on,
      // Mirrors the deleted nav.setFindBestModel cascade: Step B requires
      // Step A, so turning A off cascades B off in the draft too.
      findBestParams: on ? prev.findBestParams : false,
    }))
  }, [])

  const setFindBestParams = useCallback((on: boolean) => {
    setDraft(prev => ({ ...prev, findBestParams: on }))
  }, [])

  const setTargetVariable = useCallback((tags: string[]) => {
    setDraft(prev => ({ ...prev, targetVariables: tags }))
  }, [])

  const setHyperparameter = useCallback(
    (key: string, value: HyperparamValue) => {
      setDraft(prev => ({
        ...prev,
        hyperparameters: { ...prev.hyperparameters, [key]: value },
      }))
    },
    [],
  )

  const setLossFunction = useCallback((loss: string) => {
    setDraft(prev => ({ ...prev, lossFunction: loss }))
  }, [])

  const setTrainTestSplit = useCallback((split: number) => {
    setDraft(prev => ({ ...prev, trainTestSplit: split }))
  }, [])

  const setSeed = useCallback((seed: number | undefined) => {
    setDraft(prev => ({ ...prev, seed }))
  }, [])

  const setAlgorithmsAtom = useSetAtom(mpAlgorithmsAtom)
  const setAlgorithmAtom = useSetAtom(mpAlgorithmAtom)
  const setFindBestModelAtom = useSetAtom(mpFindBestModelAtom)
  const setFindBestParamsAtom = useSetAtom(mpFindBestParamsAtom)
  const setTargetVariableAtom = useSetAtom(mpTargetVariableAtom)
  const setHyperparametersAtom = useSetAtom(mpHyperparamsAtom)
  const setLossFunctionAtom = useSetAtom(mpLossFunctionAtom)
  const setTrainTestSplitAtom = useSetAtom(mpTrainTestSplitAtom)
  const setSeedAtom = useSetAtom(mpSeedAtom)
  const commitRunConfig = useCommitRunConfig()

  const apply = useCallback(() => {
    const primary = draft.algorithms[0] ?? 'ols'
    setAlgorithmsAtom(draft.algorithms)
    setAlgorithmAtom(primary)
    setFindBestModelAtom(draft.findBestModel)
    setFindBestParamsAtom(draft.findBestParams)
    setTargetVariableAtom(draft.targetVariables)
    setHyperparametersAtom(draft.hyperparameters)
    setLossFunctionAtom(draft.lossFunction)
    setTrainTestSplitAtom(draft.trainTestSplit)
    setSeedAtom(draft.seed)
    commitRunConfig()
  }, [
    draft,
    setAlgorithmsAtom,
    setAlgorithmAtom,
    setFindBestModelAtom,
    setFindBestParamsAtom,
    setTargetVariableAtom,
    setHyperparametersAtom,
    setLossFunctionAtom,
    setTrainTestSplitAtom,
    setSeedAtom,
    commitRunConfig,
  ])

  const discard = useCallback(() => {
    setDraft(committedSnapshot(nav))
    // committedSnapshot reads nav fresh each call; this is a point-in-time
    // revert, not a subscription — matches the render-time re-seed above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    nav.algorithms,
    nav.findBestModel,
    nav.findBestParams,
    nav.targetVariables,
    nav.hyperparameters,
    nav.lossFunction,
    nav.trainTestSplit,
    nav.seed,
  ])

  return {
    draft,
    dirty,
    setAlgorithms,
    setFindBestModel,
    setFindBestParams,
    setTargetVariable,
    setHyperparameter,
    setLossFunction,
    setTrainTestSplit,
    setSeed,
    apply,
    discard,
  }
}
