import { useCallback, useMemo } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useModels } from '@/hooks/workspace/use-models'
import type { SavedDataset } from '@/store/datasets'
import {
  MP_TOTAL_STEPS,
  mpCurrentStepAtom,
  mpHighestUnlockedAtom,
  mpNameAtom,
  mpWorkspaceIdAtom,
  mpPlantIdAtom,
  mpNodeIdAtom,
  mpEditModelIdAtom,
  mpSelectedDatasetAtom,
  mpAlgorithmAtom,
  mpAlgorithmsAtom,
  mpFindBestModelAtom,
  mpFindBestParamsAtom,
  mpTargetVariableAtom,
  mpHyperparamsAtom,
  mpTrainStateAtom,
  mpCreatedModelIdAtom,
  mpSelectedMetricsAtom,
  mpLossFunctionAtom,
  mpTrainTestSplitAtom,
  mpSeedAtom,
  mpNSplitsAtom,
  mpAutoRetrainAtom,
  mpRetrainWarnSdAtom,
  mpRetrainCriticalSdAtom,
  mpDriftMonitorAtom,
  mpDriftThresholdPctAtom,
  mpServerDraftIdAtom,
  type Algorithm,
  type HyperparamValue,
} from '@/store/model-pipeline'
import { defaultHyperparams } from '@/lib/training-config'

export interface UsePipelineNavResult {
  currentStep: number
  highestUnlocked: number
  nameConflict: boolean
  selectedDataset: SavedDataset | null
  algorithm: Algorithm
  algorithms: Algorithm[]
  findBestModel: boolean
  findBestParams: boolean
  targetVariables: string[]
  hyperparameters: Record<string, HyperparamValue>
  lossFunction: string
  trainTestSplit: number
  /** MODEL-FLOW-014-T07. `undefined` means the user has not chosen one —
   * the server generates its own when omitted. */
  seed: number | undefined
  /** MODEL-FLOW-016-T10. `undefined` means Cross-Validation is off — see
   * `mpNSplitsAtom`'s own doc comment for the full contract. */
  nSplits: number | undefined
  autoRetrain: boolean
  warnSd: number
  criticalSd: number
  driftMonitor: boolean
  driftThresholdPct: number
  goTo: (step: number) => void
  next: () => void
  back: () => void
  canAdvance: (step: number) => boolean
  setSelectedDataset: (dataset: SavedDataset | null) => void
  setAutoRetrain: (on: boolean) => void
  setWarnSd: (sd: number) => void
  setCriticalSd: (sd: number) => void
  setDriftMonitor: (on: boolean) => void
  setDriftThresholdPct: (pct: number) => void
  resetPipeline: () => void
}

/**
 * Wizard navigation + cascade invalidation for the 6-step Create Model flow
 * (MODEL-FLOW-013 renumbering — was 5 steps before Model Selection was
 * inserted): 1 Select Dataset (+ metadata) · 2 Dataset Review
 * (MODEL-FLOW-010) · 3 Training Configuration · 4 Model Selection
 * (MODEL-FLOW-013) · 5 Evaluation · 6 Save Model. All ETL (data source,
 * tags, raw fetch, cleansing) now lives in Data Studio — this hook only
 * tracks which `Dataset` was picked, review having no config of its own,
 * and the training config.
 */
