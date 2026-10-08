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
  const [columnStats, setColumnStats] =
    useState<ArtifactColumnStatsResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tokenRef = useRef(0)

  useEffect(() => {
    const token = ++tokenRef.current
    setColumnStats(null)
    setMissing(false)
    setError(null)

    if (!datasetId || !artifactId) {
      setLoading(false)
      return
    }

    setLoading(true)
    void (async () => {
      try {
        const res = await datasetArtifactService.columnStats(
          datasetId,
          artifactId,
        )
        if (tokenRef.current !== token) return
        setColumnStats(res.data)
        setLoading(false)
      } catch (err) {
        if (tokenRef.current !== token) return
        const status = (err as { statusCode?: number })?.statusCode
        if (status === 404) {
          setMissing(true)
        } else {
          setError(
            err instanceof Error ? err.message : 'Failed to load statistics',
          )
        }
        setLoading(false)
      }
    })()
  }, [datasetId, artifactId])

  return { columnStats, loading, missing, error }
}
