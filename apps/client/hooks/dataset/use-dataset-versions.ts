'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  datasetVersionService,
  type DatasetVersion,
} from '@/services/dataset-version'

/**
 * MODEL-SERVE-015-T06. The saved versions of one dataset, for the detail
 * sheet's version list.
 *
 * This exists because the only other reader of `datasetVersionService.list`
 * that renders anything is the retrain dialog's picker, which filters the
 * rows down to what a retrain may consume. A dataset's own history needs the
 * unfiltered list — including the augmented versions a retrain minted, which
 * were previously unreachable from any browsing surface.
 *
 * Fetching stays here rather than in the component per the repo's split:
 * pages and components are shells, data lives in hooks.
 */
export function useDatasetVersions(datasetId: string | null) {
  const [versions, setVersions] = useState<DatasetVersion[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!datasetId) {
        setVersions([])
        return
      }
      setLoading(true)
      setError(null)
      try {
        const res = await datasetVersionService.list(datasetId)
        if (signal?.aborted) return
        // Newest first: a dataset's most recent version is what an operator
        // is nearly always looking for, and an augmented retrain's output is
        // by definition the newest row.
        setVersions(
          [...(res.data ?? [])].sort(
            (a, b) => b.versionNumber - a.versionNumber,
          ),
        )
      } catch (err) {
        if (signal?.aborted) return
        // Surfaced, never swallowed — an empty list and a failed fetch must
        // not look identical to the operator.
        setError(
          err instanceof Error
            ? err.message
            : 'Failed to load dataset versions',
        )
        setVersions([])
      } finally {
        if (!signal?.aborted) setLoading(false)
      }
    },
    [datasetId],
  )

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  return { versions, loading, error, refetch: load }
}
