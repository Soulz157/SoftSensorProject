'use client'

import { useEffect, useState } from 'react'
import {
  modelDraftRunService,
  type PredictionPopulation,
  type RunPredictionsBatchItem,
} from '@/services/model-draft'

/**
 * MODEL-FLOW-030. The server refuses a predictions batch of more than this many
 * run ids with a 400 (`MAX_PREDICTION_BATCH_RUN_IDS`, model-run.authorized.dto.ts
 * — a CV search holds up to 20 variants, 24 is a sweep with its tuning group).
 * Mirrored here; change both. A caller with more runs than this (the standalone
 * path requests every run on the draft) is split into several requests.
 */
export const MAX_PREDICTION_BATCH_RUN_IDS = 24

export function chunkRunIds(ids: string[]): string[][] {
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += MAX_PREDICTION_BATCH_RUN_IDS) {
    chunks.push(ids.slice(i, i + MAX_PREDICTION_BATCH_RUN_IDS))
  }
  return chunks
}

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
  population: PredictionPopulation = 'test',
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
        const responses = await Promise.all(
          chunkRunIds(runIds).map(ids =>
            modelDraftRunService.predictionsBatch(draftId, ids, population),
          ),
        )
        if (ignore) return
        const map = new Map<string, RunPredictionsBatchItem>()
        for (const res of responses) {
          for (const item of res.data.results) {
            if (item.runId) map.set(item.runId, item)
          }
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
  }, [draftId, runIds, population])

  return { byRunId, loading, error }
}
