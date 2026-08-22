'use client'

import { useCallback, useState } from 'react'
import { useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { datasetService } from '@/services/dataset'
import { modelDraftService, type ModelDraft } from '@/services/model-draft'
import {
  asHyperparams,
  isAlgorithm,
  reconcileTarget,
  splitRatioToPercent,
} from '@/lib/model-draft-hydration'
import {
  resetWizardAtom,
  mpAlgorithmAtom,
  mpAlgorithmsAtom,
  mpCurrentStepAtom,
  mpHighestUnlockedAtom,
  mpHyperparamsAtom,
  mpNameAtom,
  mpNodeIdAtom,
  mpPlantIdAtom,
  mpSelectedDatasetAtom,
  mpServerDraftIdAtom,
  mpTargetVariableAtom,
  mpTrainTestSplitAtom,
  mpWorkspaceIdAtom,
} from '@/store/model-pipeline'

/**
 * Says exactly what a resumed draft brings back and what it does not. The row
 * has no column for description, metrics or deploy settings, so promising a
 * full restore would be a lie the user only discovers at Save Model.
 */
export const RESUME_MESSAGE =
  'Draft restored: dataset, target, algorithm and split. Description, metrics ' +
  'and deploy settings are not stored in a draft — re-enter them before saving.'

export interface UseModelDraftResumeResult {
  resuming: boolean
  /** Resolves false when the draft could not be loaded at all. */
  resume: (draftId: string) => Promise<boolean>
}

/**
 * Restores a server-side `ModelDraft` into the wizard's `mp*` atoms
 * (MODEL-FLOW-010-T08).
 *
 * Extracted from `useModelWizardMode`'s mount effect because there are now TWO
 * entries and only one of them is a navigation: `?draftId=` on a cold mount,
 * and the Drafts-in-progress list inside Step 1. The second cannot navigate —
 * it is already on `/models/create`, so pushing a query string would change
 * the URL while `useModelWizardMode`'s run-once effect ignored it, and nothing
 * would happen. It hydrates in place instead.
 *
 * Failure does NOT navigate here. The URL caller sends the user back to the
 * models list; the in-wizard caller leaves them where they are, because
 * nothing was lost. Each decides for itself.
 */
export function useModelDraftResume(): UseModelDraftResumeResult {
  const reset = useSetAtom(resetWizardAtom)
  const setServerDraftId = useSetAtom(mpServerDraftIdAtom)
  const setName = useSetAtom(mpNameAtom)
  const setWorkspaceId = useSetAtom(mpWorkspaceIdAtom)
  const setPlantId = useSetAtom(mpPlantIdAtom)
  const setNodeId = useSetAtom(mpNodeIdAtom)
  const setSelectedDataset = useSetAtom(mpSelectedDatasetAtom)
  const setAlgorithm = useSetAtom(mpAlgorithmAtom)
  const setAlgorithms = useSetAtom(mpAlgorithmsAtom)
  const setTargetVariable = useSetAtom(mpTargetVariableAtom)
  const setHyperparams = useSetAtom(mpHyperparamsAtom)
  const setTrainTestSplit = useSetAtom(mpTrainTestSplitAtom)
  const setCurrentStep = useSetAtom(mpCurrentStepAtom)
  const setHighestUnlocked = useSetAtom(mpHighestUnlockedAtom)

  const [resuming, setResuming] = useState(false)

  /**
   * Raw atom setters throughout, never `useModelPipelineNav`'s: every one of
   * those calls `resetTraining()` and relocks `highestUnlocked`, and
   * `setAlgorithm` additionally overwrites hyperparameters with that
   * algorithm's defaults — so hydrating through it would discard the stored
   * hyperparameters a line later.
   */
  const hydrate = useCallback(
    (draft: ModelDraft) => {
      setServerDraftId(draft.id)
      if (draft.name) setName(draft.name)
      setWorkspaceId(draft.workspaceId)
      setPlantId(draft.plantId ?? '')
      setNodeId(draft.nodeId ?? '')

      if (draft.algorithm !== null && isAlgorithm(draft.algorithm)) {
        setAlgorithm(draft.algorithm)
        // `algorithms[]` has no column: a draft carries the one algorithm it
        // was configured with, never a restored multi-select.
        setAlgorithms([draft.algorithm])
      }
      setHyperparams(asHyperparams(draft.hyperparameters))
      setTrainTestSplit(splitRatioToPercent(draft.splitRatio))

      // Land on Step 1 so the restored choices are seen and confirmed before
      // anything is configured on top of them.
      setCurrentStep(1)
    },
    [
      setServerDraftId,
      setName,
      setWorkspaceId,
      setPlantId,
      setNodeId,
      setAlgorithm,
      setAlgorithms,
      setHyperparams,
      setTrainTestSplit,
      setCurrentStep,
    ],
  )

  const resume = useCallback(
    async (draftId: string): Promise<boolean> => {
      setResuming(true)
      try {
        const res = await modelDraftService.get(draftId)
        const draft = res.data

        // Clear first, always: the fields a draft has no column for
        // (description, metrics, deploy config) must not survive from whatever
        // was on screen a moment ago and read as part of the restored draft.
        reset()
        hydrate(draft)

        if (!draft.datasetId) {
          setTargetVariable(draft.targetY ? [draft.targetY] : [])
          toast.success(RESUME_MESSAGE)
          return true
        }

        // Re-reading the dataset IS the reconciliation: every artifact-keyed
        // hook in the review step is keyed on (datasetId, artifactId), so a
        // `currentArtifactId` moved by an edit is a new cache key and the stale
        // panels cannot survive it. No separate invalidation needed.
        try {
          const dataset = await datasetService.get(draft.datasetId)
          setSelectedDataset(dataset.data)
          const { targets, droppedTarget } = reconcileTarget(
            draft.targetY,
            dataset.data.tags,
          )
          setTargetVariable(targets)
          // Only Step 2 (Dataset Review) is genuinely reachable: no training
          // result is restored, so unlocking past it would offer an Evaluation
          // step with nothing in it.
          setHighestUnlocked(2)
          if (droppedTarget) {
            toast.warning(
              `Target “${droppedTarget}” is no longer in this dataset — pick a new one in Training Config.`,
            )
          } else {
            toast.success(RESUME_MESSAGE)
          }
        } catch {
          // The dataset id stays valid across an edit, so a failure here is a
          // load failure, not a deletion — say that instead of clearing it.
          setTargetVariable([])
          toast.warning(
            'Draft restored, but its dataset could not be loaded — re-select it at Step 1.',
          )
        }
        return true
      } catch {
        toast.error('Draft not found — it may have been saved or abandoned.')
        return false
      } finally {
        setResuming(false)
      }
    },
    [reset, hydrate, setTargetVariable, setSelectedDataset, setHighestUnlocked],
  )

  return { resuming, resume }
}
