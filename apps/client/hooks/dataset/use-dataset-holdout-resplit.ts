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
 * UNREACHABLE FROM THE WIZARD as of DS-LAKE-023's edit-mode re-split pass.
 * `Step4FeatureEngineering` was this hook's only caller; it now sends every
 * holdout (both modes) through the features-stage split instead (see
 * `useDatasetGoldWarm`'s own doc comment) and no longer calls this hook at
 * all. Retained, with the backend `POST /:id/holdout` route it drives, for
 * API compatibility only — nothing in the wizard reaches either path.
 * `resplitDraftHoldoutService`'s own guards (`dataset-draft.authorized.service.ts`)
 * go unreachable alongside it for the same reason: no draft BRONZE will
 * ever carry `validationRowCount` again (Part B nulls the holdout on every
 * `materialize` call from the wizard), so its 422-on-already-split refusal
 * can no longer trigger, and the draft-scoped `type === 'BRONZE'` root
 * requirement has no caller left to satisfy it.
 *
 * Everything below this line describes behaviour that is still CORRECT,
 * just no longer exercised by any UI:
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
