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
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!draftId) {
      setSelectedRunId(null)
      setLoading(false)
      return
    }

    let ignore = false
    setLoading(true)

    void (async () => {
      try {
        const res = await modelDraftService.get(draftId)
        if (ignore) return
        setSelectedRunId(res.data.selectedRunId)
      } catch {
        if (ignore) return
        setSelectedRunId(null)
      } finally {
        if (!ignore) setLoading(false)
      }
    })()

    return () => {
      ignore = true
    }
  }, [draftId, reloadKey])

  const refetch = useCallback(() => setReloadKey(k => k + 1), [])

  return { selectedRunId, loading, refetch }
}
