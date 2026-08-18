'use client'

import { useState } from 'react'
import { datasetDraftService } from '@/services/dataset-draft'
import type { DraftHistogramResult } from '@/services/dataset-draft'
import type { CleaningOperationInput } from '@/services/dataset-version'
import { useDebouncedAbortableRequest } from './internal/use-debounced-abortable-request'

export interface DatasetHistogramState {
  histogram: DraftHistogramResult | null
  loading: boolean
  error: string | null
}

/**
 * DS-LAKE-005B-D-T01. Reads `POST .../artifacts/:artifactId/histogram` —
 * server-recomputed distribution + KDE for `tags`, never a row payload.
 * First real caller is `DataAnalysisCard`'s Histogram tab.
 *
 * `operations` is fixed at `[]` for now: this task ports the TRANSPORT
 * (server call, reactivity to `operations`, live-verified) but NOT the
 * translation of Step 3.1's own crop/conditional/statistical rules into
 * `CleaningOperation[]` — that gap is real (cleaning_service.py's
 * remove_outlier/clip REPLACE or WINSORIZE values; Step 3.1's rules
 * mark/drop them, and one rule needs an 'absent cell' representation the
 * canonical frame doesn't have yet) and is scoped separately, not silently
 * absorbed into this hook. Until that lands, this tab reads the artifact's
 * COMMITTED state — a real, named divergence from the boxplot/scatter/
 * correlation tabs beside it, which still read the client's `precleansed`
 * frame. Callers should label the tab accordingly rather than imply parity.
 *
 * DS-LAKE-005B-D-T06: debounce/abort-on-supersede/cache now come from the
 * shared `useDebouncedAbortableRequest` — see that hook's own doc comment
 * for the reset/reactivity discipline this hook inherits from it.
 */
export function useDatasetHistogram(
  draftId: string | null,
  artifactId: string | null,
  tags: string[],
  operations: CleaningOperationInput[] = [],
): DatasetHistogramState {
  const [histogram, setHistogram] = useState<DraftHistogramResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Stable dependency keys — `tags`/`operations` are fresh array identities
  // most renders (derived from atoms/hooks upstream), which would otherwise
  // refetch on every render regardless of actual content change.
  const tagsKey = tags.join(',')
  const opsKey = JSON.stringify(operations)

  const enabled = !!draftId && !!artifactId && tags.length > 0
  // CACHE KEY DISCIPLINE (chart-request-cache.ts's own header): every field
  // that determines the response must be in the key, not just `opsKey`.
  const cacheKey = enabled
    ? `histogram|${draftId}|${artifactId}|${tagsKey}|${opsKey}`
    : null

  useDebouncedAbortableRequest<DraftHistogramResult>({
    enabled,
    cacheKey,
    fetcher: signal =>
      datasetDraftService
        .histogram(draftId!, artifactId!, { operations, tags }, signal)
        .then(res => res.data),
    onLoading: () => {
      setHistogram(null)
      setError(null)
      setLoading(true)
    },
    onSettled: result => {
      if (result.status === 'ready') {
        setHistogram(result.data)
      } else {
        setError(result.error)
      }
      setLoading(false)
    },
    onIdle: () => {
      setHistogram(null)
      setLoading(false)
      setError(null)
    },
  })

  return { histogram, loading, error }
}
