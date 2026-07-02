'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { getModelById } from '@/services/model'
import { readModelConfig } from '@/lib/model-config'
import { buildRawDataset } from '@/lib/preprocessing'
import { METRIC_KEYS, type MetricKey } from '@/lib/model-metrics'
import type { AIModel } from '@/types'
import {
  PERIOD_TO_RANGE,
  resetWizardAtom,
  mpModeAtom,
  mpEditModelIdAtom,
  mpNameAtom,
  mpDescriptionAtom,
  mpWorkspaceIdAtom,
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
  mpCurrentStepAtom,
  mpHighestUnlockedAtom,
  MP_TOTAL_STEPS,
  type FetchPeriod,
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

        // Rebuild the deterministic dataset so Phases 3/5/6 render immediately.
        // Only then unlock every step for free review/jump; without a full
        // config the model is edited as a normal forward pass from step 1.
        if (config.selectedTags.length > 0) {
          const range = PERIOD_TO_RANGE[config.timeRange as FetchPeriod]
          setRawDataset(buildRawDataset(config.selectedTags, range))
          setFetchState({ status: 'done', progress: 100 })
          setTrainState({ status: 'done', progress: 100 })
          setHighestUnlocked(MP_TOTAL_STEPS)
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
