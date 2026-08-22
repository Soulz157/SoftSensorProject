'use client'

import { useCallback, useState } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { datasetDraftService } from '@/services/dataset-draft'
import { dwDraftArtifactIdAtom, dwDraftIdAtom } from '@/store/dataset-studio'

export type HoldoutResplitStatus = 'idle' | 'pending' | 'error'

export interface UseDatasetHoldoutResplitResult {
  status: HoldoutResplitStatus
  error: string | null
  /** `holdout: null` clears a previously-picked holdout. */
  resplit: (holdout: { from: string; to: string } | null) => Promise<void>
}

/**
 * DS-LAKE-018-T06. Fires `datasetDraftService.resplitHoldout` — the
 * server-side re-split of the draft's PRISTINE root BRONZE against a new
 * holdout window — and points `dwDraftArtifactIdAtom` at whatever artifact
 * the server responds with.
 *
 * Setting that one atom is sufficient to refresh everything Step 3.1 shows:
 * `useDatasetFeaturePreviewSample` keys its fetch effect on it and refetches
 * automatically, and `DataAnalysisCard`'s server-backed tabs
 * (histogram/boxplot/scatter/correlation) read it directly on every render.
 * No cache to invalidate, no manual refetch to trigger here.
 *
 * No-op (never calls the service) when `dwDraftIdAtom` is null — mirrors
 * every other draft-scoped hook's own guard (`useDatasetFeaturePreviewSample`,
 * `useDatasetBronzeWarm`): there is nothing to re-split before Step 2's
 * fetch has created a draft.
 */
export function useDatasetHoldoutResplit(): UseDatasetHoldoutResplitResult {
  const draftId = useAtomValue(dwDraftIdAtom)
  const setArtifactId = useSetAtom(dwDraftArtifactIdAtom)
  const [status, setStatus] = useState<HoldoutResplitStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  const resplit = useCallback(
    async (holdout: { from: string; to: string } | null) => {
      if (!draftId) return
      setStatus('pending')
      setError(null)
      try {
        const res = await datasetDraftService.resplitHoldout(draftId, {
          holdout,
        })
        setArtifactId(res.data.id)
        setStatus('idle')
      } catch (err) {
        setStatus('error')
        setError(
          err instanceof Error
            ? err.message
            : 'Could not update the validation holdout.',
        )
      }
    },
    [draftId, setArtifactId],
  )

  return { status, error, resplit }
}
