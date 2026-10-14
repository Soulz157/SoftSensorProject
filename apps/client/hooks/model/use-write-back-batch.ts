'use client'

import { useState } from 'react'
import {
  modelEvaluationService,
  type WriteBackBatchDetail,
} from '@/services/model-backfill'
import { useDebouncedAbortableRequest } from '@/hooks/dataset/internal/use-debounced-abortable-request'

export interface UseWriteBackBatch {
  detail: WriteBackBatchDetail | null
  loading: boolean
  error: string | null
}

/** MODEL-SERVE-032. One batch with its per-point before / sent / after
 *  values; fetched only while the row is expanded (`enabled`). */
export function useWriteBackBatch(
  modelId: string,
  batchId: string,
  enabled: boolean,
): UseWriteBackBatch {
  const [detail, setDetail] = useState<WriteBackBatchDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useDebouncedAbortableRequest<WriteBackBatchDetail>({
    enabled,
    cacheKey: `writeback-batch|${modelId}|${batchId}`,
    debounceMs: 0,
    skipCache: true,
    fetcher: signal =>
      modelEvaluationService.getWriteBackBatch(modelId, batchId, signal),
    onLoading: () => {
      setLoading(true)
      setError(null)
    },
    onSettled: result => {
      setLoading(false)
      if (result.status === 'ready') setDetail(result.data)
      else setError(result.error)
    },
    onIdle: () => {
      setLoading(false)
    },
  })

  return { detail, loading, error }
}
