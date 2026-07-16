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
  mpTargetVariableAtom,
  mpHyperparamsAtom,
  mpTrainStateAtom,
  mpCreatedModelIdAtom,
  mpSelectedMetricsAtom,
  mpLossFunctionAtom,
  mpTrainTestSplitAtom,
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
  targetVariable: string
  hyperparameters: Record<string, HyperparamValue>
  lossFunction: string
  trainTestSplit: number
  goTo: (step: number) => void
  next: () => void
  back: () => void
  canAdvance: (step: number) => boolean
  setSelectedDataset: (dataset: SavedDataset | null) => void
  setAlgorithm: (algorithm: Algorithm) => void
  setTargetVariable: (tag: string) => void
  setHyperparameter: (key: string, value: HyperparamValue) => void
  setLossFunction: (loss: string) => void
  setTrainTestSplit: (split: number) => void
  setFetchTagOverride: (tag: string) => void
  resetPipeline: () => void
}

/**
 * Wizard navigation + cascade invalidation for the lean 3-step Create Model
 * flow: 1 Select Dataset (+ metadata) · 2 Training Configuration · 3 Results.
 * All ETL (data source, tags, raw fetch, cleansing) now lives in Data Studio —
 * this hook only tracks which `Dataset` was picked and the training config.
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
  const [targetVariable, setTargetVariableAtom] = useAtom(mpTargetVariableAtom)
  const [hyperparameters, setHyperparametersAtom] = useAtom(mpHyperparamsAtom)
  const [lossFunction, setLossFunctionAtom] = useAtom(mpLossFunctionAtom)
  const [trainTestSplit, setTrainTestSplitAtom] = useAtom(mpTrainTestSplitAtom)
  const trainState = useAtomValue(mpTrainStateAtom)
  const setTrainState = useSetAtom(mpTrainStateAtom)
  const setCreatedModelId = useSetAtom(mpCreatedModelIdAtom)
  const setSelectedMetrics = useSetAtom(mpSelectedMetricsAtom)

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
          return trainState.status === 'done'
        case 3:
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
      setTargetVariableAtom('')
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

  // Switching algorithm resets hyperparameters to that algorithm's clean
  // defaults so the persisted record never accumulates keys from prior picks.
  const setAlgorithm = useCallback(
    (value: Algorithm) => {
      setAlgorithmAtom(value)
      setHyperparametersAtom(defaultHyperparams(value))
      resetTraining()
      setHighestUnlocked(prev => Math.min(prev, 2))
    },
    [
      setAlgorithmAtom,
      setHyperparametersAtom,
      resetTraining,
      setHighestUnlocked,
    ],
  )

  const setFetchTagOverride = useCallback(
    (tag: string) => {
      setTargetVariableAtom(tag)
      resetTraining()
      setHighestUnlocked(prev => Math.min(prev, 2))
    },
    [setTargetVariableAtom, resetTraining, setHighestUnlocked],
  )

  const setTargetVariable = useCallback(
    (tag: string) => {
      setTargetVariableAtom(tag)
      resetTraining()
      setHighestUnlocked(prev => Math.min(prev, 2))
    },
    [setTargetVariableAtom, resetTraining, setHighestUnlocked],
  )

  const setHyperparameter = useCallback(
    (key: string, value: HyperparamValue) => {
      setHyperparametersAtom(prev => ({ ...prev, [key]: value }))
      resetTraining()
      setHighestUnlocked(prev => Math.min(prev, 2))
    },
    [setHyperparametersAtom, resetTraining, setHighestUnlocked],
  )

  const setLossFunction = useCallback(
    (loss: string) => {
      setLossFunctionAtom(loss)
      resetTraining()
      setHighestUnlocked(prev => Math.min(prev, 2))
    },
    [setLossFunctionAtom, resetTraining, setHighestUnlocked],
  )

  const setTrainTestSplit = useCallback(
    (split: number) => {
      setTrainTestSplitAtom(split)
      resetTraining()
      setHighestUnlocked(prev => Math.min(prev, 2))
    },
    [setTrainTestSplitAtom, resetTraining, setHighestUnlocked],
  )

  const resetPipeline = useCallback(() => {
    setSelectedDatasetAtom(null)
    setAlgorithmAtom('ols')
    setTargetVariableAtom('')
    setHyperparametersAtom(defaultHyperparams('ols'))
    setLossFunctionAtom('mse')
    setTrainTestSplitAtom(80)
    setTrainState({ status: 'idle', progress: 0 })
    setCreatedModelId('')
    setSelectedMetrics(['r2', 'rmse', 'sd'])
    setHighestUnlocked(1)
    setCurrentStep(1)
  }, [
    setSelectedDatasetAtom,
    setAlgorithmAtom,
    setTargetVariableAtom,
    setHyperparametersAtom,
    setLossFunctionAtom,
    setTrainTestSplitAtom,
    setTrainState,
    setCreatedModelId,
    setSelectedMetrics,
    setHighestUnlocked,
    setCurrentStep,
  ])

  return {
    currentStep,
    highestUnlocked,
    nameConflict,
    selectedDataset,
    algorithm,
    targetVariable,
    hyperparameters,
    lossFunction,
    trainTestSplit,
    goTo,
    next,
    back,
    canAdvance,
    setSelectedDataset,
    setAlgorithm,
    setTargetVariable,
    setHyperparameter,
    setLossFunction,
    setTrainTestSplit,
    setFetchTagOverride,
    resetPipeline,
  }
}
