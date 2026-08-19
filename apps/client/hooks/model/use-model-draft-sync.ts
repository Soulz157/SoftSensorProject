'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { modelDraftService } from '@/services/model-draft'
import {
  mpWorkspaceIdAtom,
  mpPlantIdAtom,
  mpNodeIdAtom,
  mpNameAtom,
  mpSelectedDatasetAtom,
  mpServerDraftIdAtom,
  mpTargetVariableAtom,
  mpAlgorithmsAtom,
  mpHyperparamsAtom,
  mpTrainTestSplitAtom,
} from '@/store/model-pipeline'

const PATCH_DEBOUNCE_MS = 600

// In-flight dedup, same shape as ensureDraftId/ensureBronzeArtifactId
// (dataset-draft-bronze.ts) — a fast double-mount (StrictMode, or Step 2
// remounting) must issue one POST for a workspace, not two.
const inFlightCreates = new Map<string, Promise<string>>()

async function dedupCreate(
  key: string,
  run: () => Promise<string>,
): Promise<string> {
  const existing = inFlightCreates.get(key)
  if (existing) return existing
  const promise = run().finally(() => inFlightCreates.delete(key))
  inFlightCreates.set(key, promise)
  return promise
}

/**
 * Syncs the wizard's jotai draft config to a server-side ModelDraft
 * (MODEL-FLOW-002, decisions.draft_persistence). Create-on-first-meaningful-
 * edit: called from Phase2TrainingConfig, which only mounts once Step 1's
 * own canAdvance(1) gate has validated workspace/plant/node/dataset/name —
 * so by the time this hook's effect first runs, everything Create needs is
 * already set.
 *
 * Deliberately diverges from DatasetDraft's pattern in one place: this
 * draft is PATCHed as Step 2's config changes, debounced, rather than
 * shipped once at Save — a training container reads its spec from this row
 * over HTTP and has no way to receive a client-only jotai value the way
 * the dataset wizard's UI does.
 */
export interface UseModelDraftSyncResult {
  draftId: string | null
  /**
   * Guarantees a server draft exists and returns its id, creating one first
   * if the debounced effect below hasn't fired yet. `useModelTraining`
   * (MODEL-FLOW-003) calls this before starting a run — Start Training can
   * be clicked before the 600ms PATCH debounce below has even run once.
   */
  ensureDraftId: () => Promise<string | null>
}

export function useModelDraftSync(): UseModelDraftSyncResult {
  const workspaceId = useAtomValue(mpWorkspaceIdAtom)
  const plantId = useAtomValue(mpPlantIdAtom)
  const nodeId = useAtomValue(mpNodeIdAtom)
  const name = useAtomValue(mpNameAtom)
  const selectedDataset = useAtomValue(mpSelectedDatasetAtom)
  const targetVariables = useAtomValue(mpTargetVariableAtom)
  const algorithms = useAtomValue(mpAlgorithmsAtom)
  const hyperparameters = useAtomValue(mpHyperparamsAtom)
  const trainTestSplit = useAtomValue(mpTrainTestSplitAtom)

  const draftId = useAtomValue(mpServerDraftIdAtom)
  const setDraftId = useSetAtom(mpServerDraftIdAtom)

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const ensureDraftId = useCallback(async (): Promise<string | null> => {
    if (draftId) return draftId
    if (!workspaceId) return null
    return dedupCreate(workspaceId, async () => {
      const res = await modelDraftService.create({
        workspaceId,
        name: name || undefined,
        plantId: plantId || undefined,
        nodeId: nodeId || undefined,
        datasetId: selectedDataset?.id,
      })
      setDraftId(res.data.id)
      return res.data.id
    })
  }, [
    draftId,
    workspaceId,
    name,
    plantId,
    nodeId,
    selectedDataset?.id,
    setDraftId,
  ])

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  useEffect(() => {
    if (!workspaceId) return
    if (timerRef.current) clearTimeout(timerRef.current)

    timerRef.current = setTimeout(() => {
      void (async () => {
        try {
          const id = await ensureDraftId()
          if (!id) return

          // One run predicts one Y — a multi-target selection maps to
          // null, never to an arbitrary first entry (the exact trap
          // MODEL-FLOW-003-T10 names), so a multi-target draft fails
          // loudly at training-create rather than silently training on
          // whichever target sorted first.
          const targetY =
            targetVariables.length === 1 ? targetVariables[0] : null

          await modelDraftService.patch(id, {
            name: name || undefined,
            plantId: plantId || null,
            nodeId: nodeId || null,
            datasetId: selectedDataset?.id ?? null,
            targetY,
            algorithm: algorithms[0] ?? null,
            hyperparameters,
            // FRACTION, never a percentage — converted once, here, at the
            // client boundary (MODEL-FLOW-003-T10's own rule).
            splitRatio: trainTestSplit / 100,
          })
        } catch {
          // Best-effort sync — a failed PATCH here is not user-visible;
          // the draft simply retains its last-synced config until the
          // next debounced attempt fires. Training (MODEL-FLOW-003) is
          // where a stale/missing draft becomes a real, surfaced error.
        }
      })()
    }, PATCH_DEBOUNCE_MS)
  }, [
    workspaceId,
    plantId,
    nodeId,
    name,
    selectedDataset?.id,
    targetVariables,
    algorithms,
    hyperparameters,
    trainTestSplit,
    ensureDraftId,
  ])

  return { draftId, ensureDraftId }
}
