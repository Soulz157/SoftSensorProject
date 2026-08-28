'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { datasetVersionService } from '@/services/dataset-version'
import { pollDatasetJobUntilTerminal } from '@/lib/poll-preprocessing-job'

export type DatasetExportStatus = 'idle' | 'running' | 'ready' | 'error'

export interface UseDatasetExportResult {
  status: DatasetExportStatus
  error: string | null
  start: () => Promise<void>
  cancel: () => void
  download: () => Promise<void>
}

/**
 * DS-LAKE-021-T03. Owns start -> poll -> (on click) fresh-presign-and-open
 * for a saved dataset's "Export CSV" control. `download` fetches a NEW URL
 * on every call rather than caching one from job completion — presigned
 * URLs expire, so a link minted at job-ready time could be stale by the
 * time the user actually clicks Download.
 *
 * Deliberately does NOT expose rowCount/columnCount on its own return
 * value. The obvious source — `datasetArtifactService.metadata` against
 * the new EXPORT artifact — calls Python's `/v1/preprocess/metadata`,
 * which parses the object as PARQUET; an EXPORT artifact's `objectKey` is
 * `export.csv`, so that call would fail. The export never drops or adds
 * rows/columns relative to the FINAL artifact it reads from (Global
 * Constraint, DS-LAKE-021 plan — holdout rows are structurally absent from
 * FINAL, and `__status` columns are the only ones ever dropped, which
 * FINAL's own `columnCount` already excludes), so a caller that already
 * has the FINAL artifact's row/column counts — every consumer here does —
 * should display those rather than triggering a second, broken call.
 */
export function useDatasetExport(
  datasetId: string | null,
): UseDatasetExportResult {
  const [status, setStatus] = useState<DatasetExportStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [artifactId, setArtifactId] = useState<string | null>(null)
  const cancelledRef = useRef(false)

  // A caller like `DatasetDetailSheet` reuses ONE hook instance across
  // every dataset a user opens (its own doc comment: "ONE sheet is
  // rendered per page"). Without this reset, a Download button left in
  // `ready` state from dataset A would still render — and still point at
  // dataset A's export artifact id — after switching to dataset B.
  useEffect(() => {
    cancelledRef.current = true
    setStatus('idle')
    setError(null)
    setArtifactId(null)
  }, [datasetId])

  const start = useCallback(async () => {
    if (!datasetId) return
    cancelledRef.current = false
    setStatus('running')
    setError(null)
    try {
      const started = await datasetVersionService.startExport(datasetId)
      const terminal = await pollDatasetJobUntilTerminal(
        datasetId,
        started.data.jobId,
        () => cancelledRef.current,
      )
      if (!terminal) return // cancelled
      if (terminal.status === 'SUCCEEDED' && terminal.resultArtifactId) {
        setArtifactId(terminal.resultArtifactId)
        setStatus('ready')
      } else {
        setStatus('error')
        setError(terminal.error ?? 'Export failed.')
      }
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Could not start export.')
    }
  }, [datasetId])

  const cancel = useCallback(() => {
    cancelledRef.current = true
    setStatus('idle')
  }, [])

  const download = useCallback(async () => {
    if (!datasetId || !artifactId) return
    try {
      const res = await datasetVersionService.exportDownload(
        datasetId,
        artifactId,
      )
      window.open(res.data.downloadUrl, '_blank', 'noreferrer')
    } catch (err) {
      setStatus('error')
      setError(
        err instanceof Error ? err.message : 'Could not download export.',
      )
    }
  }, [datasetId, artifactId])

  return { status, error, start, cancel, download }
}
