'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  modelDraftCandidateJobService,
  type ModelCandidateJob,
} from '@/services/model-draft'

export interface UseCandidateJobResult {
  job: ModelCandidateJob | null
  loading: boolean
  error: string | null
  refetch: () => void
}

/**
 * MODEL-FLOW-013-T07 — Model Selection's data source. Mirrors
 * `useDraftRuns`' shape: plain local state, one consumer, one request.
 * `getJobService` already reconciles on read (advances a job whose
 * completion nudge was lost) and shapes every candidate against its own
 * run, so this hook is a thin fetch, not a second source of truth.
 */
export function useCandidateJob(
  draftId: string | null,
  jobId: string | null,
): UseCandidateJobResult {
  // Settled result tagged with the request it answers. `loading` is DERIVED
  // from a key mismatch rather than set synchronously in the effect; the
  // last result stays visible while a reload is in flight, as before.
  const [settled, setSettled] = useState<{
    key: string
    job: ModelCandidateJob | null
    error: string | null
  } | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const requestKey =
    draftId && jobId ? JSON.stringify([draftId, jobId, reloadKey]) : null
  // No job to load: drop the last one during render, not in the effect.
  if (requestKey === null && settled !== null) setSettled(null)

  useEffect(() => {
    if (!requestKey || !draftId || !jobId) return

    let ignore = false
    modelDraftCandidateJobService.get(draftId, jobId).then(
      res => {
        if (!ignore) setSettled({ key: requestKey, job: res.data, error: null })
      },
      () => {
        if (!ignore) {
          setSettled({
            key: requestKey,
            job: null,
            error: 'Failed to load the candidate job',
          })
        }
      },
    )

    return () => {
      ignore = true
    }
  }, [requestKey, draftId, jobId])

  const refetch = useCallback(() => setReloadKey(k => k + 1), [])

  return {
    job: settled?.job ?? null,
    loading: requestKey !== null && settled?.key !== requestKey,
    error: settled?.error ?? null,
    refetch,
  }
}
