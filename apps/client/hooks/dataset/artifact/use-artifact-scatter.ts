'use client'

import { useEffect, useRef, useState } from 'react'
import { datasetArtifactService } from '@/services/dataset-version'
import type { DraftScatterResult } from '@/services/dataset-draft'
import type { TimeWindow } from '@/lib/time-window'

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
  /** Inclusive window applied server-side. `null`/omitted = whole artifact. */
  timeWindow?: TimeWindow | null,
): ArtifactScatterState {
  // Settled result tagged with the request it answers. `loading` and the
  // reset-to-null on a new request are DERIVED from a key mismatch rather
  // than set synchronously at the top of the effect.
  // Keying on the request also means a stale result from a previous (x, y)
  // pair can never be shown against a new one — the same reset discipline
  // `useDatasetArtifactMetadata` states for itself.
  const [settled, setSettled] = useState<{
    key: string
    scatter: DraftScatterResult | null
    error: string | null
  } | null>(null)
  const tokenRef = useRef(0)
  // Primitives, not the object: a `TimeWindow` is a fresh identity per render.
  const startTime = timeWindow?.startTime
  const endTime = timeWindow?.endTime
  const requestKey =
    datasetId && artifactId && xTag && yTag
      ? JSON.stringify([datasetId, artifactId, xTag, yTag, startTime, endTime])
      : null

  useEffect(() => {
    const token = ++tokenRef.current
    if (!requestKey || !datasetId || !artifactId || !xTag || !yTag) return

    const ac = new AbortController()

    datasetArtifactService
      .scatter(
        datasetId,
        artifactId,
        {
          xTag,
          yTag,
          ...(startTime && { startTime }),
          ...(endTime && { endTime }),
        },
        ac.signal,
      )
      .then(res => {
        if (tokenRef.current !== token) return
        setSettled({ key: requestKey, scatter: res.data, error: null })
      })
      .catch((err: unknown) => {
        if (tokenRef.current !== token) return
        // An abort is a supersede, not a failure — surfacing it would flash
        // an error every time the user flips an axis.
        if ((err as Error)?.name === 'AbortError') return
        setSettled({
          key: requestKey,
          scatter: null,
          error: err instanceof Error ? err.message : 'Failed to load scatter',
        })
      })

    return () => ac.abort()
  }, [requestKey, datasetId, artifactId, xTag, yTag, startTime, endTime])

  const current = settled?.key === requestKey ? settled : null
  return {
    scatter: current?.scatter ?? null,
    loading: requestKey !== null && current === null,
    error: current?.error ?? null,
  }
}
