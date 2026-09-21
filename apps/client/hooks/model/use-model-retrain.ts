'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ApiError } from '@/lib/fetcher'
import {
  modelRetrainService,
  modelRunLogsService,
  type RetrainComparison,
  type RetrainIncumbent,
  type RetrainJob,
} from '@/services/model-retrain'
import type {
  CandidateInput,
  ModelTrainingRunLog,
} from '@/services/model-draft'
import {
  newIdempotencyKey,
  retrainPhase,
  type RetrainPhase,
} from '@/lib/retrain'
import {
  clearDismissedJobId,
  readDismissedJobId,
  writeDismissedJobId,
} from '@/lib/retrain-dismissal'
import type { AIModel } from '@/types'

/** Same cadence `use-model-training.ts`'s own `pollRun` uses for a training
 *  container — matched here rather than inventing a second constant. */
const POLL_MS = 2500

const LIVE_STATUSES = new Set(['QUEUED', 'RUNNING'])

export interface UseModelRetrain {
  /** The PRODUCTION version this model would retrain against, resolved
   *  independently of any job. Null means there is nothing to improve on —
   *  the dialog should disable with that explanation rather than let the
   *  user submit into a guaranteed 404. */
  incumbent: RetrainIncumbent | null
  /** The live or most recently completed retrain job for this model, or
   *  null when none has ever run. Restored from the server on mount/model
   *  change and on every poll tick — never local-only state, so a refresh
   *  or a second tab reconstructs the same view (MODEL-SERVE-014-T03/T07). */
  job: RetrainJob | null
  comparison: RetrainComparison | null
  phase: RetrainPhase
  /** Real container log lines for the job's current candidate run — never
   *  scripted client-side. Empty until the first candidate has a run. */
  logs: ModelTrainingRunLog[]
  /** True while `job.status` is QUEUED or RUNNING — drives button/dialog
   *  disabled state. Independent of `loading` (the initial fetch). */
  isRetraining: boolean
  /** True only for the initial `current()` fetch on mount/model change. */
  loading: boolean
  /** The real backend message from the last failed action (validation,
   *  conflict, authorization, execution) — never invented copy. */
  error: string | null
  /** `candidates` omitted = Auto Finetune (server expands the incumbent's
   *  own algorithm through the curated tuning grid). Present = Custom
   *  Finetune's one candidate. MODEL-SERVE-015: `options.strategy` omitted
   *  = 'KEEP_EXISTING' (014's own behavior, unaffected); 'AUGMENT_DATA'
   *  requires `options.additionalDatasetVersionId`. */
  start: (
    candidates?: CandidateInput[],
    options?: {
      strategy?: 'KEEP_EXISTING' | 'AUGMENT_DATA'
      additionalDatasetVersionId?: string
    },
  ) => Promise<void>
  /** Clears the last error only — the job itself is server state and is
   *  never reset from the client. */
  clearError: () => void
  /** True when THIS viewer has closed the current job's result section.
   *  A per-viewer preference only — the job itself is untouched, and a
   *  NEW retrain shows again without being un-dismissed. */
  dismissed: boolean
  /** Close the result section for the current job. */
  dismiss: () => void
  /** Re-read the server's retrain state. Needed after an action that
   *  changes it from OUTSIDE this hook — promoting the retrained version
   *  moves it STAGING -> PRODUCTION, and without this the result card would
   *  keep offering "Apply to Production" for a version already live. */
  refresh: () => void
}

