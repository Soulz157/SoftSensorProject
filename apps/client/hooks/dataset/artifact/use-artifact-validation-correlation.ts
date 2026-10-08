'use client'

import { useEffect, useRef, useState } from 'react'
import { datasetArtifactService } from '@/services/dataset-version'
import type { DraftCorrelationResult } from '@/services/dataset-draft'

export interface ArtifactValidationCorrelationState {
  correlation: DraftCorrelationResult | null
  loading: boolean
  /** A 404 — the run's holdout sidecar is gone from storage, or the run has
   * no holdout at all. Distinct from a genuine "not enough numeric tags"
   * response, same discipline `useArtifactValidationRows` established. */
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
 * Compare-view twin of `useArtifactCorrelation`, reading the run's
 * `validate_data.parquet` sidecar via `POST .../validation-correlation`
 * instead of the artifact's own object.
 *
 * `topK` is passed through unconditionally so the caller can send the same
 * value on both sides of a comparison — see `dataset-compare-modal.tsx`'s
 * Δr wiring, which relies on both sides resolving from an identical
 * candidate universe.
 *
 * Deliberately NOT built on `useDebouncedAbortableRequest` — a committed
 * run's holdout cannot change, so this fires once per
 * (dataset, artifact, tags, topK) and has nothing to debounce or supersede.
 */
export function useArtifactValidationCorrelation(
  datasetId: string | null,
  artifactId: string | null,
  tags: string[],
  topK?: number,
  /** DS-LAKE-026. Optional — see `useArtifactValidationHistogram`'s own doc
   * comment for why both sides of a comparison need this sent explicitly. */
  sampleRows?: number,
): ArtifactValidationCorrelationState {
  const [correlation, setCorrelation] = useState<DraftCorrelationResult | null>(
    null,
  )
  const [loading, setLoading] = useState(false)
  const [missing, setMissing] = useState(false)
  const [tagMismatch, setTagMismatch] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tokenRef = useRef(0)

  // Fresh array identity every render — key the effect on the joined
  // string, or it re-fires forever.
  const tagsKey = tags.join(',')

  useEffect(() => {
    const token = ++tokenRef.current
    setCorrelation(null)
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
      .validationCorrelation(
        datasetId,
        artifactId,
        {
          tags: tagsKey.split(','),
          ...(topK !== undefined && { topK }),
          ...(sampleRows && { sampleRows }),
        },
        ac.signal,
      )
      .then(res => {
        if (tokenRef.current !== token) return
        setCorrelation(res.data)
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
              : 'Failed to load validation correlation',
          )
        }
        setLoading(false)
      })

    return () => ac.abort()
  }, [datasetId, artifactId, tagsKey, topK, sampleRows])

  return { correlation, loading, missing, tagMismatch, error }
}
