'use client'

import { useEffect, useRef, useState } from 'react'
import { datasetArtifactService } from '@/services/dataset-version'
import type { DraftBoxplotResult } from '@/services/dataset-draft'

export interface ArtifactValidationBoxplotState {
  boxplot: DraftBoxplotResult | null
  loading: boolean
  /** A 404 — the run's holdout sidecar is gone from storage, or the run has
   * no holdout at all. Distinct from `error`, same discipline
   * `useArtifactValidationRows` already established. */
  missing: boolean
  /** A 400 — at least one requested tag is not a column in the sidecar. A
   * holdout split before feature engineering carries the raw tags only, so
   * a derived feature tag fails the WHOLE request — pyarrow's column
   * projection has no partial-success mode (same discipline
   * `getArtifactValidationRowsService`'s own doc comment establishes for
   * `/validation-rows`). There is no way to learn which tag from this
   * response alone; the caller names the general reason, not a specific
   * tag. */
  tagMismatch: boolean
  error: string | null
}

/**
 * Compare-view twin of `useArtifactBoxplot`, reading the run's
 * `validate_data.parquet` sidecar via `POST .../validation-boxplot` instead
 * of the artifact's own object.
 *
 * `sampleRows` lets the caller cover both sides of a comparison equally —
 * see `useArtifactValidationHistogram`'s own doc comment for why.
 *
 * Deliberately NOT built on `useDebouncedAbortableRequest` — a committed
 * run's holdout cannot change, so this fires once per
 * (dataset, artifact, tags) and has nothing to debounce or supersede.
 */
export function useArtifactValidationBoxplot(
  datasetId: string | null,
  artifactId: string | null,
  tags: string[],
  sampleRows?: number,
): ArtifactValidationBoxplotState {
  const [boxplot, setBoxplot] = useState<DraftBoxplotResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [missing, setMissing] = useState(false)
  const [tagMismatch, setTagMismatch] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tokenRef = useRef(0)

  // `tags` is a fresh array identity every render — key the effect on the
  // joined string, or it re-fires forever.
  const tagsKey = tags.join(',')

  useEffect(() => {
    const token = ++tokenRef.current
    setBoxplot(null)
    setMissing(false)
    setTagMismatch(false)
    setError(null)

    if (!datasetId || !artifactId || !tagsKey) {
      setLoading(false)
      return
    }

    const ac = new AbortController()
    setLoading(true)

    datasetArtifactService
      .validationBoxplot(
        datasetId,
        artifactId,
        {
          tags: tagsKey.split(','),
          ...(sampleRows && { sampleRows }),
        },
        ac.signal,
      )
      .then(res => {
        if (tokenRef.current !== token) return
        setBoxplot(res.data)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (tokenRef.current !== token) return
        if ((err as Error)?.name === 'AbortError') return
        const status = (err as { statusCode?: number })?.statusCode
        if (status === 404) {
          setMissing(true)
        } else if (status === 400) {
          setTagMismatch(true)
        } else {
          setError(
            err instanceof Error
              ? err.message
              : 'Failed to load validation boxplot',
          )
        }
        setLoading(false)
      })

    return () => ac.abort()
  }, [datasetId, artifactId, tagsKey, sampleRows])

  return { boxplot, loading, missing, tagMismatch, error }
}
