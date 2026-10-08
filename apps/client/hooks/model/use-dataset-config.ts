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
  // Settled result tagged with the request it answers. `loading` and the
  // cleared error on a new request are DERIVED from a key mismatch rather
  // than set synchronously in the effect. The last loaded config survives a
  // failed or disabled load, as before.
  const [settled, setSettled] = useState<{
    key: string
    pipelineConfig: PipelineConfig | null
    datasetName: string | null
    error: string | null
  } | null>(null)

  const requestKey = enabled && datasetId ? datasetId : null

  useEffect(() => {
    if (!requestKey) return

    let active = true
    datasetService.get(requestKey).then(
      res => {
        if (!active) return
        setSettled({
          key: requestKey,
          pipelineConfig: res.data.pipelineConfig,
          datasetName: res.data.name,
          error: null,
        })
      },
      () => {
        if (!active) return
        setSettled(prev => ({
          key: requestKey,
          pipelineConfig: prev?.pipelineConfig ?? null,
          datasetName: prev?.datasetName ?? null,
          error: 'Failed to load dataset pipeline configuration.',
        }))
      },
    )

    return () => {
      active = false
    }
  }, [requestKey])

  const current = settled?.key === requestKey ? settled : null
  return {
    pipelineConfig: settled?.pipelineConfig ?? null,
    datasetName: settled?.datasetName ?? null,
    loading: requestKey !== null && current === null,
    error: current?.error ?? null,
  }
}
