'use client'

import { useCallback } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { updateModel } from '@/services/model'
import { modelDraftService } from '@/services/model-draft'
import { buildModelConfig } from '@/lib/model-config'
import {
  mpNameAtom,
  mpDescriptionAtom,
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
  mpServerDraftIdAtom,
} from '@/store/model-pipeline'

/**
 * Single persistence path for the wizard, shared by Phase-6 "Save Model" /
 * "Save & Deploy" and edit mode's "Save Changes":
 * - edit mode → unchanged, `updateModel(editModelId, … config)` — editing an
 *   already-saved Model is a different, already-correct path this feature
 *   (MODEL-FLOW-007) does not touch.
 * - create mode → `POST /model-drafts/:draftId/save` (`saveDraftService`),
 *   the ONLY route allowed to create the final persistent Model (CLAUDE.md
 *   §13). Config (algorithm/hyperparameters/target/split) is derived
 *   SERVER-SIDE from the draft's adopted training run, not sent from here —
 *   this is what MODEL-FLOW-007 fixes: the old client-jotai-derived config
 *   could drift from what actually trained, and never referenced a draft or
 *   run at all. `mpCreatedModelIdAtom` still short-circuits a re-invocation
 *   within the same wizard visit (defensive — both Save buttons already
 *   disable each other while a save is in flight and navigate away on
 *   success, so this should not be reachable in normal use).
 * Returns the persisted model id, or throws on failure (see phase-6-deploy's
 * own catch for how that is surfaced).
 */
export function useModelCommit(): () => Promise<string | null> {
  const mode = useAtomValue(mpModeAtom)
  const editModelId = useAtomValue(mpEditModelIdAtom)
  const [createdModelId, setCreatedModelId] = useAtom(mpCreatedModelIdAtom)
  const draftId = useAtomValue(mpServerDraftIdAtom)
  const name = useAtomValue(mpNameAtom)
  const description = useAtomValue(mpDescriptionAtom)
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
    if (mode === 'edit') {
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
      await updateModel(editModelId, {
        name: name.trim(),
        nodeId: nodeId || null,
        datasetId: dataset?.id ?? null,
        config,
      })
      return editModelId
    }

    if (createdModelId) return createdModelId

    if (!draftId) {
      throw new Error('No active model draft to save — start over from Step 1.')
    }

    const res = await modelDraftService.save(draftId, {
      name: name.trim(),
      nodeId: nodeId || undefined,
      description: description || undefined,
    })
    setCreatedModelId(res.data.id)
    return res.data.id
  }, [
    mode,
    editModelId,
    createdModelId,
    draftId,
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
