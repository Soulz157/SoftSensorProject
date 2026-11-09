'use client'

import { useCallback, useState } from 'react'
import {
  modelEvaluationService,
  type WriteBackHistoryItem,
  type WriteBackHistoryPage,
} from '@/services/model-backfill'
import { useDebouncedAbortableRequest } from '@/hooks/dataset/internal/use-debounced-abortable-request'

export interface UseWriteBackHistory {
  batches: WriteBackHistoryItem[]
  loading: boolean
  loadingMore: boolean
  error: string | null
  hasMore: boolean
  loadMore: () => Promise<void>
}

function message(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

/**
 * MODEL-SERVE-032. The model's write / rollback history, newest first,
 * paged by cursor. `refreshKey` re-reads the first page (a write or a
 * rollback just happened); it is never served from a cache because the
 * rows it lists are the audit trail for a production historian.
 */
export function useWriteBackHistory(
  modelId: string,
  refreshKey: number,
): UseWriteBackHistory {
  const [batches, setBatches] = useState<WriteBackHistoryItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useDebouncedAbortableRequest<WriteBackHistoryPage>({
    enabled: true,
    cacheKey: `writeback-history|${modelId}|${refreshKey}`,
    debounceMs: 0,
    skipCache: true,
    fetcher: signal =>
      modelEvaluationService.listWriteBackHistory(modelId, { signal }),
    onLoading: () => {
      setLoading(true)
      setError(null)
    },
    onSettled: result => {
      setLoading(false)
      if (result.status === 'ready') {
        setBatches(result.data.batches)
        setCursor(result.data.nextCursor)
      } else {
        setBatches([])
        setCursor(null)
        setError(result.error)
      }
    },
    onIdle: () => {
      setBatches([])
      setCursor(null)
      setLoading(false)
      setError(null)
    },
  })

  const loadMore = useCallback(async () => {
    if (!cursor) return
    setLoadingMore(true)
    try {
      const page = await modelEvaluationService.listWriteBackHistory(modelId, {
        cursor,
      })
      setBatches(prev => {
        const seen = new Set(prev.map(b => b.id))
        return [...prev, ...page.batches.filter(b => !seen.has(b.id))]
      })
      setCursor(page.nextCursor)
    } catch (err) {
      setError(message(err, 'Could not load more history.'))
    } finally {
      setLoadingMore(false)
    }
  }, [modelId, cursor])

  return {
    batches,
    loading,
    loadingMore,
    error,
    hasMore: cursor !== null,
    loadMore,
  }
}
