'use client'

import { useCallback, useState } from 'react'
import {
  modelEvaluationService,
  type WriteBackConfigView,
} from '@/services/model-evaluation'
import { useDebouncedAbortableRequest } from '@/hooks/dataset/internal/use-debounced-abortable-request'

export interface UseWriteBackConfig {
  view: WriteBackConfigView | null
  loading: boolean
  /** A transport / access failure reading the settings. */
  error: string | null
  /** Throws the server's own sentence on refusal, for the dialog to show. */
  save: (tags: {
    predictionTag: string | null
    labTag: string | null
  }) => Promise<void>
}

/**
 * MODEL-SERVE-032. The model's PI write-back settings (output tags, the PI
 * account a write is attributed to, and whether THIS caller may write).
 *
 * Always re-read on mount, never cached: ownership and the saved tags can
 * change under a long-open page, and the buttons it drives write to a
 * production historian.
 */
export function useWriteBackConfig(modelId: string): UseWriteBackConfig {
  const [view, setView] = useState<WriteBackConfigView | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useDebouncedAbortableRequest<WriteBackConfigView>({
    enabled: true,
    cacheKey: `writeback-config|${modelId}`,
    debounceMs: 0,
    skipCache: true,
    fetcher: () => modelEvaluationService.getWriteBackConfig(modelId),
    onLoading: () => {
      setLoading(true)
      setError(null)
    },
    onSettled: result => {
      setLoading(false)
      if (result.status === 'ready') {
        setView(result.data)
        setError(null)
      } else {
        setView(null)
        setError(result.error)
      }
    },
    onIdle: () => {
      setView(null)
      setLoading(false)
      setError(null)
    },
  })

  const save = useCallback(
    async (tags: { predictionTag: string | null; labTag: string | null }) => {
      // The PUT answers with the refreshed view, so no second round trip.
      setView(await modelEvaluationService.putWriteBackConfig(modelId, tags))
    },
    [modelId],
  )

  return { view, loading, error, save }
}
