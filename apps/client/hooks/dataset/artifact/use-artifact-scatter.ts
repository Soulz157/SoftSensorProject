'use client'

import { useEffect, useRef, useState } from 'react'
import { datasetArtifactService } from '@/services/dataset-version'
import type { DraftScatterResult } from '@/services/dataset-draft'

export interface ArtifactScatterState {
  scatter: DraftScatterResult | null
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
export function useArtifactScatter(
  datasetId: string | null,
  artifactId: string | null,
  xTag: string | null,
  yTag: string | null,
): ArtifactScatterState {
  const [scatter, setScatter] = useState<DraftScatterResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tokenRef = useRef(0)

  useEffect(() => {
    // Cleared at the start of every run so a stale result from a previous
    // (x, y) pair can never be shown against a new one — the same reset
    // discipline `useDatasetArtifactMetadata` states for itself.
    const token = ++tokenRef.current
    setScatter(null)
    setError(null)

    if (!datasetId || !artifactId || !xTag || !yTag) {
      setLoading(false)
      return
    }

    const ac = new AbortController()
    setLoading(true)

    datasetArtifactService
      .scatter(datasetId, artifactId, { xTag, yTag }, ac.signal)
      .then(res => {
        if (tokenRef.current !== token) return
        setScatter(res.data)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (tokenRef.current !== token) return
        // An abort is a supersede, not a failure — surfacing it would flash
        // an error every time the user flips an axis.
        if ((err as Error)?.name === 'AbortError') return
        setError(err instanceof Error ? err.message : 'Failed to load scatter')
        setLoading(false)
      })

    return () => ac.abort()
  }, [datasetId, artifactId, xTag, yTag])

  return { scatter, loading, error }
}
