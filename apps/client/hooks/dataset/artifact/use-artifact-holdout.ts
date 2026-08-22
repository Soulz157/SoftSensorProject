'use client'

import { useEffect, useRef, useState } from 'react'
import { datasetArtifactService } from '@/services/dataset-version'
import type { ArtifactHoldout } from '@/services/dataset-version'

/**
 * MODEL-FLOW-010-T06. Reads the raw validation holdout window for an
 * artifact's run, via the BRONZE-sibling lookup `getArtifactHoldoutService`
 * performs server-side — no client-facing route exposed this before.
 *
 * `holdout: null` (with no `error`) is the NORMAL, common case: most
 * datasets have no holdout, and the endpoint returns 200 with a null
 * payload rather than a 404 for that — so this hook has no `missing` state
 * the way `useArtifactColumnStats` does. `error` is reserved for an actual
 * transport failure.
 */
export function useArtifactHoldout(
  datasetId: string | null,
  artifactId: string | null,
) {
  const [holdout, setHoldout] = useState<ArtifactHoldout | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tokenRef = useRef(0)

  useEffect(() => {
    const token = ++tokenRef.current
    setHoldout(null)
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
        setError(
          err instanceof Error
            ? err.message
            : 'Failed to load validation holdout',
        )
        setLoading(false)
      }
    })()
  }, [datasetId, artifactId])

  return { holdout, loading, error }
}
