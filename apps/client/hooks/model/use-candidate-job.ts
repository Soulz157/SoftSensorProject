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
  const [job, setJob] = useState<ModelCandidateJob | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!draftId || !jobId) {
      setJob(null)
      setLoading(false)
      setError(null)
      return
    }

    let ignore = false
    setLoading(true)

    void (async () => {
      try {
        const res = await modelDraftCandidateJobService.get(draftId, jobId)
        if (ignore) return
        setJob(res.data)
        setError(null)
      } catch {
        if (ignore) return
        setJob(null)
        setError('Failed to load the candidate job')
      } finally {
        if (!ignore) setLoading(false)
      }
    })()

    return () => {
      ignore = true
    }
  }, [draftId, jobId, reloadKey])

  const refetch = useCallback(() => setReloadKey(k => k + 1), [])

  return { job, loading, error, refetch }
}
