'use client'

import { useEffect, useRef, useState } from 'react'
import { datasetArtifactService } from '@/services/dataset-version'
import type { DraftHistogramResult } from '@/services/dataset-draft'

export interface ArtifactHistogramState {
  histogram: DraftHistogramResult | null
  loading: boolean
  error: string | null
}

/**
 * Saved-dataset twin of `useDatasetHistogram`, for edit mode's adopted
 * BRONZE (DS-LAKE-017-T01) — an artifact the draft leg cannot read, since
 * its `draftId` belongs to the draft that originally created it.
 *
 * Deliberately NOT built on `useDebouncedAbortableRequest`. That hook exists
 * because the draft leg re-fires as the user edits cleaning rules live; a
 * committed artifact cannot change, so this fires once per
 * (dataset, artifact, tags) and has nothing to debounce or supersede. Its
 * cache-key discipline is equally moot here for the same reason.
 *
 * `operations` is not a parameter at all — the service sends `[]`. A
 * committed artifact already carries its cleaning baked in.
 */
export function useArtifactHistogram(
  datasetId: string | null,
  artifactId: string | null,
  tags: string[],
): ArtifactHistogramState {
  const [histogram, setHistogram] = useState<DraftHistogramResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tokenRef = useRef(0)

  // `tags` is a fresh array identity every render — key the effect on the
  // joined string, or it re-fires forever.
  const tagsKey = tags.join(',')

  useEffect(() => {
    const token = ++tokenRef.current
    setHistogram(null)
    setError(null)

    if (!datasetId || !artifactId || !tagsKey) {
      setLoading(false)
      return
    }

    const ac = new AbortController()
    setLoading(true)

    datasetArtifactService
      .histogram(datasetId, artifactId, { tags: tagsKey.split(',') }, ac.signal)
      .then(res => {
        if (tokenRef.current !== token) return
        setHistogram(res.data)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (tokenRef.current !== token) return
        if ((err as Error)?.name === 'AbortError') return
        setError(
          err instanceof Error ? err.message : 'Failed to load histogram',
        )
        setLoading(false)
      })

    return () => ac.abort()
  }, [datasetId, artifactId, tagsKey])

  return { histogram, loading, error }
}
