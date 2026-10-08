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
  // Settled result tagged with the request it answers. `loading` and the
  // reset-to-null on a new request are DERIVED from a key mismatch rather
  // than set synchronously at the top of the effect.
  const [settled, setSettled] = useState<{
    key: string
    holdout: ArtifactHoldout | null
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
        const res = await datasetArtifactService.holdout(datasetId, artifactId)
        if (tokenRef.current !== token) return
        setSettled({
          key: requestKey,
          holdout: res.data.holdout,
          missing: false,
          error: null,
        })
      } catch (err) {
        if (tokenRef.current !== token) return
        const status = (err as { statusCode?: number })?.statusCode
        setSettled({
          key: requestKey,
          holdout: null,
          missing: status === 404,
          error:
            status === 404
              ? null
              : err instanceof Error
                ? err.message
                : 'Failed to load validation holdout',
        })
      }
    })()
  }, [requestKey, datasetId, artifactId])

  const current = settled?.key === requestKey ? settled : null
  return {
    holdout: current?.holdout ?? null,
    loading: requestKey !== null && current === null,
    missing: current?.missing ?? false,
    error: current?.error ?? null,
  }
}
