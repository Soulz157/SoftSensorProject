'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  datasetDraftService,
  type ResumableDatasetDraft,
} from '@/services/dataset-draft'

export interface UseResumableDatasetDraftsResult {
  drafts: ResumableDatasetDraft[]
  loading: boolean
  /** Rejects when the server refuses, so the caller can say so. */
  discard: (draftId: string) => Promise<void>
}

const EMPTY: ResumableDatasetDraft[] = []

/**
 * DS-LAKE-037. The caller's unfinished Create Dataset drafts - the way back
 * into a wizard whose session expired or whose tab was closed. Consumed by
 * `DatasetDraftResumeSection` on the Datasets page.
 *
 * Plain local state, like `useModelDrafts`: one consumer, one request. A failed
 * load hides the section rather than showing an error - drafts are an optional
 * way back and must never stand between the user and starting a dataset.
 */
export function useResumableDatasetDrafts(): UseResumableDatasetDraftsResult {
  const [drafts, setDrafts] = useState<ResumableDatasetDraft[]>(EMPTY)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let ignore = false
    datasetDraftService.listResumable().then(
      res => {
        if (ignore) return
        setDrafts(res.data)
        setLoading(false)
      },
      () => {
        if (ignore) return
        setDrafts(EMPTY)
        setLoading(false)
      },
    )
    return () => {
      ignore = true
    }
  }, [])

  const discard = useCallback(async (draftId: string) => {
    await datasetDraftService.abandon(draftId)
    setDrafts(prev => prev.filter(d => d.id !== draftId))
  }, [])

  return { drafts, loading, discard }
}
