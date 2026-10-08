'use client'

import { useCallback, useEffect, useState } from 'react'
import { modelDraftService } from '@/services/model-draft'

export interface UseDraftSelectionResult {
  /** MODEL-FLOW-018-T02. Null until Select is used — distinct from
   *  `resolvedRunId`, which is non-null for any draft with any run at all.
   *  This is what a "Carrying forward: …" footer gates on. */
  selectedRunId: string | null
  loading: boolean
  refetch: () => void
}

/**
 * MODEL-FLOW-018-T03 — the read side of a standalone Select. Mirrors
 * `useDraftRuns`' shape: plain local state, one consumer, one request. A
 * separate hook rather than folding this into `useDraftRuns` — that hook
 * returns run rows, and `selectedRunId` lives on the DRAFT, not any one run.
 */
export function useDraftSelection(
  draftId: string | null,
): UseDraftSelectionResult {
  // Settled result tagged with the request it answers. `loading` is DERIVED
  // from a key mismatch rather than set synchronously in the effect; the
  // last result stays visible while a reload is in flight, as before.
  const [settled, setSettled] = useState<{
    key: string
    selectedRunId: string | null
  } | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const requestKey = draftId ? JSON.stringify([draftId, reloadKey]) : null
  // No draft: drop the last selection during render, not in the effect.
  if (requestKey === null && settled !== null) setSettled(null)

  useEffect(() => {
    if (!requestKey || !draftId) return

    let ignore = false
    modelDraftService.get(draftId).then(
      res => {
        if (!ignore) {
          setSettled({ key: requestKey, selectedRunId: res.data.selectedRunId })
        }
      },
      () => {
        if (!ignore) setSettled({ key: requestKey, selectedRunId: null })
      },
    )

    return () => {
      ignore = true
    }
  }, [requestKey, draftId])

  const refetch = useCallback(() => setReloadKey(k => k + 1), [])

  return {
    selectedRunId: settled?.selectedRunId ?? null,
    loading: requestKey !== null && settled?.key !== requestKey,
    refetch,
  }
}
