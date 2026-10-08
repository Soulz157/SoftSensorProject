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
const EMPTY_DRAFTS: ModelDraft[] = []

export function useModelDrafts(
  query: ListModelDraftsQuery = {},
): UseModelDraftsResult {
  const { workspaceId, status } = query

  // Settled result tagged with the request it answers. `loading` is DERIVED
  // from a key mismatch rather than set synchronously in the effect; the
  // last result stays visible while a reload is in flight, as before.
  const [settled, setSettled] = useState<{
    key: string
    drafts: ModelDraft[]
    error: string | null
  } | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const requestKey = JSON.stringify([workspaceId, status, reloadKey])

  useEffect(() => {
    let ignore = false
    modelDraftService.list({ workspaceId, status }).then(
      res => {
        if (!ignore) {
          setSettled({ key: requestKey, drafts: res.data, error: null })
        }
      },
      () => {
        if (!ignore) {
          setSettled({
            key: requestKey,
            drafts: [],
            error: 'Failed to load drafts',
          })
        }
      },
    )

    return () => {
      ignore = true
    }
  }, [requestKey, workspaceId, status])

  const refetch = useCallback(() => setReloadKey(k => k + 1), [])

  return {
    drafts: settled?.drafts ?? EMPTY_DRAFTS,
    loading: settled?.key !== requestKey,
    error: settled?.error ?? null,
    refetch,
  }
}
