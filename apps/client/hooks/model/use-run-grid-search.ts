'use client'

import { useEffect, useState } from 'react'
import {
  modelDraftRunService,
  type RunGridSearch,
} from '@/services/model-draft'

export interface UseRunGridSearchResult {
  /** `null` once read and absent (a soft-failed read, or none recorded). */
  gridSearch: RunGridSearch | null
  loading: boolean
}

/**
 * MODEL-FLOW-038. One grid-search run's ranked combinations. The run LIST
 * carries only `isGridSearch`; the results live in `grid_search_results.json`,
 * which only the single-run GET reads (`getDraftRunService`), so the Run
 * parameters card fetches it here, for the one run it shows.
 *
 * `loading` is DERIVED from which run id the stored result belongs to, so no
 * state is set synchronously inside the effect.
 */
export function useRunGridSearch(
  draftId: string | null,
  runId: string | null,
): UseRunGridSearchResult {
  const wanted = draftId && runId ? `${draftId}|${runId}` : null
  const [fetched, setFetched] = useState<{
    key: string
    gridSearch: RunGridSearch | null
  } | null>(null)

  useEffect(() => {
    if (!draftId || !runId || !wanted) return
    let ignore = false
    void (async () => {
      let gridSearch: RunGridSearch | null = null
      try {
        const res = await modelDraftRunService.get(draftId, runId)
        gridSearch = res.data.gridSearch ?? null
      } catch {
        gridSearch = null
      }
      if (!ignore) setFetched({ key: wanted, gridSearch })
    })()
    return () => {
      ignore = true
    }
  }, [draftId, runId, wanted])

  const ready = wanted !== null && fetched?.key === wanted
  return {
    gridSearch: ready ? fetched.gridSearch : null,
    loading: wanted !== null && !ready,
  }
}
