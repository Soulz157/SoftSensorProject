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
  mpSavedDataSourcesAtom,
  mpSelectedSavedSourceIdAtom,
  mpSelectedTagsAtom,
  mpRawDatasetAtom,
  mpTimeRangeAtom,
  mpCustomDateRangeAtom,
  mpFillStrategiesAtom,
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
  const savedSources = useAtomValue(mpSavedDataSourcesAtom)
  const savedSourceId = useAtomValue(mpSelectedSavedSourceIdAtom)
  const selectedTags = useAtomValue(mpSelectedTagsAtom)
  const rawDataset = useAtomValue(mpRawDatasetAtom)
  const timeRange = useAtomValue(mpTimeRangeAtom)
  const customDateRange = useAtomValue(mpCustomDateRangeAtom)
  const fillStrategies = useAtomValue(mpFillStrategiesAtom)
  const selectedMetrics = useAtomValue(mpSelectedMetricsAtom)

  return useCallback(async (): Promise<string | null> => {
    // Persist the tags actually fetched/trained (Step-4 subset). Fall back to
    // the confirmed list when no dataset exists yet (e.g. edit-mode hydration).
    const committedTags =
      rawDataset.tags.length > 0 ? rawDataset.tags : selectedTags
    const config = buildModelConfig({
      description,
      savedSources,
      savedSourceId,
      selectedTags: committedTags,
      timeRange,
      customDateRange,
      fillStrategies,
      selectedMetrics,
    })

    if (mode === 'edit') {
      await updateModel(editModelId, {
        name: name.trim(),
        nodeId: nodeId || null,
        config,
      })
      return editModelId
    }

    if (!createdModelId) {
      const model = await createModel({
        workspaceId,
        name: name.trim(),
        nodeId: nodeId || undefined,
        config,
      })
      setCreatedModelId(model.id)
      return model.id
    }

    await updateModel(createdModelId, {
      name: name.trim(),
      nodeId: nodeId || null,
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
    savedSources,
    savedSourceId,
    selectedTags,
    rawDataset,
    timeRange,
    customDateRange,
    fillStrategies,
    selectedMetrics,
    setCreatedModelId,
  ])
}
