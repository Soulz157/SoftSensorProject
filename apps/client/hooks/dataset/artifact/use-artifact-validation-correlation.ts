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
  // Settled result tagged with the request it answers. `loading` and the
  // reset of every flag on a new request are DERIVED from a key mismatch
  // rather than set synchronously at the top of the effect.
  const [settled, setSettled] = useState<{
    key: string
    correlation: DraftCorrelationResult | null
    missing: boolean
    tagMismatch: boolean
    error: string | null
  } | null>(null)
  const tokenRef = useRef(0)

  // Fresh array identity every render — key the effect on the joined
  // string, or it re-fires forever.
  const tagsKey = tags.join(',')
  const requestKey =
    datasetId && artifactId && tagsKey
      ? JSON.stringify([datasetId, artifactId, tagsKey, topK, sampleRows])
      : null

  useEffect(() => {
    const token = ++tokenRef.current
    if (!requestKey || !datasetId || !artifactId) return

    const ac = new AbortController()

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
        setSettled({
          key: requestKey,
          correlation: res.data,
          missing: false,
          tagMismatch: false,
          error: null,
        })
      })
      .catch((err: unknown) => {
        if (tokenRef.current !== token) return
        if ((err as Error)?.name === 'AbortError') return
        const status = (err as { statusCode?: number })?.statusCode
        setSettled({
          key: requestKey,
          correlation: null,
          missing: status === 404,
          tagMismatch: status === 400,
          error:
            status === 404 || status === 400
              ? null
              : err instanceof Error
                ? err.message
                : 'Failed to load validation correlation',
        })
      })

    return () => ac.abort()
  }, [requestKey, datasetId, artifactId, tagsKey, topK, sampleRows])

  const current = settled?.key === requestKey ? settled : null
  return {
    correlation: current?.correlation ?? null,
    loading: requestKey !== null && current === null,
    missing: current?.missing ?? false,
    tagMismatch: current?.tagMismatch ?? false,
    error: current?.error ?? null,
  }
}
