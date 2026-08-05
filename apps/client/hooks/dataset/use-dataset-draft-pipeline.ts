'use client'

import { useCallback, useRef, useState } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import {
  datasetDraftService,
  type DraftPreviewResult,
} from '@/services/dataset-draft'
import type { PreprocessingJobStatus } from '@/services/dataset-version'
import { toCleaningOperations } from '@/lib/cleaning-op-mapper'
import {
  toPiTime,
  resolveInterval,
  piFetchInputError,
} from '@/lib/dataset-fetch'
import type { CleaningStep } from '@/lib/preprocessing'
import {
  dwWorkspaceIdAtom,
  dwSelectedSourcesAtom,
  dwCustomDateRangeAtom,
  dwCustomIntervalAtom,
  dwFetchConfigAtom,
  dwTimeRangeAtom,
  dwDraftIdAtom,
  dwDraftArtifactIdAtom,
  dwDraftSyncStateAtom,
} from '@/store/dataset-studio'

const TERMINAL: PreprocessingJobStatus[] = ['SUCCEEDED', 'FAILED', 'CANCELED']
const POLL_MS = 1_200
/**
 * T01 hybrid debounce. The scrubber reaching its final step is a discrete
 * event, not a keystroke stream, but a short debounce still collapses a rapid
 * re-render burst (e.g. tag-selection churn) into one network call.
 */
const PREVIEW_DEBOUNCE_MS = 600

export interface FinalPreviewState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  data?: DraftPreviewResult
  error?: string
}

export interface UseDatasetDraftPipelineResult {
  syncState: { status: 'idle' | 'syncing' | 'synced' | 'error'; error?: string }
  jobId: string | null
  /**
   * Best-effort server sync for a saved cleaning batch. Never throws — a
   * failure lands in `syncState`, exactly like the fetch hook's own error
   * branch, so a server hiccup cannot block the existing local Save flow.
   */
  applyClean: (tags: string[], steps: CleaningStep[]) => Promise<void>
  cancel: () => Promise<void>
  retry: () => Promise<void>
  /** T01 hybrid — see `finalPreview` doc below. */
  finalPreview: FinalPreviewState
  /**
   * Debounced server-verified preview. Call with `([], [])` (or any empty
   * pipeline) to reset to idle — the caller is expected to do this whenever
   * the scrubber is NOT on the final step, so a stale server preview cannot
   * be shown next to a local preview of an earlier step.
   */
  requestFinalPreview: (tags: string[], steps: CleaningStep[]) => void
}

/**
 * Draft-first server sync for Step 3.2 (DS-LAKE-005 T02/T04).
 *
 * "Local preview, server on Apply" (user-confirmed UX): the interactive panel
 * keeps computing `preprocessPipelines` in the browser for instant feedback —
 * this hook changes NOTHING about that. What it adds is a real SILVER
 * artifact behind "Save Cleaned Tags", closing the dead-code finding that
 * `datasetVersionService.clean/job/cancelJob/retryJob` (now their draft-scoped
 * equivalents) had zero callers.
 *
 * Ensures a DatasetDraft and a BRONZE artifact exist (lazily, on first Apply),
 * using the SAME fetch context Step 2 already used — sourceId/tags/time range
 * come straight off the wizard's own atoms, not off `dwRawDatasetAtom`, so the
 * server refetches from source rather than trusting the browser's copy.
 */
