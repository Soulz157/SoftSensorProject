'use client'

import { useCallback } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { createModel, updateModel } from '@/services/model'
import { buildModelConfig } from '@/lib/model-config'
import {
  mpNameAtom,
  mpDescriptionAtom,
  mpWorkspaceIdAtom,
  mpNodeIdAtom,
  mpModeAtom,
  mpEditModelIdAtom,
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
  mpCreatedModelIdAtom,
} from '@/store/model-pipeline'

/**
 * Single persistence path for the wizard, shared by Phase-5 training and the
 * Phase-6 "Save Changes" action so the model + its config are written exactly
 * one way:
 * - edit mode → `updateModel(editModelId, … config)`.
 * - create mode → first commit `createModel(… config)` (records the new id);
 *   later commits `updateModel(createdModelId, … config)` — never a duplicate row.
 * Returns the persisted model id, or null on failure.
 */
export function useModelCommit(): () => Promise<string | null> {
  const mode = useAtomValue(mpModeAtom)
  const editModelId = useAtomValue(mpEditModelIdAtom)
  const [createdModelId, setCreatedModelId] = useAtom(mpCreatedModelIdAtom)
  const name = useAtomValue(mpNameAtom)
  const description = useAtomValue(mpDescriptionAtom)
  const workspaceId = useAtomValue(mpWorkspaceIdAtom)
  const nodeId = useAtomValue(mpNodeIdAtom)
  const dataset = useAtomValue(mpSelectedDatasetAtom)
  const algorithm = useAtomValue(mpAlgorithmAtom)
  const algorithms = useAtomValue(mpAlgorithmsAtom)
  const findBestModel = useAtomValue(mpFindBestModelAtom)
  const findBestParams = useAtomValue(mpFindBestParamsAtom)
  const targetVariables = useAtomValue(mpTargetVariableAtom)
  const hyperparameters = useAtomValue(mpHyperparamsAtom)
  const lossFunction = useAtomValue(mpLossFunctionAtom)
  const trainTestSplit = useAtomValue(mpTrainTestSplitAtom)
  const selectedMetrics = useAtomValue(mpSelectedMetricsAtom)

  return useCallback(async (): Promise<string | null> => {
    const config = buildModelConfig({
      description,
      datasetId: dataset?.id ?? '',
      algorithm,
      algorithms,
      findBestModel,
      findBestParams,
      targetVariables,
      hyperparameters,
      lossFunction,
      trainTestSplit,
      selectedMetrics,
    })

    if (mode === 'edit') {
      await updateModel(editModelId, {
        name: name.trim(),
        nodeId: nodeId || null,
        datasetId: dataset?.id ?? null,
        config,
      })
      return editModelId
    }

    if (!createdModelId) {
      const model = await createModel({
        workspaceId,
        name: name.trim(),
        nodeId: nodeId || undefined,
        datasetId: dataset?.id,
        config,
      })
      setCreatedModelId(model.id)
      return model.id
    }

    await updateModel(createdModelId, {
      name: name.trim(),
      nodeId: nodeId || null,
      datasetId: dataset?.id ?? null,
      config,
    })
    return createdModelId
  }, [
    mode,
    editModelId,
    createdModelId,
    workspaceId,
    name,
    nodeId,
    description,
    dataset,
    algorithm,
    algorithms,
    findBestModel,
    findBestParams,
    hyperparameters,
    lossFunction,
    trainTestSplit,
    selectedMetrics,
    targetVariables,
    setCreatedModelId,
  ])
}
