'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { getModels } from '@/services/model'
import { readModelConfig } from '@/lib/model-config'
import { buildRawDataset } from '@/lib/preprocessing'
import { METRIC_KEYS, type MetricKey } from '@/lib/model-metrics'
import type { AIModel } from '@/types'
import {
  PERIOD_TO_RANGE,
  MP_TOTAL_STEPS,
  mpNameAtom,
  mpDescriptionAtom,
  mpPlantIdAtom,
  mpNodeIdAtom,
  mpSavedDataSourcesAtom,
  mpSelectedSavedSourceIdAtom,
  mpSelectedTagsAtom,
  mpTimeRangeAtom,
  mpCustomDateRangeAtom,
  mpFillStrategiesAtom,
  mpSelectedMetricsAtom,
  mpRawDatasetAtom,
  mpFetchStateAtom,
  mpTrainStateAtom,
  mpHighestUnlockedAtom,
  type FetchPeriod,
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
  const setSavedSources = useSetAtom(mpSavedDataSourcesAtom)
  const setSavedSourceId = useSetAtom(mpSelectedSavedSourceIdAtom)
  const setSelectedTags = useSetAtom(mpSelectedTagsAtom)
  const setTimeRange = useSetAtom(mpTimeRangeAtom)
  const setCustomRange = useSetAtom(mpCustomDateRangeAtom)
  const setFillStrategies = useSetAtom(mpFillStrategiesAtom)
  const setSelectedMetrics = useSetAtom(mpSelectedMetricsAtom)
  const setRawDataset = useSetAtom(mpRawDatasetAtom)
  const setFetchState = useSetAtom(mpFetchStateAtom)
  const setTrainState = useSetAtom(mpTrainStateAtom)
  const setHighestUnlocked = useSetAtom(mpHighestUnlockedAtom)

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

      const merged = config.dataSource ? [config.dataSource] : []
      setSavedSources(merged)
      setSavedSourceId(config.savedSourceId)
      setSelectedTags(config.selectedTags)
      setTimeRange(config.timeRange)
      setCustomRange(config.customDateRange)
      setFillStrategies(config.fillStrategies)
      setSelectedMetrics(
        config.selectedMetrics ?? ([...METRIC_KEYS] as MetricKey[]),
      )

      if (config.selectedTags.length > 0) {
        const range = PERIOD_TO_RANGE[config.timeRange as FetchPeriod]
        setRawDataset(buildRawDataset(config.selectedTags, range))
        setFetchState({ status: 'done', progress: 100 })
        setTrainState({ status: 'done', progress: 100 })
        setHighestUnlocked(MP_TOTAL_STEPS)
      }

      toast.success(`Cloned configuration from "${source.name}"`)
    },
    [
      models,
      setName,
      setPlantId,
      setNodeId,
      setDescription,
      setSavedSources,
      setSavedSourceId,
      setSelectedTags,
      setTimeRange,
      setCustomRange,
      setFillStrategies,
      setSelectedMetrics,
      setRawDataset,
      setFetchState,
      setTrainState,
      setHighestUnlocked,
    ],
  )

  return { models, loading, applyPreset }
}
