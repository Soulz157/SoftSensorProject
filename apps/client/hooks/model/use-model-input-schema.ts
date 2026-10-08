'use client'

import { useState } from 'react'
import {
  modelMonitoringService,
  type ModelInputSchema,
} from '@/services/model-monitoring'
import { useDebouncedAbortableRequest } from '@/hooks/dataset/internal/use-debounced-abortable-request'

interface UseModelInputSchemaResult {
  schema: ModelInputSchema | null
  loading: boolean
  /** A transport failure — never set for a normal "no feature columns
   *  recorded" state, which lives on `schema.unavailableReason` instead. */
  error: string | null
}

/**
 * The Input Data tab's trained X/Y schema — the ordered `featureColumns`
 * list and `targetY`, read once per model (not per time range: unlike
 * `usePredictionMonitoring`'s series/drift, this does not vary with the
 * range toggle). Built on the same `useDebouncedAbortableRequest` primitive
 * for its abort/cache-for-free lifecycle; `debounceMs: 0` because a model
 * id resolving is a discrete event, not a keystroke to debounce.
 *
 * ONE cache key for this one endpoint — no risk of the two-endpoints-one-
 * key collision `use-prediction-monitoring.ts` documents on itself, since
 * this hook owns only a single request.
 */
export function useModelInputSchema(
  modelId: string | null,
): UseModelInputSchemaResult {
  const [schema, setSchema] = useState<ModelInputSchema | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const enabled = !!modelId
  const cacheKey = enabled ? `model-input-schema|${modelId}` : null

  useDebouncedAbortableRequest<ModelInputSchema>({
    enabled,
    cacheKey,
    debounceMs: 0,
    fetcher: signal =>
      modelMonitoringService
        .inputSchema(modelId!, signal)
        .then(res => res.data),
    onLoading: () => {
      setError(null)
      setLoading(true)
    },
    onSettled: result => {
      if (result.status === 'ready') {
        setSchema(result.data)
        setError(null)
      } else {
        setSchema(null)
        setError(result.error)
      }
      setLoading(false)
    },
    onIdle: () => {
      setSchema(null)
      setError(null)
      setLoading(false)
    },
  })

  return { schema, loading, error }
}
