'use client'

import { useEffect, useRef, useState } from 'react'
import { datasetArtifactService } from '@/services/dataset-version'
import type { ArtifactFeatureSpecResult } from '@/services/dataset-version'

/**
 * DS-LAKE-025-T06. Reads the artifact's `feature_spec.json` sidecar for its
 * `scalingParams` — what each scaler actually FIT — so a display surface can
 * present engineering units from a model-ready artifact's scaled bytes.
 *
 * `missing` is deliberately separate from `error`, exactly as
 * `useArtifactColumnStats` splits them: a 404 here means this artifact has no
 * spec to read (a stage that produces none, such as BRONZE, or a sidecar that
 * is gone from storage). That is a normal state with its own UI copy, not a
 * failure to retry — and a caller that conflates the two ends up blaming the
 * network for a dataset that simply never had a feature stage.
 *
 * A `missing` spec does NOT mean the values are unscaled. It means the fit was
 * never recorded, so they cannot be stated in engineering units at all — the
 * surface must say so rather than render the scaled number as if it were one.
 */
export function useArtifactFeatureSpec(
  datasetId: string | null,
  artifactId: string | null,
) {
  // Settled result tagged with the request it answers. `loading` and the
  // reset-to-null on a new request are DERIVED from a key mismatch rather
  // than set synchronously at the top of the effect.
  const [settled, setSettled] = useState<{
    key: string
    featureSpec: ArtifactFeatureSpecResult | null
    missing: boolean
    error: string | null
  } | null>(null)
  const tokenRef = useRef(0)
  const requestKey =
    datasetId && artifactId ? JSON.stringify([datasetId, artifactId]) : null

  useEffect(() => {
    const token = ++tokenRef.current
    if (!requestKey || !datasetId || !artifactId) return

    void (async () => {
      try {
        const res = await datasetArtifactService.featureSpec(
          datasetId,
          artifactId,
        )
        if (tokenRef.current !== token) return
        setSettled({
          key: requestKey,
          featureSpec: res.data,
          missing: false,
          error: null,
        })
      } catch (err) {
        if (tokenRef.current !== token) return
        const status = (err as { statusCode?: number })?.statusCode
        setSettled({
          key: requestKey,
          featureSpec: null,
          missing: status === 404,
          error:
            status === 404
              ? null
              : err instanceof Error
                ? err.message
                : 'Failed to load the feature specification',
        })
      }
    })()
  }, [requestKey, datasetId, artifactId])

  const current = settled?.key === requestKey ? settled : null
  return {
    featureSpec: current?.featureSpec ?? null,
    loading: requestKey !== null && current === null,
    missing: current?.missing ?? false,
    error: current?.error ?? null,
  }
}
