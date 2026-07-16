'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { getModelById } from '@/services/model'
import { datasetService } from '@/services/dataset'
import { readModelConfig } from '@/lib/model-config'
import { METRIC_KEYS, type MetricKey } from '@/lib/model-metrics'
import type { AIModel } from '@/types'
import {
  resetWizardAtom,
  mpModeAtom,
  mpEditModelIdAtom,
  mpNameAtom,
  mpDescriptionAtom,
  mpWorkspaceIdAtom,
  mpPlantIdAtom,
  mpNodeIdAtom,
  mpSelectedDatasetAtom,
  mpAlgorithmAtom,
  mpTargetVariableAtom,
  mpHyperparamsAtom,
  mpLossFunctionAtom,
  mpTrainTestSplitAtom,
  mpSelectedMetricsAtom,
  mpTrainStateAtom,
  mpCurrentStepAtom,
  mpHighestUnlockedAtom,
  MP_TOTAL_STEPS,
  type WizardMode,
} from '@/store/model-pipeline'

export interface UseModelWizardModeResult {
  mode: WizardMode
  modelName: string
  loading: boolean
}

/**
 * Decides create vs. edit on wizard mount from the URL (`?mode=edit&modelId=…&
 * workspaceId=…`). Edit fetches the model and hydrates every phase atom (Phase-1
 * metadata + Phase 2–4 config + a rebuilt raw dataset so charts/metrics render);
 * create dispatches a full reset so no state leaks from a prior session. Runs
 * exactly once per mount.
 */
export function useModelWizardMode(): UseModelWizardModeResult {
  const params = useSearchParams()
  const router = useRouter()

  const reset = useSetAtom(resetWizardAtom)
  const setMode = useSetAtom(mpModeAtom)
  const setEditModelId = useSetAtom(mpEditModelIdAtom)
  const setName = useSetAtom(mpNameAtom)
  const setDescription = useSetAtom(mpDescriptionAtom)
  const setWorkspaceId = useSetAtom(mpWorkspaceIdAtom)
  const setPlantId = useSetAtom(mpPlantIdAtom)
  const setNodeId = useSetAtom(mpNodeIdAtom)
  const setSelectedDataset = useSetAtom(mpSelectedDatasetAtom)
  const setAlgorithm = useSetAtom(mpAlgorithmAtom)
  const setTargetVariable = useSetAtom(mpTargetVariableAtom)
  const setHyperparams = useSetAtom(mpHyperparamsAtom)
  const setLossFunction = useSetAtom(mpLossFunctionAtom)
  const setTrainTestSplit = useSetAtom(mpTrainTestSplitAtom)
  const setSelectedMetrics = useSetAtom(mpSelectedMetricsAtom)
  const setTrainState = useSetAtom(mpTrainStateAtom)
  const setCurrentStep = useSetAtom(mpCurrentStepAtom)
  const setHighestUnlocked = useSetAtom(mpHighestUnlockedAtom)

  const [mode, setModeState] = useState<WizardMode>('create')
  const [modelName, setModelName] = useState('')
  const [loading, setLoading] = useState(false)
  const ranRef = useRef(false)

  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true

    const urlMode = params.get('mode')
    const modelId = params.get('modelId')
    const workspaceId = params.get('workspaceId')

    if (urlMode !== 'edit' || !modelId || !workspaceId) {
      reset()
      setModeState('create')
      return
    }

    const hydrate = (model: AIModel) => {
      setMode('edit')
      setEditModelId(model.id)
      setName(model.name)
      setWorkspaceId(model.workspaceId)
      setPlantId(model.nodes?.planId ?? '')
      setNodeId(model.nodesId ?? '')

      const config = readModelConfig(model)
      if (config) {
        setDescription(config.description ?? '')
        setAlgorithm(config.algorithm)
        setTargetVariable(config.targetVariable)
        setHyperparams(config.hyperparameters)
        setLossFunction(config.lossFunction ?? 'mse')
        setTrainTestSplit(config.trainTestSplit ?? 80)
        setSelectedMetrics(
          config.selectedMetrics ?? ([...METRIC_KEYS] as MetricKey[]),
        )

        const datasetId = config.datasetId || model.datasetId
        if (datasetId) {
          datasetService
            .get(datasetId)
            .then(res => {
              setSelectedDataset(res.data)
              setTrainState({ status: 'done', progress: 100 })
              setHighestUnlocked(MP_TOTAL_STEPS)
            })
            .catch(() => setSelectedDataset(null))
        }
      }

      setCurrentStep(1)
      setModelName(model.name)
    }

    // Clear any leaked state first so a config-less (legacy) model never shows
    // a prior session's tags/fill rules.
    reset()
    setLoading(true)
    setModeState('edit')
    getModelById(workspaceId, modelId)
      .then(model => {
        if (!model) {
          toast.error('Model not found')
          router.push('/models/views')
          return
        }
        hydrate(model)
      })
      .catch(() => {
        toast.error('Failed to load model for editing')
        router.push('/models/views')
      })
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { mode, modelName, loading }
}
