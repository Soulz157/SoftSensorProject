'use client'

import { useState } from 'react'
import {
  modelDraftRunService,
  modelDraftService,
  type ModelRunStatus,
} from '@/services/model-draft'
import { fitFromRun, type ModelFit, type FitPoint } from '@/lib/model-metrics'
import { useDebouncedAbortableRequest } from '@/hooks/dataset/internal/use-debounced-abortable-request'

/** Just enough of the run row for Step 4's banner and empty states — not the
 *  full `ModelTrainingRun` (logs, hyperparameters, split spec are not this
 *  hook's concern). */
export interface DraftRunSummary {
  status: ModelRunStatus
  algorithm: string
  targetY: string
  failureReason: string | null
}

export interface DraftRunManifestInfo {
  /** The leakage guard's own record (MODEL-FLOW-000-T02) — non-empty means
   *  this model needs target history at inference time it is not shown
   *  here. Null when the run recorded no manifest. */
  derivedFromTarget: string[] | null
  targetScaled: boolean | null
}

export interface UseDraftRunEvaluationResult {
  run: DraftRunSummary | null
  fit: ModelFit | null
  manifest: DraftRunManifestInfo | null
  loading: boolean
  error: string | null
}

interface EvaluationData {
  run: DraftRunSummary | null
  fit: ModelFit | null
  manifest: DraftRunManifestInfo | null
}

/**
 * Everything the run/predictions calls can fail without a number reaching the
 * screen — a malformed `metrics.r2`/`rmse` violates the invariant this
 * feature is built on (every scalar comes from the run's own metrics.json,
 * never recomputed client-side), so it is refused here rather than silently
 * substituted.
 */
function requireMetric(
  metrics: Record<string, unknown> | null,
  key: 'r2' | 'rmse',
): number {
  const value = metrics?.[key]
  if (typeof value !== 'number') {
    throw new Error(
      `Training run's metrics.json has no numeric '${key}' — cannot show Evaluation.`,
    )
  }
  return value
}

/**
 * `runIdHint` is normally `mpTrainingResultAtom.runId`, set by the poll loop
 * the moment its own run reaches SUCCEEDED — in that path it is always
 * present when this hook is enabled. Null is the defensive case: a SUCCEEDED
 * run exists server-side but nothing client-side recorded its id (e.g. a
 * remount that skipped the reconnect effect). Falls back to
 * `ModelDraft.currentRunId`, the same field `use-model-training.ts`'s own
 * reconnect effect already trusts for this exact situation.
 */
async function resolveRunId(
  draftId: string,
  runIdHint: string | null,
): Promise<string | null> {
  if (runIdHint) return runIdHint
  const draftRes = await modelDraftService.get(draftId)
  return draftRes.data.currentRunId
}

async function fetchEvaluation(
  draftId: string,
  runIdHint: string | null,
): Promise<EvaluationData> {
  const runId = await resolveRunId(draftId, runIdHint)
  if (!runId) return { run: null, fit: null, manifest: null }

  const runRes = await modelDraftRunService.get(draftId, runId)
  const run = runRes.data
  const summary: DraftRunSummary = {
    status: run.status,
    algorithm: run.algorithm,
    targetY: run.targetY,
    failureReason: run.failureReason,
  }

  if (run.status !== 'SUCCEEDED') {
    return { run: summary, fit: null, manifest: null }
  }

  const predRes = await modelDraftRunService.predictions(draftId, runId)
  const pred = predRes.data

  const points: FitPoint[] = pred.points.map(p => ({
    timestamp: p.timestamp,
    actual: p.yTrue,
    predicted: p.yPred,
    residual: p.yTrue - p.yPred,
  }))
  const fit = fitFromRun(points, {
    r2: requireMetric(run.metrics, 'r2'),
    rmse: requireMetric(run.metrics, 'rmse'),
    sd: pred.residualSd,
  })

  return {
    run: summary,
    fit,
    manifest: {
      derivedFromTarget: pred.derivedFromTarget,
      targetScaled: pred.targetScaled,
    },
  }
}

/**
 * MODEL-FLOW-004. Step 4 Evaluation's data source — a draft's training run,
 * read server-side (no client-computed fit). Keyed on `(draftId, runId)`
 * rather than derived from wizard atoms, so resuming a TRAINED draft (out of
 * scope for this feature, MODEL-FLOW-010-T08's gap 1) is a follow-on rather
 * than a rewrite: whatever resolves a `runId` can call this hook unchanged.
 *
 * `runIdHint` may be null — see `resolveRunId`'s own doc comment. Only
 * `draftId` gates `enabled`: a hint-less call still has a real chance of
 * finding a SUCCEEDED run via `ModelDraft.currentRunId`.
 */
export function useDraftRunEvaluation(
  draftId: string | null,
  runIdHint: string | null,
): UseDraftRunEvaluationResult {
  const [run, setRun] = useState<DraftRunSummary | null>(null)
  const [fit, setFit] = useState<ModelFit | null>(null)
  const [manifest, setManifest] = useState<DraftRunManifestInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const enabled = !!draftId
  const cacheKey = enabled
    ? `draft-run-evaluation|${draftId}|${runIdHint ?? ''}`
    : null

  useDebouncedAbortableRequest<EvaluationData>({
    enabled,
    cacheKey,
    fetcher: () => fetchEvaluation(draftId!, runIdHint),
    onLoading: () => {
      setRun(null)
      setFit(null)
      setManifest(null)
      setError(null)
      setLoading(true)
    },
    onSettled: result => {
      if (result.status === 'ready') {
        setRun(result.data.run)
        setFit(result.data.fit)
        setManifest(result.data.manifest)
      } else {
        setError(result.error)
      }
      setLoading(false)
    },
    onIdle: () => {
      setRun(null)
      setFit(null)
      setManifest(null)
      setLoading(false)
      setError(null)
    },
  })

  return { run, fit, manifest, loading, error }
}