export function useModelRetrain({
  model,
  onUpdated,
}: {
  model: AIModel | null
  onUpdated?: () => void
}): UseModelRetrain {
  const [incumbent, setIncumbent] = useState<RetrainIncumbent | null>(null)
  const [job, setJob] = useState<RetrainJob | null>(null)
  const [logs, setLogs] = useState<ModelTrainingRunLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  // Read lazily (never during render) — `localStorage` is unavailable on the
  // server and can throw in a private window.
  const [dismissedJobId, setDismissedJobId] = useState<string | null>(null)
  const idempotencyKeyRef = useRef<string | null>(null)
  const notifiedTerminalRef = useRef<string | null>(null)

  const modelId = model?.id ?? null

  const fetchLogs = useCallback(async (mId: string, runId: string) => {
    try {
      const run = await modelRunLogsService.get(mId, runId)
      setLogs(run.logs)
    } catch {
      // Soft-fail — the stage boxes and status still come from `job`
      // itself; a log-read hiccup must not blank the whole panel.
    }
  }, [])

  // Initial load + reload on model change: restores whatever the server
  // already knows, so this survives a refresh or a second tab.
  useEffect(() => {
    idempotencyKeyRef.current = null
    notifiedTerminalRef.current = null
    if (!modelId) {
      setIncumbent(null)
      setJob(null)
      setLogs([])
      setLoading(false)
      setError(null)
      return
    }

    let ignore = false
    setLoading(true)
    setDismissedJobId(readDismissedJobId(modelId))
    void (async () => {
      try {
        const res = await modelRetrainService.current(modelId)
        if (ignore) return
        setIncumbent(res.data.incumbent)
        setJob(res.data.job)
        setError(null)
        if (res.data.job?.currentRunId) {
          void fetchLogs(modelId, res.data.job.currentRunId)
        } else {
          setLogs([])
        }
      } catch (err) {
        if (ignore) return
        setError(
          err instanceof Error ? err.message : 'Failed to load retrain state',
        )
      } finally {
        if (!ignore) setLoading(false)
      }
    })()

    return () => {
      ignore = true
    }
  }, [modelId, fetchLogs, reloadKey])

  // Poll while a job is live — stops the moment the job reaches a terminal
  // state, exactly like `use-model-training.ts`'s `pollRun`.
  const jobId = job?.id ?? null
  const jobLive = !!job && LIVE_STATUSES.has(job.status)
  useEffect(() => {
    if (!modelId || !jobId || !jobLive) return
    const tick = async () => {
      try {
        const res = await modelRetrainService.get(modelId, jobId)
        setJob(res.data)
        setError(null)
        if (res.data.currentRunId)
          void fetchLogs(modelId, res.data.currentRunId)
        if (!LIVE_STATUSES.has(res.data.status)) {
          if (notifiedTerminalRef.current !== res.data.id) {
            notifiedTerminalRef.current = res.data.id
            if (res.data.status === 'SUCCEEDED') {
              toast.success(`${model?.name ?? 'Model'} retrain complete`)
            } else if (res.data.status === 'FAILED') {
              toast.error(
                res.data.failureReason
                  ? `Retrain failed — ${res.data.failureReason}`
                  : 'Retrain failed',
              )
            }
          }
          onUpdated?.()
        }
      } catch {
        // Transient poll miss — next tick retries; `job` keeps its last
        // known state rather than flashing an error over one dropped poll.
      }
    }
    const id = setInterval(() => void tick(), POLL_MS)
    return () => clearInterval(id)
  }, [modelId, jobId, jobLive, fetchLogs, model?.name, onUpdated])

  const start = useCallback(
    async (
      candidates?: CandidateInput[],
      options?: {
        strategy?: 'KEEP_EXISTING' | 'AUGMENT_DATA'
        additionalDatasetVersionId?: string
      },
    ) => {
      if (!modelId || jobLive) return
      if (!idempotencyKeyRef.current) {
        idempotencyKeyRef.current = newIdempotencyKey()
      }
      setError(null)
      try {
        const res = await modelRetrainService.trigger(modelId, {
          idempotencyKey: idempotencyKeyRef.current,
          candidates,
          strategy: options?.strategy,
          additionalDatasetVersionId: options?.additionalDatasetVersionId,
        })
        // A fresh trigger (201) and an idempotent replay (200) return the
        // same job envelope — both handled identically.
        idempotencyKeyRef.current = null
        notifiedTerminalRef.current = null
        clearDismissedJobId(modelId)
        setDismissedJobId(null)
        setJob(res.data)
        if (res.data.currentRunId)
          void fetchLogs(modelId, res.data.currentRunId)
      } catch (err) {
        // A 409 means another retrain is already live for this model — the
        // real in-flight job is recovered from `current()`, never parsed
        // out of the error's prose message.
        if (err instanceof ApiError && err.status === 409) {
          try {
            const res = await modelRetrainService.current(modelId)
            setJob(res.data.job)
            if (res.data.job?.currentRunId) {
              void fetchLogs(modelId, res.data.job.currentRunId)
            }
          } catch {
            // Best-effort recovery — the error message below still surfaces.
          }
        }
        const message =
          err instanceof Error ? err.message : 'Failed to start retrain'
        setError(message)
        toast.error(message)
      }
    },
    [modelId, jobLive, fetchLogs],
  )

  const clearError = useCallback(() => setError(null), [])
  const refresh = useCallback(() => setReloadKey(k => k + 1), [])
  const dismiss = useCallback(() => {
    if (!modelId || !job) return
    writeDismissedJobId(modelId, job.id)
    setDismissedJobId(job.id)
  }, [modelId, job])

  return {
    incumbent,
    job,
    comparison: job?.comparison ?? null,
    phase: retrainPhase(job),
    logs,
    isRetraining: jobLive,
    loading,
    error,
    start,
    clearError,
    refresh,
    // Scoped to the CURRENT job — a later retrain is a different id and
    // renders without the viewer having to re-open anything.
    dismissed: job !== null && dismissedJobId === job.id,
    dismiss,
  }
}
