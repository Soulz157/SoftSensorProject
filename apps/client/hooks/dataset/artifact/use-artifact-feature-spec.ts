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
  const [featureSpec, setFeatureSpec] =
    useState<ArtifactFeatureSpecResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tokenRef = useRef(0)

  useEffect(() => {
    const token = ++tokenRef.current
    setFeatureSpec(null)
    setMissing(false)
    setError(null)

    if (!datasetId || !artifactId) {
      setLoading(false)
      return
    }

    setLoading(true)
    void (async () => {
      try {
        const res = await datasetArtifactService.featureSpec(
          datasetId,
          artifactId,
        )
        if (tokenRef.current !== token) return
        setFeatureSpec(res.data)
        setLoading(false)
      } catch (err) {
        if (tokenRef.current !== token) return
        const status = (err as { statusCode?: number })?.statusCode
        if (status === 404) {
          setMissing(true)
        } else {
          setError(
            err instanceof Error
              ? err.message
              : 'Failed to load the feature specification',
          )
        }
        setLoading(false)
      }
    })()
  }, [datasetId, artifactId])

  return { featureSpec, loading, missing, error }
}
