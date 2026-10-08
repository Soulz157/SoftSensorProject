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
  const [loading, setLoading] = useState(() => !!datasetId)
  const [error, setError] = useState<string | null>(null)

  // A new dataset starts loading (or, with none, empties) from the first
  // render that sees it — adjusted during render, not in the effect below.
  const [prevDatasetId, setPrevDatasetId] = useState(datasetId)
  if (prevDatasetId !== datasetId) {
    setPrevDatasetId(datasetId)
    setLoading(!!datasetId)
    setError(null)
    if (!datasetId) setVersions([])
  }

  // Sets state only after the await, so the mount/key effect can call it.
  const fetchVersions = useCallback(
    async (signal?: AbortSignal) => {
      if (!datasetId) return
      // Promise callbacks rather than try/catch: every setState here must run
      // after the request settles, never synchronously inside the effect.
      await datasetVersionService
        .list(datasetId)
        .then(
          res => {
            if (signal?.aborted) return
            // Newest first: a dataset's most recent version is what an
            // operator is nearly always looking for, and an augmented
            // retrain's output is by definition the newest row.
            setVersions(
              [...(res.data ?? [])].sort(
                (a, b) => b.versionNumber - a.versionNumber,
              ),
            )
          },
          (err: unknown) => {
            if (signal?.aborted) return
            // Surfaced, never swallowed — an empty list and a failed fetch
            // must not look identical to the operator.
            setError(
              err instanceof Error
                ? err.message
                : 'Failed to load dataset versions',
            )
            setVersions([])
          },
        )
        .finally(() => {
          if (!signal?.aborted) setLoading(false)
        })
    },
    [datasetId],
  )

  const refetch = useCallback(
    async (signal?: AbortSignal) => {
      if (datasetId) {
        setLoading(true)
        setError(null)
      }
      await fetchVersions(signal)
    },
    [datasetId, fetchVersions],
  )

  useEffect(() => {
    const controller = new AbortController()
    void fetchVersions(controller.signal)
    return () => controller.abort()
  }, [fetchVersions])

  return { versions, loading, error, refetch }
}
