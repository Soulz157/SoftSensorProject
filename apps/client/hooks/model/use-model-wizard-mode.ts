'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { getModelById } from '@/services/model'
import { datasetService } from '@/services/dataset'
import { useModelDraftResume } from '@/hooks/model/use-model-draft-resume'
import { readModelConfig, configTargets } from '@/lib/model-config'
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
  mpAlgorithmsAtom,
  mpFindBestModelAtom,
  mpFindBestParamsAtom,
  mpTargetVariableAtom,
  mpHyperparamsAtom,
  mpLossFunctionAtom,
  mpTrainTestSplitAtom,
  mpSelectedMetricsAtom,
  mpTrainStateAtom,
  mpCurrentStepAtom,
  mpHighestUnlockedAtom,
  mpAutoRetrainAtom,
  mpRetrainWarnSdAtom,
  mpRetrainCriticalSdAtom,
  mpDriftMonitorAtom,
  mpDriftThresholdPctAtom,
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
 *
 * A third entry, `?draftId=…` (MODEL-FLOW-010-T08), resumes an unfinished
 * server-side `ModelDraft` — the way back after leaving the wizard to edit a
 * dataset. It is a CREATE-mode continuation, not a mode of its own: no `Model`
 * row exists yet, so nothing about the commit path changes. Restore is
 * deliberately PARTIAL, because the row is: `ModelDraft` has no description,
 * no `algorithms[]`, no loss function, no selected metrics and no deploy
 * config, so those come back at their defaults and the toast says so rather
 * than implying parity.
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
  const setAlgorithms = useSetAtom(mpAlgorithmsAtom)
  const setFindBestModel = useSetAtom(mpFindBestModelAtom)
  const setFindBestParams = useSetAtom(mpFindBestParamsAtom)
  const setTargetVariable = useSetAtom(mpTargetVariableAtom)
  const setHyperparams = useSetAtom(mpHyperparamsAtom)
  const setLossFunction = useSetAtom(mpLossFunctionAtom)
  const setTrainTestSplit = useSetAtom(mpTrainTestSplitAtom)
  const setSelectedMetrics = useSetAtom(mpSelectedMetricsAtom)
  const setTrainState = useSetAtom(mpTrainStateAtom)
  const setCurrentStep = useSetAtom(mpCurrentStepAtom)
  const setHighestUnlocked = useSetAtom(mpHighestUnlockedAtom)
  const setAutoRetrain = useSetAtom(mpAutoRetrainAtom)
  const setWarnSd = useSetAtom(mpRetrainWarnSdAtom)
  const setCriticalSd = useSetAtom(mpRetrainCriticalSdAtom)
  const setDriftMonitor = useSetAtom(mpDriftMonitorAtom)
  const setDriftThresholdPct = useSetAtom(mpDriftThresholdPctAtom)

  const { resume } = useModelDraftResume()

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
    const draftId = params.get('draftId')

    if (urlMode !== 'edit' || !modelId || !workspaceId) {
      setModeState('create')
      if (draftId) {
        // `resume` resets the wizard itself before hydrating, so the plain
        // create branch below is the only one that needs its own reset.
        // Unlike the in-wizard Resume button, a bad id in the URL leaves the
        // user on an empty wizard they did not ask for — send them back.
        setLoading(true)
        void resume(draftId)
          .then(ok => {
            if (!ok) router.push('/models/views')
          })
          .finally(() => setLoading(false))
      } else {
        reset()
      }
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
        setAlgorithms(config.algorithms ?? [config.algorithm])
        setFindBestModel(config.findBestModel ?? false)
        setFindBestParams(config.findBestParams ?? false)
        setTargetVariable(configTargets(config))
        setHyperparams(config.hyperparameters)
        setLossFunction(config.lossFunction ?? 'mse')
        setTrainTestSplit(config.trainTestSplit ?? 80)
        setSelectedMetrics(
          config.selectedMetrics ?? ([...METRIC_KEYS] as MetricKey[]),
        )

        // Deploy step (Step 4) — fall back to defaults for legacy configs.
        const deploy = config.deployment
        setAutoRetrain(deploy?.autoRetrain ?? false)
        setWarnSd(deploy?.warnSd ?? 1.5)
        setCriticalSd(deploy?.criticalSd ?? 3.0)
        setDriftMonitor(deploy?.driftMonitor ?? false)
        setDriftThresholdPct(deploy?.driftThresholdPct ?? 10)

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
