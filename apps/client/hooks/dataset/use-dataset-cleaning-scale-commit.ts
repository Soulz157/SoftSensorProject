'use client'

import { useCallback, useRef, useState } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { datasetDraftService } from '@/services/dataset-draft'
import { pollDraftJobUntilTerminal } from '@/lib/poll-preprocessing-job'
import { toCleaningOperationsFromRecord } from '@/lib/cleaning-op-mapper'
import type { TagPipeline } from '@/lib/preprocessing'
import type { FeatureConfig } from '@/lib/feature-engineering'
import type { ScalerMethod } from '@/lib/preprocessing'
import {
  dwDraftIdAtom,
  dwDraftFeatureArtifactIdAtom,
  dwDraftGoldArtifactIdAtom,
} from '@/store/dataset-studio'

export interface CleaningScaleCommitState {
  status: 'idle' | 'committing' | 'committed' | 'error'
  error?: string
}

/**
 * DS-LAKE-022-T04..T07. Step 5's clean+scale commit — CREATE MODE ONLY.
 *
 * D4 (feature_list.preprocessing.json): the reordered clean job must source
 * the FIXED features-only SILVER (`dwDraftFeatureArtifactIdAtom`, Step 4's
 * warm) and replay the FULL accumulated per-tag recipe every time, not just
 * the batch most recently edited — chaining onto its own prior output (the
 * way `useDatasetDraftPipeline.applyClean` does for the legacy/edit-mode
 * path) would mean cleaning a frame that batch N-1's job already committed,
 * compounding drift across saves. `toCleaningOperationsFromRecord` is what
 * flattens `dwCleaningPipelinesAtom`'s whole map into the one ordered
 * operation list a single job call needs.
 *
 * A single explicit call on advancing PAST Step 5, not a debounced
 * background warm like `useDatasetGoldWarm` — Step 5 keeps the wizard's
 * existing "local preview, server on Apply" contract (the interactive panel
 * already computes its own local preview via `preprocessPipelines`); this
 * hook only adds the real GOLD behind leaving the step, mirroring how
 * `useDatasetDraftPipeline.applyClean` adds a real SILVER behind "Save
 * Cleaned Tags" without changing that page's UX. Also covers the
 * zero-cleaning-rules case for free: an empty `cleaningPipelines` still
 * sends `scaleRecipe` with no `operations`, and the server's own
 * `StartCleanJobSchema` doc comment says exactly this is legal precisely
 * because a draft with features but no cleaning rules still needs its GOLD
 * written.
 *
 * Writes the result into `dwDraftGoldArtifactIdAtom` (the real, reordered
 * GOLD) — never `dwDraftArtifactIdAtom`, which stays the fixed BRONZE every
 * batch replays against, and never `dwDraftFeatureArtifactIdAtom`, which
 * stays Step 4's own fixed source.
 */
export function useDatasetCleaningScaleCommit(): {
  state: CleaningScaleCommitState
  commit: (
    cleaningPipelines: Record<string, TagPipeline>,
    recipe: {
      features: FeatureConfig[]
      selectedColumns: string[] | null
      scalers: Record<string, ScalerMethod>
      targetY: string | null
    },
  ) => Promise<boolean>
} {
  const draftId = useAtomValue(dwDraftIdAtom)
  const sourceArtifactId = useAtomValue(dwDraftFeatureArtifactIdAtom)
  const [, setGoldArtifactId] = useAtom(dwDraftGoldArtifactIdAtom)
  const [state, setState] = useState<CleaningScaleCommitState>({
    status: 'idle',
  })
  const cancelledRef = useRef(false)

  const commit = useCallback(
    async (
      cleaningPipelines: Record<string, TagPipeline>,
      recipe: {
        features: FeatureConfig[]
        selectedColumns: string[] | null
        scalers: Record<string, ScalerMethod>
        targetY: string | null
      },
    ): Promise<boolean> => {
      if (!draftId || !sourceArtifactId) {
        setState({
          status: 'error',
          error: 'Feature engineering has not produced a source artifact yet.',
        })
        return false
      }
      cancelledRef.current = false
      setState({ status: 'committing' })
      try {
        const operations = toCleaningOperationsFromRecord(cleaningPipelines)
        const res = await datasetDraftService.clean(draftId, sourceArtifactId, {
          operations,
          scaleRecipe: {
            features: recipe.features,
            selectedColumns: recipe.selectedColumns,
            scalers: recipe.scalers,
            targetY: recipe.targetY,
          },
        })
        const job = await pollDraftJobUntilTerminal(
          draftId,
          res.data.jobId,
          () => cancelledRef.current,
        )
        if (!job) return false // cancelled
        if (job.status === 'SUCCEEDED') {
          if (job.resultArtifactId) setGoldArtifactId(job.resultArtifactId)
          setState({ status: 'committed' })
          return true
        }
        setState({
          status: 'error',
          error: job.error ?? 'Cleaning job failed.',
        })
        return false
      } catch (err) {
        setState({
          status: 'error',
          error: err instanceof Error ? err.message : 'Server sync failed.',
        })
        return false
      }
    },
    [draftId, sourceArtifactId, setGoldArtifactId],
  )

  return { state, commit }
}
