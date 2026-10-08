'use client'

import { useState } from 'react'
import {
  inferenceWindowService,
  type InferenceStatus,
} from '@/services/inference-window'
import { useDebouncedAbortableRequest } from '@/hooks/dataset/internal/use-debounced-abortable-request'

interface UseInferenceStatusResult {
  status: InferenceStatus | null
  loading: boolean
  /** A transport failure only — never set for a normal "no schedule yet"
   *  response, which the service itself already models as a valid
   *  `InferenceStatus` (enabled: false). */
  error: string | null
  /** Force a fresh read — `getStatus`'s own endpoint (MODEL-SERVE-001-T09,
   *  first client consumer). Bumps the request identity rather than
   *  reusing the debounced cache: the caller of this is always reacting to
   *  a mutation that just changed server state (Start/Stop), so a
   *  cache-served stale value would be worse than a real request. */
  refetch: () => void
}

/**
 * MODEL-SERVE-001-T09. The Deploy KPI's status + reason, read once per
 * model and again on demand via `refetch` — never on an interval. A
 * freshly enabled schedule has no windows yet BY CONSTRUCTION, and the
 * scheduler's own tick is `INFERENCE_TICK_INTERVAL_MS` (5 minutes;
 * `env.config.ts`), so anything shorter than that is load with no
 * information in it. One refetch after Start/Stop proves the mutation
 * landed; it does not and cannot prove the source works — that is what the
 * card's own "initializing" wording says instead of guessing.
 */
export function useInferenceStatus(
  modelId: string | null,
): UseInferenceStatusResult {
  const [status, setStatus] = useState<InferenceStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const enabled = !!modelId
  const cacheKey = enabled ? `inference-status|${modelId}|${tick}` : null

  useDebouncedAbortableRequest<InferenceStatus>({
    enabled,
    cacheKey,
    debounceMs: 0,
    // Every read here follows a real state change (mount, or a Start/Stop
    // mutation) — never a keystroke-driven burst — so there is nothing to
    // gain from serving a cached value and a real cost to doing so: a
    // Start-triggered refetch landing on a pre-mutation cache entry would
    // print the OLD status right after the action that was supposed to
    // change it.
    skipCache: true,
    fetcher: signal =>
      inferenceWindowService.getStatus(modelId as string, signal),
    onLoading: () => {
      setLoading(true)
      setError(null)
    },
    onSettled: result => {
      setLoading(false)
      if (result.status === 'ready') {
        setStatus(result.data)
        setError(null)
      } else {
        setError(result.error)
      }
    },
    onIdle: () => {
      setStatus(null)
      setLoading(false)
      setError(null)
    },
  })

  return {
    status,
    loading,
    error,
    refetch: () => setTick(t => t + 1),
  }
}
