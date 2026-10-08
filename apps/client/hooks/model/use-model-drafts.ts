'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  modelDraftService,
  type ListModelDraftsQuery,
  type ModelDraft,
} from '@/services/model-draft'

export interface UseModelDraftsResult {
  drafts: ModelDraft[]
  loading: boolean
  error: string | null
  refetch: () => void
}

/**
 * Unfinished Model Creation drafts (MODEL-FLOW-010-T08) — the way back into a
 * wizard the user walked out of, most often to go and edit the dataset it
 * points at. Consumed by `DraftResumeSection` at Step 1 of Create Model.
 *
 * Deliberately plain local state rather than the shared-atom + module-dedup
 * shape `useAllModels` uses: this has exactly one consumer and one request, so
 * the dedup machinery there would guard against a fan-out that does not exist.
 *
 * A failed load is NOT surfaced as an error state. Drafts are an optional way
 * back, not the step's subject — a 500 here should hide the panel, never stand
 * between the user and starting a model.
 */
export function useModelDrafts(
  query: ListModelDraftsQuery = {},
): UseModelDraftsResult {
  const { workspaceId, status } = query

  const [drafts, setDrafts] = useState<ModelDraft[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let ignore = false
    setLoading(true)

    void (async () => {
      try {
        const res = await modelDraftService.list({ workspaceId, status })
        if (ignore) return
        setDrafts(res.data)
        setError(null)
      } catch {
        if (ignore) return
        setDrafts([])
        setError('Failed to load drafts')
      } finally {
        if (!ignore) setLoading(false)
      }
    })()

    return () => {
      ignore = true
    }
  }, [workspaceId, status, reloadKey])

  const refetch = useCallback(() => setReloadKey(k => k + 1), [])

  return { drafts, loading, error, refetch }
}
