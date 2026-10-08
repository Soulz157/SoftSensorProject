'use client'

import { useEffect, useRef, useState } from 'react'
import { datasetArtifactService } from '@/services/dataset-version'
import type { DraftCorrelationResult } from '@/services/dataset-draft'
import type { TimeWindow } from '@/lib/time-window'

/**
 * Saved-dataset twin of `useDatasetCorrelation`. Deliberately NOT built on
 * `useDebouncedAbortableRequest`: that hook exists because the draft leg
 * re-fires as the user edits cleaning rules live. A committed artifact
 * cannot change, so this fires once per (dataset, artifact, tags) and has
 * nothing to debounce or supersede.
 */
export function useArtifactCorrelation(
  datasetId: string | null,
  artifactId: string | null,
  tags: string[],
  topK?: number,
  /** DS-LAKE-026. Optional — see `useArtifactHistogram`'s own doc comment
   * for why the compare modal needs this and the wizard's callers do not. */
  sampleRows?: number,
  /** Inclusive window applied server-side. `null`/omitted = whole artifact. */
  timeWindow?: TimeWindow | null,
) {
  // Settled result tagged with the request it answers. `loading` and the
  // reset-to-null on a new request are DERIVED from a key mismatch rather
  // than set synchronously at the top of the effect.
  const [settled, setSettled] = useState<{
    key: string
    correlation: DraftCorrelationResult | null
  } | null>(null)
  const tokenRef = useRef(0)

  // Fresh array identity every render — key the effect on the joined
  // string, or it re-fires forever.
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
          topK,
          sampleRows,
          startTime,
          endTime,
        ])
      : null

  useEffect(() => {
    const token = ++tokenRef.current
    if (!requestKey || !datasetId || !artifactId) return

    const ac = new AbortController()
    void (async () => {
      try {
        const res = await datasetArtifactService.correlation(
          datasetId,
          artifactId,
          {
            tags: tagsKey.split(','),
            ...(topK !== undefined && { topK }),
            ...(sampleRows && { sampleRows }),
            ...(startTime && { startTime }),
            ...(endTime && { endTime }),
          },
          ac.signal,
        )
        if (tokenRef.current !== token) return
        setSettled({ key: requestKey, correlation: res.data })
      } catch (err) {
        if (tokenRef.current !== token || (err as Error)?.name === 'AbortError')
          return
        setSettled({ key: requestKey, correlation: null })
      }
    })()

    return () => ac.abort()
  }, [
    requestKey,
    datasetId,
    artifactId,
    tagsKey,
    topK,
    sampleRows,
    startTime,
    endTime,
  ])

  const current = settled?.key === requestKey ? settled : null
  return {
    correlation: current?.correlation ?? null,
    loading: requestKey !== null && current === null,
  }
}
