'use client'

import { useState } from 'react'
import { datasetDraftService } from '@/services/dataset-draft'
import type { DraftScatterResult } from '@/services/dataset-draft'
import type { CleaningOperationInput } from '@/services/dataset-version'
import { useDebouncedAbortableRequest } from './internal/use-debounced-abortable-request'

export interface DatasetScatterState {
  scatter: DraftScatterResult | null
  loading: boolean
  error: string | null
}

/**
 * DS-LAKE-005B-D-T04. Reads `POST .../artifacts/:artifactId/scatter` —
 * server-decimated point cloud + full-frame regression for `xTag`/`yTag`,
 * never a row payload. Same shape as `useDatasetHistogram`/
 * `useDatasetBoxplot`: `operations` fixed at `[]` for now — reactivity to
 * `operations` itself is proven, reactivity to Step 3.1's OWN
 * crop/conditional/statistical rules is gated on the separately-scoped
 * precleanse-engine port.
 *
 * DS-LAKE-005B-D-T06: debounce/abort-on-supersede/cache come from the
 * shared `useDebouncedAbortableRequest` — see that hook's own doc comment.
 */
export function useDatasetScatter(
  draftId: string | null,
  artifactId: string | null,
  xTag: string | null,
  yTag: string | null,
  operations: CleaningOperationInput[] = [],
  /** Forwarded as-is. No caller sets this yet — `undefined` lets the
   * server apply its own default (`DEFAULT_SCATTER_MAX_POINTS = 2000`). */
  maxPoints?: number,
): DatasetScatterState {
  const [scatter, setScatter] = useState<DraftScatterResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const opsKey = JSON.stringify(operations)

  const enabled = !!draftId && !!artifactId && !!xTag && !!yTag
  const cacheKey = enabled
    ? `scatter|${draftId}|${artifactId}|${xTag}|${yTag}|${opsKey}|${maxPoints ?? ''}`
    : null

  useDebouncedAbortableRequest<DraftScatterResult>({
    enabled,
    cacheKey,
    fetcher: signal =>
      datasetDraftService
        .scatter(
          draftId!,
          artifactId!,
          {
            operations,
            xTag: xTag!,
            yTag: yTag!,
            ...(maxPoints !== undefined && { maxPoints }),
          },
          signal,
        )
        .then(res => res.data),
    onLoading: () => {
      setScatter(null)
      setError(null)
      setLoading(true)
    },
    onSettled: result => {
      if (result.status === 'ready') {
        setScatter(result.data)
      } else {
        setError(result.error)
      }
      setLoading(false)
    },
    onIdle: () => {
      setScatter(null)
      setLoading(false)
      setError(null)
    },
  })

  return { scatter, loading, error }
}
