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
export function useDraftRuns(draftId: string | null): UseDraftRunsResult {
  const [runs, setRuns] = useState<ModelTrainingRunListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!draftId) {
      setRuns([])
      setLoading(false)
      setError(null)
      return
    }

    let ignore = false
    setLoading(true)

    void (async () => {
      try {
        const res = await modelDraftRunService.list(draftId)
        if (ignore) return
        setRuns(res.data)
        setError(null)
      } catch {
        if (ignore) return
        setRuns([])
        setError('Failed to load training runs')
      } finally {
        if (!ignore) setLoading(false)
      }
    })()

    return () => {
      ignore = true
    }
  }, [draftId, reloadKey])

  const refetch = useCallback(() => setReloadKey(k => k + 1), [])

  return { runs, loading, error, refetch }
}