export function useModelPipelineNav(): UsePipelineNavResult {
  const [currentStep, setCurrentStep] = useAtom(mpCurrentStepAtom)
  const [highestUnlocked, setHighestUnlocked] = useAtom(mpHighestUnlockedAtom)

  const name = useAtomValue(mpNameAtom)
  const workspaceId = useAtomValue(mpWorkspaceIdAtom)
  const plantId = useAtomValue(mpPlantIdAtom)
  const nodeId = useAtomValue(mpNodeIdAtom)
  const editModelId = useAtomValue(mpEditModelIdAtom)
  const { data: workspaceModels } = useModels(workspaceId || null)
  const nameConflict = useMemo(() => {
    if (!workspaceModels) return false
    const trimmed = name.trim().toLowerCase()
    if (!trimmed) return false
    return workspaceModels.some(
      m => m.id !== editModelId && m.name.trim().toLowerCase() === trimmed,
    )
  }, [workspaceModels, name, editModelId])

  const [selectedDataset, setSelectedDatasetAtom] = useAtom(
    mpSelectedDatasetAtom,
  )
  const [algorithm, setAlgorithmAtom] = useAtom(mpAlgorithmAtom)
  const [algorithms, setAlgorithmsAtom] = useAtom(mpAlgorithmsAtom)
  const [findBestModel, setFindBestModelAtom] = useAtom(mpFindBestModelAtom)
  const [findBestParams, setFindBestParamsAtom] = useAtom(mpFindBestParamsAtom)
  const [targetVariables, setTargetVariableAtom] = useAtom(mpTargetVariableAtom)
  const [hyperparameters, setHyperparametersAtom] = useAtom(mpHyperparamsAtom)
  const [lossFunction, setLossFunctionAtom] = useAtom(mpLossFunctionAtom)
  const [trainTestSplit, setTrainTestSplitAtom] = useAtom(mpTrainTestSplitAtom)
  const [seed, setSeedAtom] = useAtom(mpSeedAtom)
  const [nSplits, setNSplitsAtom] = useAtom(mpNSplitsAtom)
  const [autoRetrain, setAutoRetrainAtom] = useAtom(mpAutoRetrainAtom)
  const [warnSd, setWarnSdAtom] = useAtom(mpRetrainWarnSdAtom)
  const [criticalSd, setCriticalSdAtom] = useAtom(mpRetrainCriticalSdAtom)
  const [driftMonitor, setDriftMonitorAtom] = useAtom(mpDriftMonitorAtom)
  const [driftThresholdPct, setDriftThresholdPctAtom] = useAtom(
    mpDriftThresholdPctAtom,
  )
  const trainState = useAtomValue(mpTrainStateAtom)
  const setTrainState = useSetAtom(mpTrainStateAtom)
  const setCreatedModelId = useSetAtom(mpCreatedModelIdAtom)
  const setSelectedMetrics = useSetAtom(mpSelectedMetricsAtom)
  const setServerDraftId = useSetAtom(mpServerDraftIdAtom)

  const resetTraining = useCallback(() => {
    setTrainState({ status: 'idle', progress: 0 })
  }, [setTrainState])

  const canAdvance = useCallback(
    (step: number): boolean => {
      switch (step) {
        case 1:
          return (
            name.trim() !== '' &&
            workspaceId !== '' &&
            plantId !== '' &&
            nodeId !== '' &&
            !nameConflict &&
            selectedDataset !== null
          )
        case 2:
          // Dataset Review configures nothing of its own — it only requires
          // that Step 1's own gate (dataset selected, above) already passed.
          return selectedDataset !== null
        case 3:
          return trainState.status === 'done'
        case 4:
          // Model Selection (MODEL-FLOW-013): same gate as case 3 by
          // design — canAdvance(3) already required trainState 'done' to
          // REACH this step, and re-checking it here is what stops a user
          // who went back and retriggered a training/sweep that then
          // FAILED from advancing past a step that's now showing a failed
          // run. What differs candidate-by-candidate (a sweep vs. a single
          // run, a selection vs. the metric's default) is Step 4's own
          // content, not this gate.
          return trainState.status === 'done'
        case 5:
          // Evaluation — configures nothing of its own, same as the old
          // (pre-MODEL-FLOW-013) case 4.
          return true
        case 6:
          return false
        default:
          return false
      }
    },
    [
      name,
      workspaceId,
      plantId,
      nodeId,
      nameConflict,
      selectedDataset,
      trainState,
    ],
  )

  const goTo = useCallback(
    (step: number) => {
      if (step < 1 || step > MP_TOTAL_STEPS) return
      if (step > highestUnlocked) return
      setCurrentStep(step)
    },
    [highestUnlocked, setCurrentStep],
  )

  const next = useCallback(() => {
    if (!canAdvance(currentStep)) return
    const target = Math.min(currentStep + 1, MP_TOTAL_STEPS)
    setCurrentStep(target)
    setHighestUnlocked(prev => Math.max(prev, target))
  }, [canAdvance, currentStep, setCurrentStep, setHighestUnlocked])

  const back = useCallback(() => {
    setCurrentStep(prev => Math.max(1, prev - 1))
  }, [setCurrentStep])

  // Picking a different dataset invalidates any training run + relocks step 3.
  const setSelectedDataset = useCallback(
    (dataset: SavedDataset | null) => {
      setSelectedDatasetAtom(dataset)
      setTargetVariableAtom([])
      resetTraining()
      setHighestUnlocked(prev => Math.min(prev, 1))
    },
    [
      setSelectedDatasetAtom,
      setTargetVariableAtom,
      resetTraining,
      setHighestUnlocked,
    ],
  )

  // MODEL-FLOW-014-T08: the per-field relock setters that used to live here
  // (setAlgorithm, setAlgorithms, setFindBestModel, setFindBestParams,
  // setFetchTagOverride, setTargetVariable, setHyperparameter,
  // setLossFunction, setTrainTestSplit, setSeed) are gone — Step 3 now
  // edits a local draft (`useRunConfigDraft`) and commits all nine fields
  // in one Apply via `useCommitRunConfig`, which performs the same
  // resetTraining + relock this file used to duplicate nine times.
  // `setAlgorithmAtom`/`setAlgorithmsAtom`/etc above stay: `resetPipeline`
  // below still writes them directly, and their VALUES (`algorithm`,
  // `algorithms`, …) are still read off this hook by `useRunConfigDraft`
  // as the committed snapshot.

  // Deploy step (Step 6) — last step, so no `highestUnlocked` relock.
  const setAutoRetrain = useCallback(
    (on: boolean) => setAutoRetrainAtom(on),
    [setAutoRetrainAtom],
  )
  // Enforce the 2-layer invariant: Layer 1 (warn) stays ≥0.5 SD below Layer 2.
  const setWarnSd = useCallback(
    (sd: number) => setWarnSdAtom(Math.min(sd, criticalSd - 0.5)),
    [setWarnSdAtom, criticalSd],
  )
  const setCriticalSd = useCallback(
    (sd: number) => setCriticalSdAtom(Math.max(sd, warnSd + 0.5)),
    [setCriticalSdAtom, warnSd],
  )
  const setDriftMonitor = useCallback(
    (on: boolean) => setDriftMonitorAtom(on),
    [setDriftMonitorAtom],
  )
  const setDriftThresholdPct = useCallback(
    (pct: number) =>
      setDriftThresholdPctAtom(
        Number.isNaN(pct) ? 0 : Math.min(100, Math.max(0, pct)),
      ),
    [setDriftThresholdPctAtom],
  )

  const resetPipeline = useCallback(() => {
    setSelectedDatasetAtom(null)
    setAlgorithmAtom('ols')
    setAlgorithmsAtom(['ols'])
    setFindBestModelAtom(false)
    setFindBestParamsAtom(false)
    setTargetVariableAtom([])
    setHyperparametersAtom(defaultHyperparams('ols'))
    // MODEL-FLOW-012: was 'rmse', diverging from mpLossFunctionAtom's own
    // default and resetWizardAtom's 'mse' — this fired on every
    // workspace/plant change (use-create-model.ts) and silently flipped the
    // displayed loss function.
    setLossFunctionAtom('mse')
    setTrainTestSplitAtom(80)
    setSeedAtom(undefined)
    setNSplitsAtom(undefined)
    setTrainState({ status: 'idle', progress: 0 })
    setCreatedModelId('')
    setSelectedMetrics(['r2', 'rmse', 'sd'])
    setAutoRetrainAtom(false)
    setWarnSdAtom(1.5)
    setCriticalSdAtom(3.0)
    setDriftMonitorAtom(false)
    setDriftThresholdPctAtom(10)
    setHighestUnlocked(1)
    setCurrentStep(1)
    // Server-side ModelDraft id — fires on every workspace/plant change
    // (use-create-model.ts), so a draft keyed to the OLD workspace must
    // not survive; the next meaningful edit creates a fresh one.
    setServerDraftId(null)
  }, [
    setSelectedDatasetAtom,
    setAlgorithmAtom,
    setAlgorithmsAtom,
    setFindBestModelAtom,
    setFindBestParamsAtom,
    setTargetVariableAtom,
    setHyperparametersAtom,
    setLossFunctionAtom,
    setTrainTestSplitAtom,
    setSeedAtom,
    setNSplitsAtom,
    setTrainState,
    setCreatedModelId,
    setSelectedMetrics,
    setAutoRetrainAtom,
    setWarnSdAtom,
    setCriticalSdAtom,
    setDriftMonitorAtom,
    setDriftThresholdPctAtom,
    setHighestUnlocked,
    setCurrentStep,
    setServerDraftId,
  ])

  return {
    currentStep,
    highestUnlocked,
    nameConflict,
    selectedDataset,
    algorithm,
    algorithms,
    findBestModel,
    findBestParams,
    targetVariables,
    hyperparameters,
    lossFunction,
    trainTestSplit,
    seed,
    nSplits,
    autoRetrain,
    warnSd,
    criticalSd,
    driftMonitor,
    driftThresholdPct,
    goTo,
    next,
    back,
    canAdvance,
    setSelectedDataset,
    setAutoRetrain,
    setWarnSd,
    setCriticalSd,
    setDriftMonitor,
    setDriftThresholdPct,
    resetPipeline,
  }
}
