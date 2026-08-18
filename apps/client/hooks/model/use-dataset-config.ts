'use client'

import { useEffect, useState } from 'react'
import { datasetService } from '@/services/dataset'
import type { PipelineConfig } from '@/lib/pipeline-config'

interface UseDatasetConfigResult {
  pipelineConfig: PipelineConfig | null
  datasetName: string | null
  loading: boolean
  error: string | null
}

/**
 * Fetches a saved dataset's `pipelineConfig` (the literal pipeline_config.json)
 * for display — e.g. the "Pipeline" tab of the model View-config dialog. Only
 * fetches when `enabled` and a `datasetId` is present; re-fetches when the id
 * changes and ignores stale responses on unmount/id-change.
 */
export function useDatasetConfig(
  datasetId: string | null,
  enabled: boolean,
): UseDatasetConfigResult {
  const [pipelineConfig, setPipelineConfig] = useState<PipelineConfig | null>(
    null,
  )
  const [datasetName, setDatasetName] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled || !datasetId) return

    let active = true
    setLoading(true)
    setError(null)
    datasetService
      .get(datasetId)
      .then(res => {
        if (!active) return
        setPipelineConfig(res.data.pipelineConfig)
        setDatasetName(res.data.name)
      })
      .catch(() => {
        if (!active) return
        setError('Failed to load dataset pipeline configuration.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [datasetId, enabled])

  return { pipelineConfig, datasetName, loading, error }
}
