'use client'

import { useState } from 'react'
import { datasetDraftService } from '@/services/dataset-draft'
import type { DraftBoxplotResult } from '@/services/dataset-draft'
import type { CleaningOperationInput } from '@/services/dataset-version'
import { useDebouncedAbortableRequest } from './internal/use-debounced-abortable-request'

export interface DatasetBoxplotState {
  boxplot: DraftBoxplotResult | null
  loading: boolean
  error: string | null
}

/**
 * DS-LAKE-005B-D-T03. Reads `POST .../artifacts/:artifactId/boxplot` —
 * server-recomputed five-number summary + capped outlier list for `tags`,
 * never a row payload. Same shape as `useDatasetHistogram`'s own doc
 * comment: `operations` fixed at `[]` for now — reactivity to `operations`
 * itself is proven, reactivity to Step 3.1's OWN crop/conditional/
 * statistical rules is gated on the separately-scoped precleanse-engine
 * port.
 *
 * DS-LAKE-005B-D-T06: debounce/abort-on-supersede/cache come from the
 * shared `useDebouncedAbortableRequest` — see that hook's own doc comment.
 */
export function useDatasetBoxplot(
  draftId: string | null,
  artifactId: string | null,
  tags: string[],
  operations: CleaningOperationInput[] = [],
  /** Forwarded as-is to `datasetDraftService.boxplot()`. No caller sets
   * this yet — `undefined` lets the server apply its own default
   * (`DEFAULT_BOXPLOT_OUTLIER_CAP = 50`). */
  outlierCap?: number,
): DatasetBoxplotState {
  const [boxplot, setBoxplot] = useState<DraftBoxplotResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const tagsKey = tags.join(',')
  const opsKey = JSON.stringify(operations)

  const enabled = !!draftId && !!artifactId && tags.length > 0
  const cacheKey = enabled
    ? `boxplot|${draftId}|${artifactId}|${tagsKey}|${opsKey}|${outlierCap ?? ''}`
    : null

  useDebouncedAbortableRequest<DraftBoxplotResult>({
    enabled,
    cacheKey,
    fetcher: signal =>
      datasetDraftService
        .boxplot(
          draftId!,
          artifactId!,
          { operations, tags, ...(outlierCap !== undefined && { outlierCap }) },
          signal,
        )
        .then(res => res.data),
    onLoading: () => {
      setBoxplot(null)
      setError(null)
      setLoading(true)
    },
    onSettled: result => {
      if (result.status === 'ready') {
        setBoxplot(result.data)
      } else {
        setError(result.error)
      }
      setLoading(false)
    },
    onIdle: () => {
      setBoxplot(null)
      setLoading(false)
      setError(null)
    },
  })

  return { boxplot, loading, error }
}
