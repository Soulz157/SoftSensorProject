'use client'

import { useState } from 'react'
import {
  inferenceWindowService,
  type WindowLogs,
} from '@/services/inference-window'
import { useDebouncedAbortableRequest } from '@/hooks/dataset/internal/use-debounced-abortable-request'

interface UseWindowLogsResult {
  logs: WindowLogs | null
  loading: boolean
  /**
   * A transport failure ONLY. Never set for the normal "this window has no
   * lines" state — that is a valid `WindowLogs` with an empty `lines`, and
   * the window's own `status` says which of the four reasons applies. Same
   * contract `useLiveError` states for its own empty case: an absence with
   * a known cause is not an error.
   */
  error: string | null
  /** Force a fresh read after an action that changed server state (a
   *  retry, a Start/Stop). There is no interval here — see below. */
  refetch: () => void
}

/**
 * MODEL-SERVE-001-T10. One window's container stdout plus the window's own
 * facts, for `models/[id]`'s Logs tab and `models/views`' Console peek.
 * Both go through this one hook and one endpoint so the two screens cannot
 * disagree about the same model — the divergence T09 had to close for
 * deployStatus one screen over.
 *
 * Pass `'latest'` as `windowId` for the peek: it holds a Model and has no
 * window id, and the server resolves it to the model's most recent window.
 *
 * NO POLL, DELIBERATELY. `INFERENCE_TICK_INTERVAL_MS` is 5 minutes, so a
 * tail would mostly return nothing — the same reasoning
 * `useInferenceStatus` records for itself. A console invites a tail; this
 * one answers with a refetch instead. (`use-model-training.ts` polls at
 * 2500ms, but that watches a training container that is actively running,
 * which is a different cadence and not a precedent for a scheduled
 * window.)
 */
export function useWindowLogs(
  modelId: string | null,
  windowId: string | null,
): UseWindowLogsResult {
  const [logs, setLogs] = useState<WindowLogs | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const enabled = !!modelId && !!windowId
  const cacheKey = enabled ? `window-logs|${modelId}|${windowId}|${tick}` : null

  useDebouncedAbortableRequest<WindowLogs>({
    enabled,
    cacheKey,
    debounceMs: 0,
    // Same reason `useInferenceStatus` skips the cache: every read here
    // follows a real state change (opening the sheet, selecting another
    // window, or a retry that just mutated the row), never a keystroke
    // burst, so a cached value can only ever be staler than the truth.
    skipCache: true,
    fetcher: signal =>
      inferenceWindowService.logs(
        modelId as string,
        windowId as string,
        signal,
      ),
    onLoading: () => {
      setLoading(true)
      setError(null)
    },
    onSettled: result => {
      setLoading(false)
      if (result.status === 'ready') {
        setLogs(result.data)
        setError(null)
      } else {
        setLogs(null)
        setError(result.error)
      }
    },
    onIdle: () => {
      setLogs(null)
      setLoading(false)
      setError(null)
    },
  })

  return {
    logs,
    loading,
    error,
    refetch: () => setTick(t => t + 1),
  }
}
