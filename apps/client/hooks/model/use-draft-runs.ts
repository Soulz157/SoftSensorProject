'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  modelDraftRunService,
  type ModelTrainingRunListItem,
} from '@/services/model-draft'

export interface UseDraftRunsResult {
  runs: ModelTrainingRunListItem[]
  loading: boolean
  error: string | null
  refetch: () => void
}

/**
 * MODEL-FLOW-012 — every run for a draft, for the Run Parameter Recall
 * panel's run picker. Mirrors `useModelDrafts`' shape: plain local state, one
 * consumer, one request — no shared-atom dedup machinery for a fan-out that
 * doesn't exist. A failed load clears the list rather than throwing; the
 * panel is an optional recall surface, not the step's subject.
 */
const EMPTY_RUNS: ModelTrainingRunListItem[] = []

export function useDraftRuns(draftId: string | null): UseDraftRunsResult {
  // Settled result tagged with the request it answers. `loading` is DERIVED
  // from a key mismatch rather than set synchronously in the effect; the
  // last result stays visible while a reload is in flight, as before.
  const [settled, setSettled] = useState<{
    key: string
    runs: ModelTrainingRunListItem[]
    error: string | null
  } | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const requestKey = draftId ? JSON.stringify([draftId, reloadKey]) : null
  // No draft: drop the last runs during render, not in the effect.
  if (requestKey === null && settled !== null) setSettled(null)

  useEffect(() => {
    if (!requestKey || !draftId) return

    let ignore = false
    modelDraftRunService.list(draftId).then(
      res => {
        if (!ignore)
          setSettled({ key: requestKey, runs: res.data, error: null })
      },
      () => {
        if (!ignore) {
          setSettled({
            key: requestKey,
            runs: [],
            error: 'Failed to load training runs',
          })
        }
      },
    )

    return () => {
      ignore = true
    }
  }, [requestKey, draftId])

  const refetch = useCallback(() => setReloadKey(k => k + 1), [])

  return {
    runs: settled?.runs ?? EMPTY_RUNS,
    loading: requestKey !== null && settled?.key !== requestKey,
    error: settled?.error ?? null,
    refetch,
  }
}
