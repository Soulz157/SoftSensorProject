'use client'

import { useEffect, useRef, useState } from 'react'
import { datasetArtifactService } from '@/services/dataset-version'
import type { DraftCorrelationResult } from '@/services/dataset-draft'

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
) {
  const [correlation, setCorrelation] = useState<DraftCorrelationResult | null>(
    null,
  )
  const [loading, setLoading] = useState(false)
  const tokenRef = useRef(0)

  // Fresh array identity every render — key the effect on the joined
  // string, or it re-fires forever.
  const tagsKey = tags.join(',')

  useEffect(() => {
    const token = ++tokenRef.current
    setCorrelation(null)

    if (!datasetId || !artifactId || !tagsKey) {
      setLoading(false)
      return
    }

    const ac = new AbortController()
    setLoading(true)
    void (async () => {
      try {
        const res = await datasetArtifactService.correlation(
          datasetId,
          artifactId,
          { tags: tagsKey.split(','), ...(topK !== undefined && { topK }) },
          ac.signal,
        )
        if (tokenRef.current !== token) return
        setCorrelation(res.data)
        setLoading(false)
      } catch (err) {
        if (tokenRef.current !== token || (err as Error)?.name === 'AbortError')
          return
        setCorrelation(null)
        setLoading(false)
      }
    })()

    return () => ac.abort()
  }, [datasetId, artifactId, tagsKey, topK])

  return { correlation, loading }
}
