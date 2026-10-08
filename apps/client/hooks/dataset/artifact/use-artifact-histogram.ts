'use client'

import { useEffect, useRef, useState } from 'react'
import { datasetArtifactService } from '@/services/dataset-version'
import type { DraftHistogramResult } from '@/services/dataset-draft'
import type { TimeWindow } from '@/lib/time-window'

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
  /** DS-LAKE-026. Optional — the wizard's own callers leave this unset and
   * get the server default unchanged. The compare modal passes an explicit
   * value so its train and validation sides cover the same fraction of
   * their data, rather than one side's head window covering less of itself
   * than the other's. */
  sampleRows?: number,
  /** Inclusive window applied server-side. `null`/omitted = whole artifact. */
  timeWindow?: TimeWindow | null,
): ArtifactHistogramState {
  // Settled result tagged with the request it answers. `loading` and the
  // reset-to-null on a new request are DERIVED from a key mismatch rather
  // than set synchronously at the top of the effect.
  const [settled, setSettled] = useState<{
    key: string
    histogram: DraftHistogramResult | null
    error: string | null
  } | null>(null)
  const tokenRef = useRef(0)

  // `tags` is a fresh array identity every render — key the effect on the
  // joined string, or it re-fires forever.
  const tagsKey = tags.join(',')
  // Primitives, not the object: a `TimeWindow` is a fresh identity per render.
  const startTime = timeWindow?.startTime
  const endTime = timeWindow?.endTime
  const requestKey =
    datasetId && artifactId && tagsKey
      ? JSON.stringify([
          datasetId,
          artifactId,
          tagsKey,
          sampleRows,
          startTime,
          endTime,
        ])
      : null

  useEffect(() => {
    const token = ++tokenRef.current
    if (!requestKey || !datasetId || !artifactId) return

    const ac = new AbortController()

    datasetArtifactService
      .histogram(
        datasetId,
        artifactId,
        {
          tags: tagsKey.split(','),
          ...(sampleRows && { sampleRows }),
          ...(startTime && { startTime }),
          ...(endTime && { endTime }),
        },
        ac.signal,
      )
      .then(res => {
        if (tokenRef.current !== token) return
        setSettled({ key: requestKey, histogram: res.data, error: null })
      })
      .catch((err: unknown) => {
        if (tokenRef.current !== token) return
        if ((err as Error)?.name === 'AbortError') return
        setSettled({
          key: requestKey,
          histogram: null,
          error:
            err instanceof Error ? err.message : 'Failed to load histogram',
        })
      })

    return () => ac.abort()
  }, [
    requestKey,
    datasetId,
    artifactId,
    tagsKey,
    sampleRows,
    startTime,
    endTime,
  ])

  const current = settled?.key === requestKey ? settled : null
  return {
    histogram: current?.histogram ?? null,
    loading: requestKey !== null && current === null,
    error: current?.error ?? null,
  }
}
