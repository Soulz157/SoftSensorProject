'use client'

import { useEffect, useRef, useState } from 'react'
import { datasetArtifactService } from '@/services/dataset-version'
import type { ArtifactHoldout } from '@/services/dataset-version'

/**
 * MODEL-FLOW-010-T06. Reads the raw validation holdout window for an
 * artifact's run, via the by-run-sibling lookup `getArtifactHoldoutService`
 * performs server-side (no longer BRONZE-only — DS-LAKE-022's reordered
 * pipeline can write the split beside SILVER instead).
 *
 * `holdout: null` (with no `error`, no `missing`) is the NORMAL, common
 * case: most datasets have no holdout, and the endpoint returns 200 with a
 * null payload rather than a 404 for that.
 *
 * `missing` is deliberately separate from `error`, mirroring
 * `useArtifactColumnStats`: a 404 here means a holdout WAS recorded but its
 * `validate_data.parquet` sidecar is gone from storage (reclaimed) — a
 * different fact from "no holdout was split" and a different fact from a
 * transport failure, each with its own UI copy.
 */
export function useArtifactHoldout(
  datasetId: string | null,
  artifactId: string | null,
) {
  const [holdout, setHoldout] = useState<ArtifactHoldout | null>(null)
  const [loading, setLoading] = useState(false)
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tokenRef = useRef(0)

  useEffect(() => {
    const token = ++tokenRef.current
    setHoldout(null)
    setMissing(false)
    setError(null)

    if (!datasetId || !artifactId) {
      setLoading(false)
      return
    }

    setLoading(true)
    void (async () => {
      try {
        const res = await datasetArtifactService.holdout(datasetId, artifactId)
        if (tokenRef.current !== token) return
        setHoldout(res.data.holdout)
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
              : 'Failed to load validation holdout',
          )
        }
        setLoading(false)
      }
    })()
  }, [datasetId, artifactId])

  return { holdout, loading, missing, error }
}
