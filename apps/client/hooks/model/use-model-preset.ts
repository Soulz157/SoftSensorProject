'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { getModels } from '@/services/model'
import { datasetService } from '@/services/dataset'
import { readModelConfig, configTargets } from '@/lib/model-config'
import { METRIC_KEYS, type MetricKey } from '@/lib/model-metrics'
import type { AIModel } from '@/types'
import {
  mpNameAtom,
  mpDescriptionAtom,
  mpPlantIdAtom,
  mpNodeIdAtom,
  mpSelectedDatasetAtom,
  mpAlgorithmAtom,
  mpTargetVariableAtom,
  mpHyperparamsAtom,
  mpLossFunctionAtom,
  mpTrainTestSplitAtom,
  mpSelectedMetricsAtom,
} from '@/store/model-pipeline'

export interface UseModelPresetResult {
  models: AIModel[]
  loading: boolean
  applyPreset: (sourceModelId: string) => void
}

export function useModelPreset(workspaceId: string): UseModelPresetResult {
  const [models, setModels] = useState<AIModel[]>([])
  const [loading, setLoading] = useState(false)

  const setName = useSetAtom(mpNameAtom)
  const setDescription = useSetAtom(mpDescriptionAtom)
  const setPlantId = useSetAtom(mpPlantIdAtom)
  const setNodeId = useSetAtom(mpNodeIdAtom)
  const setSelectedDataset = useSetAtom(mpSelectedDatasetAtom)
  const setAlgorithm = useSetAtom(mpAlgorithmAtom)
  const setTargetVariable = useSetAtom(mpTargetVariableAtom)
  const setHyperparams = useSetAtom(mpHyperparamsAtom)
  const setLossFunction = useSetAtom(mpLossFunctionAtom)
  const setTrainTestSplit = useSetAtom(mpTrainTestSplitAtom)
  const setSelectedMetrics = useSetAtom(mpSelectedMetricsAtom)

  useEffect(() => {
    if (!workspaceId) {
      setModels([])
      return
    }
    let ignore = false
    setLoading(true)
    getModels(workspaceId)
      .then(data => {
        if (!ignore) setModels(data)
      })
      .catch(() => {
        if (!ignore) setModels([])
      })
      .finally(() => {
        if (!ignore) setLoading(false)
      })
    return () => {
      ignore = true
    }
  }, [workspaceId])

  const applyPreset = useCallback(
    (sourceModelId: string) => {
      const source = models.find(m => m.id === sourceModelId)
      if (!source) return
      const config = readModelConfig(source)
      if (!config) {
        toast.error('This model has no saved configuration to clone.')
        return
      }

      // New instance, new location — never carry the source's identity/target.
      setName('')
      setPlantId('')
      setNodeId('')
      setDescription(config.description ?? '')
      setAlgorithm(config.algorithm)
      setTargetVariable(configTargets(config))
      setHyperparams(config.hyperparameters)
      setLossFunction(config.lossFunction ?? 'mse')
      setTrainTestSplit(config.trainTestSplit ?? 80)
      setSelectedMetrics(
        config.selectedMetrics ?? ([...METRIC_KEYS] as MetricKey[]),
      )

      if (config.datasetId) {
        datasetService
          .get(config.datasetId)
          .then(res => setSelectedDataset(res.data))
          .catch(() => setSelectedDataset(null))
      } else {
        setSelectedDataset(null)
      }

      toast.success(`Cloned configuration from "${source.name}"`)
    },
    [
      models,
      setName,
      setPlantId,
      setNodeId,
      setDescription,
      setSelectedDataset,
      setAlgorithm,
      setTargetVariable,
      setHyperparams,
      setLossFunction,
      setTrainTestSplit,
      setSelectedMetrics,
    ],
  )

  return { models, loading, applyPreset }
}
