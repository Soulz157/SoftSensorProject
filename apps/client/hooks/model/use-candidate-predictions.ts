'use client'

import { useEffect, useState } from 'react'
import {
  modelDraftRunService,
  type RunPredictionsBatchItem,
} from '@/services/model-draft'

export interface UseCandidatePredictionsResult {
  /** Keyed by runId — a run absent from this map has no predictions
   *  artifact to show (not yet SUCCEEDED, or none was recorded). A run
   *  present but with `error` set has one that could not be read. */
  byRunId: Map<string, RunPredictionsBatchItem>
  loading: boolean
  error: string | null
}

/**
 * MODEL-FLOW-017-T02/T03. One fetch for every candidate's decimated
 * actual/predicted series — Step 4's base chart and overlay. Mirrors
 * `useCandidateJob`'s shape: plain local state, one consumer, one request.
 *
 * `runIds` is expected to be referentially stable across renders that don't
 * change its contents (the caller derives it with `useMemo`) — this hook
 * re-fetches whenever the ARRAY reference changes, not on every render.
 */
export function useCandidatePredictions(
  draftId: string | null,
  runIds: string[],
): UseCandidatePredictionsResult {
  const [byRunId, setByRunId] = useState<Map<string, RunPredictionsBatchItem>>(
    new Map(),
  )
  const [loading, setLoading] = useState(runIds.length > 0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!draftId || runIds.length === 0) {
      setByRunId(new Map())
      setLoading(false)
      setError(null)
      return
    }

    let ignore = false
    setLoading(true)

    void (async () => {
      try {
        const res = await modelDraftRunService.predictionsBatch(draftId, runIds)
        if (ignore) return
        const map = new Map<string, RunPredictionsBatchItem>()
        for (const item of res.data.results) {
          if (item.runId) map.set(item.runId, item)
        }
        setByRunId(map)
        setError(null)
      } catch {
        if (ignore) return
        setByRunId(new Map())
        setError('Failed to load candidate predictions')
      } finally {
        if (!ignore) setLoading(false)
      }
    })()

    return () => {
      ignore = true
    }
  }, [draftId, runIds])

  return { byRunId, loading, error }
}
