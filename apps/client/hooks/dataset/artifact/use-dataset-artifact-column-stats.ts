'use client'

import { useEffect, useRef, useState } from 'react'
import { datasetArtifactService } from '@/services/dataset-version'
import type { ArtifactColumnStatsResult } from '@/services/dataset-version'

/**
 * Reads the artifact's `column_stats.json` sidecar — one object download
 * regardless of tag count, `data.parquet` never opened. No `tags` argument:
 * the sidecar is whole-artifact by design, so there is nothing to filter
 * or page server-side.
 *
 * `missing` is deliberately separate from `error`. A 404 here means this
 * artifact has no sidecar (written before DS-LAKE-005B-A-T07, or by a path
 * that produced none) — a normal state with its own UI copy, not a failure
 * to retry.
 */
export function useArtifactColumnStats(
  datasetId: string | null,
  artifactId: string | null,
) {
  // Settled result tagged with the request it answers. `loading` and the
  // reset on a new request are DERIVED from a key mismatch rather than set
  // synchronously at the top of the effect.
  const [settled, setSettled] = useState<{
    key: string
    columnStats: ArtifactColumnStatsResult | null
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
        const res = await datasetArtifactService.columnStats(
          datasetId,
          artifactId,
        )
        if (tokenRef.current !== token) return
        setSettled({
          key: requestKey,
          columnStats: res.data,
          missing: false,
          error: null,
        })
      } catch (err) {
        if (tokenRef.current !== token) return
        const status = (err as { statusCode?: number })?.statusCode
        setSettled({
          key: requestKey,
          columnStats: null,
          missing: status === 404,
          error:
            status === 404
              ? null
              : err instanceof Error
                ? err.message
                : 'Failed to load statistics',
        })
      }
    })()
  }, [requestKey, datasetId, artifactId])

  const current = settled?.key === requestKey ? settled : null
  return {
    columnStats: current?.columnStats ?? null,
    loading: requestKey !== null && current === null,
    missing: current?.missing ?? false,
    error: current?.error ?? null,
  }
}