export function useDatasetDraftPipeline(): UseDatasetDraftPipelineResult {
  const workspaceId = useAtomValue(dwWorkspaceIdAtom)
  const selectedSources = useAtomValue(dwSelectedSourcesAtom)
  const customDateRange = useAtomValue(dwCustomDateRangeAtom)
  const customInterval = useAtomValue(dwCustomIntervalAtom)
  const fetchConfig = useAtomValue(dwFetchConfigAtom)
  const period = useAtomValue(dwTimeRangeAtom)

  const [draftId, setDraftId] = useAtom(dwDraftIdAtom)
  const [artifactId, setArtifactId] = useAtom(dwDraftArtifactIdAtom)
  const [syncState, setSyncState] = useAtom(dwDraftSyncStateAtom)
  const [jobId, setJobId] = useState<string | null>(null)
  const [finalPreview, setFinalPreview] = useState<FinalPreviewState>({
    status: 'idle',
  })
  const cancelledRef = useRef(false)
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Ignore a response that lands after a newer request superseded it —
  // otherwise a slow first preview could overwrite a faster later one.
  const previewTokenRef = useRef(0)

  const ensureDraft = useCallback(async (): Promise<string> => {
    if (draftId) return draftId
    // Same single-PI-source scope as the wizard's live fetch (F8) — no
    // separate rule invented here.
    const source = selectedSources.find(s => s.type === 'aveva')
    if (!source) {
      throw new Error(
        'Server sync currently supports PI / AVEVA sources, same as the wizard fetch.',
      )
    }
    const res = await datasetDraftService.create({
      workspaceId,
      sourceIds: [source.id],
    })
    setDraftId(res.data.id)
    return res.data.id
  }, [draftId, workspaceId, selectedSources, setDraftId])

  const ensureBronze = useCallback(
    async (id: string, tags: string[]): Promise<string> => {
      if (artifactId) return artifactId
      const guard = piFetchInputError(
        selectedSources,
        tags,
        customDateRange?.from,
        customDateRange?.to,
      )
      if (!guard.ok) throw new Error(guard.error)

      const summaryDuration =
        fetchConfig.summaryDuration.trim() ||
        resolveInterval(period, customInterval)

      const res = await datasetDraftService.materialize(id, {
        sourceId: guard.source.id,
        tags,
        startTime: toPiTime(customDateRange!.from),
        endTime: toPiTime(customDateRange!.to),
        summaryDuration,
      })
      setArtifactId(res.data.id)
      return res.data.id
    },
    [
      artifactId,
      selectedSources,
      customDateRange,
      customInterval,
      fetchConfig,
      period,
      setArtifactId,
    ],
  )

  const pollUntilTerminal = useCallback(
    async (id: string, job: string): Promise<void> => {
      while (!cancelledRef.current) {
        const res = await datasetDraftService.job(id, job)
        if (TERMINAL.includes(res.data.status)) {
          if (res.data.status === 'SUCCEEDED') {
            setSyncState({ status: 'synced' })
            // A completed clean is the source for the NEXT clean job, so it
            // joins its own artifact chain rather than the bronze's.
            if (res.data.resultArtifactId) {
              setArtifactId(res.data.resultArtifactId)
            }
          } else if (res.data.status === 'FAILED') {
            setSyncState({
              status: 'error',
              error: res.data.error ?? 'Cleaning job failed.',
            })
          } else {
            setSyncState({ status: 'idle' })
          }
          return
        }
        await new Promise(resolve => setTimeout(resolve, POLL_MS))
      }
    },
    [setSyncState, setArtifactId],
  )

  const applyClean = useCallback(
    async (tags: string[], steps: CleaningStep[]) => {
      if (tags.length === 0 || steps.length === 0) return
      cancelledRef.current = false
      setSyncState({ status: 'syncing' })
      try {
        const id = await ensureDraft()
        const source = await ensureBronze(id, tags)
        const operations = toCleaningOperations(steps, tags)
        const res = await datasetDraftService.clean(id, source, { operations })
        setJobId(res.data.jobId)
        await pollUntilTerminal(id, res.data.jobId)
      } catch (err) {
        setSyncState({
          status: 'error',
          error: err instanceof Error ? err.message : 'Server sync failed.',
        })
      }
    },
    [ensureDraft, ensureBronze, pollUntilTerminal, setSyncState],
  )

  const requestFinalPreview = useCallback(
    (tags: string[], steps: CleaningStep[]) => {
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current)
      if (tags.length === 0 || steps.length === 0) {
        previewTokenRef.current += 1
        setFinalPreview({ status: 'idle' })
        return
      }
      const token = ++previewTokenRef.current
      previewTimerRef.current = setTimeout(() => {
        void (async () => {
          setFinalPreview({ status: 'loading' })
          try {
            const id = await ensureDraft()
            const source = await ensureBronze(id, tags)
            const operations = toCleaningOperations(steps, tags)
            const res = await datasetDraftService.preview(id, source, {
              operations,
            })
            if (previewTokenRef.current === token) {
              setFinalPreview({ status: 'ready', data: res.data })
            }
          } catch (err) {
            if (previewTokenRef.current === token) {
              setFinalPreview({
                status: 'error',
                error: err instanceof Error ? err.message : 'Preview failed.',
              })
            }
          }
        })()
      }, PREVIEW_DEBOUNCE_MS)
    },
    [ensureDraft, ensureBronze],
  )

  const cancel = useCallback(async () => {
    if (!draftId || !jobId) return
    cancelledRef.current = true
    await datasetDraftService.cancelJob(draftId, jobId)
    setSyncState({ status: 'idle' })
  }, [draftId, jobId, setSyncState])

  const retry = useCallback(async () => {
    if (!draftId || !jobId) return
    cancelledRef.current = false
    setSyncState({ status: 'syncing' })
    try {
      const res = await datasetDraftService.retryJob(draftId, jobId)
      setJobId(res.data.jobId)
      await pollUntilTerminal(draftId, res.data.jobId)
    } catch (err) {
      setSyncState({
        status: 'error',
        error: err instanceof Error ? err.message : 'Retry failed.',
      })
    }
  }, [draftId, jobId, pollUntilTerminal, setSyncState])

  return {
    syncState,
    jobId,
    applyClean,
    cancel,
    retry,
    finalPreview,
    requestFinalPreview,
  }
}
