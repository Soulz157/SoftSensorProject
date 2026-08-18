'use client'

import { useState } from 'react'
import { datasetDraftService } from '@/services/dataset-draft'
import type { DraftCorrelationResult } from '@/services/dataset-draft'
import type { CleaningOperationInput } from '@/services/dataset-version'
import { useDebouncedAbortableRequest } from './internal/use-debounced-abortable-request'

export interface DatasetCorrelationState {
  correlation: DraftCorrelationResult | null
  loading: boolean
  error: string | null
}

/**
 * DS-LAKE-005B-D-T05b. Reads `POST .../artifacts/:artifactId/correlation` —
 * server-resolved (near-constant-filtered, ranked, hard-capped) column
 * list + Pearson matrix, never a row payload. Same shape as
 * `useDatasetHistogram`/`useDatasetBoxplot`/`useDatasetScatter`:
 * `operations` fixed at `[]` for now — reactivity to `operations` itself
 * is proven, reactivity to Step 3.1's OWN crop/conditional/statistical
 * rules is gated on the separately-scoped precleanse-engine port.
 *
 * NOT YET WIRED into `DataAnalysisCard`'s correlation tab — see this
 * file's own history: DS-LAKE-005B-D-T07 owns that wiring.
 *
 * DS-LAKE-005B-D-T06: debounce/abort-on-supersede/cache come from the
 * shared `useDebouncedAbortableRequest` — see that hook's own doc comment.
 * CACHE KEY DISCIPLINE matters MOST here of the four chart hooks: this
 * task's own scope_note calls out correlation by name — a cache keyed
 * only on `operations` would serve a stale matrix after a `topK` change
 * or a ranking flip, since those change WHICH columns get resolved with
 * IDENTICAL operations. `topK` is in the key below for exactly that
 * reason.
 */
export function useDatasetCorrelation(
  draftId: string | null,
  artifactId: string | null,
  tags: string[],
  operations: CleaningOperationInput[] = [],
  /** Forwarded as-is. No caller sets this yet — `undefined` lets the
   * server apply its own default (`DEFAULT_CORRELATION_TOP_K = 20`). */
  topK?: number,
): DatasetCorrelationState {
  const [correlation, setCorrelation] = useState<DraftCorrelationResult | null>(
    null,
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const tagsKey = tags.join(',')
  const opsKey = JSON.stringify(operations)

  const enabled = !!draftId && !!artifactId && tags.length > 0
  const cacheKey = enabled
    ? `correlation|${draftId}|${artifactId}|${tagsKey}|${opsKey}|${topK ?? ''}`
    : null

  useDebouncedAbortableRequest<DraftCorrelationResult>({
    enabled,
    cacheKey,
    fetcher: signal =>
      datasetDraftService
        .correlation(
          draftId!,
          artifactId!,
          { operations, tags, ...(topK !== undefined && { topK }) },
          signal,
        )
        .then(res => res.data),
    onLoading: () => {
      setCorrelation(null)
      setError(null)
      setLoading(true)
    },
    onSettled: result => {
      if (result.status === 'ready') {
        setCorrelation(result.data)
      } else {
        setError(result.error)
      }
      setLoading(false)
    },
    onIdle: () => {
      setCorrelation(null)
      setLoading(false)
      setError(null)
    },
  })

  return { correlation, loading, error }
}
