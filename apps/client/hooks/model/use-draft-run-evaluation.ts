'use client'

import { useEffect, useState } from 'react'
import {
  modelDraftRunService,
  modelDraftService,
  type ModelRunStatus,
  type RunCvFolds,
} from '@/services/model-draft'
import { fitFromRun, type ModelFit, type FitPoint } from '@/lib/model-metrics'
import { useDebouncedAbortableRequest } from '@/hooks/dataset/internal/use-debounced-abortable-request'

/** Just enough of the run row for Step 4's banner and empty states — not the
 *  full `ModelTrainingRun` (logs, hyperparameters, split spec are not this
 *  hook's concern). */
export interface DraftRunSummary {
  /** MODEL-FLOW-016-T11. Needed so `triggerScoring` below can POST to this
   *  exact run — the hook resolves it internally via `resolveRunId` but
   *  had never surfaced it before this task, since nothing previously
   *  needed to name the run back to the server. */
  id: string
  status: ModelRunStatus
  algorithm: string
  targetY: string
  failureReason: string | null
  /** MODEL-FLOW-016-T11. Set only for a Cross-Validation run — the durable
   *  signal Step 4/5 key their CV render mode off, never `algorithm`. */
  cvFoldsKey: string | null
  /** Null pre-scoring on a CV run; always set (at training `complete()`
   *  time) on an ordinary run. Distinguishes "not yet scored" from
   *  "scoring produced nothing" for a CV run. */
  predictionsKey: string | null
  /** Non-null only while this run's own separate scoring phase (T07) is
   *  in flight — what Step 5 polls to show "scoring is running" rather
   *  than a dead "trigger scoring" button. */
  scoringContainerId: string | null
  /** The refit model's OWN honest number, from a raw validation holdout no
   *  fit ever saw — never the fold mean (`metrics.cv_r2_mean`/etc). Carries
   *  `dropped_unlabelled`/`dropped_bad_features`/`row_count` so the
   *  holdout's own missing rate can be stated beside every figure it backs
   *  (DS-LAKE-018-T05). Null until scoring has actually produced a number —
   *  true for both an unscored CV run and a run whose dataset has no
   *  holdout at all. */
  holdoutMetrics: Record<string, unknown> | null
  /** MODEL-FLOW-016-T11. The per-fold table's own source — row counts
   *  BESIDE each fold's real r2/rmse/mae, real post-training numbers, not
   *  T10's pre-training `/split-stats` plan. `undefined`/`null` alike mean
   *  "nothing to show"; see `ModelTrainingRun.cvFolds`'s own doc for why
   *  the two are kept distinguishable at the wire level even though this
   *  hook does not currently need to tell them apart. */
  cvFolds: RunCvFolds | null
}

/** Reads the three raw signals on `DraftRunSummary` into the one phase Step
 *  5 renders from, so that branching logic exists in exactly one place. A
 *  non-SUCCEEDED run has no defined phase — callers must check `fit`/
 *  `run.status` first, same as before this feature. */
export function cvScoringPhaseOf(run: DraftRunSummary | null): CvScoringPhase {
  if (!run?.cvFoldsKey) return 'not-cv'
  if (run.predictionsKey) return 'scored'
  if (run.scoringContainerId) return 'scoring'
  return 'awaiting-scoring'
}

/** MODEL-FLOW-016-T11. A CV run's own three-phase Step 5 state, distinct
 *  from `fit === null` meaning "not SUCCEEDED yet" on a plain run:
 *  - `not-cv`: ordinary run — `fit` (if any) is that run's own test-split
 *    score, unchanged behaviour.
 *  - `awaiting-scoring`: SUCCEEDED CV run, `predictionsKey` still null,
 *    no scoring container running — Step 5 shows the trigger action.
 *  - `scoring`: a scoring container is in flight — Step 5 polls.
 *  - `scored`: `predictionsKey` set — `fit` is that model's OWN holdout
 *    score (from `holdoutMetrics`, never the fold mean in `metrics`). */
export type CvScoringPhase =
  | 'not-cv'
  | 'awaiting-scoring'
  | 'scoring'
  | 'scored'

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
  /** MODEL-FLOW-016-T11. POSTs the run's own `/score` trigger (T07) and
   *  immediately forces a refetch so the hook starts self-polling — see
   *  the poll effect below. A no-op (resolves immediately) when `run` is
   *  null; the caller is expected to only offer this action once
   *  `cvScoringPhaseOf(run) === 'awaiting-scoring'`, same as every other
   *  disable-with-reason control in this feature. */
  triggerScoring: () => Promise<void>
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
  source: 'metrics' | 'holdout_metrics' = 'metrics',
): number {
  const value = metrics?.[key]
  if (typeof value !== 'number') {
    throw new Error(
      `Training run's ${source}.json has no numeric '${key}' — cannot show Evaluation.`,
    )
  }
  return value
}

/**
 * MODEL-FLOW-013-T08. Always resolved server-side now — `runIdHint`
 * (normally `mpTrainingResultAtom.runId`, set by the poll loop the moment
 * its own run/job reaches a terminal state) is no longer trusted as a
 * short-circuit, because a user's selection
 * (`ModelCandidateJob.selectedRunId`, written well after the poll loop set
 * the hint) must be able to override what Evaluation shows — the whole
 * point of that field. `resolvedRunId` already collapses to
 * `ModelDraft.currentRunId` when no candidate job exists, so this covers
 * the plain single-run case identically to before; `runIdHint` is now only
 * a last-resort fallback for the defensive case where the draft fetch
 * itself resolves nothing (e.g. a remount that raced the draft write).
 */
async function resolveRunId(
  draftId: string,
  runIdHint: string | null,
): Promise<string | null> {
  const draftRes = await modelDraftService.get(draftId)
  return draftRes.data.resolvedRunId ?? runIdHint
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
    id: run.id,
    status: run.status,
    algorithm: run.algorithm,
    targetY: run.targetY,
    failureReason: run.failureReason,
    cvFoldsKey: run.cvFoldsKey,
    predictionsKey: run.predictionsKey,
    scoringContainerId: run.scoringContainerId,
    holdoutMetrics: run.holdoutMetrics,
    cvFolds: run.cvFolds ?? null,
  }

  if (run.status !== 'SUCCEEDED') {
    return { run: summary, fit: null, manifest: null }
  }

  // MODEL-FLOW-016-T11. A CV run writes no test-split predictions file at
  // all — cv_folds.json describes the CONFIGURATION, not the refit model
  // that ships, and the refit has no held-out score until the separate
  // scoring phase (T07) runs. Pre-scoring, there is nothing to fetch: the
  // "awaiting scoring"/"scoring" phase (`cvScoringPhaseOf`, read off
  // `summary` above) IS the honest answer, not an error to surface.
  if (run.cvFoldsKey && !run.predictionsKey) {
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
  // MODEL-FLOW-016-T11. A scored CV run's predictions.parquet IS its
  // holdout series, so its r2/rmse must come from `holdoutMetrics` — never
  // `metrics` (that holds the fold MEAN, `cv_r2_mean`/`cv_rmse_mean`, a
  // different question; a CV run's `metrics` has no plain `r2`/`rmse` key
  // at all). Pairing a holdout series with a fold-mean or test-split
  // scalar is exactly the category error this feature exists to prevent.
  // An ordinary (non-CV) run keeps reading its own test-split `metrics`,
  // unchanged.
  const fit = run.cvFoldsKey
    ? fitFromRun(points, {
        r2: requireMetric(run.holdoutMetrics, 'r2', 'holdout_metrics'),
        rmse: requireMetric(run.holdoutMetrics, 'rmse', 'holdout_metrics'),
        sd: pred.residualSd,
      })
    : fitFromRun(points, {
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
/** MODEL-FLOW-016-T11. `use-model-training.ts`'s own `pollRun` runs the same
 *  2500ms cadence for the training container; matching it here rather than
 *  inventing a second constant. */
const SCORING_POLL_MS = 2500

export function useDraftRunEvaluation(
  draftId: string | null,
  runIdHint: string | null,
): UseDraftRunEvaluationResult {
  const [run, setRun] = useState<DraftRunSummary | null>(null)
  const [fit, setFit] = useState<ModelFit | null>(null)
  const [manifest, setManifest] = useState<DraftRunManifestInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Bumped by the poll effect below and by `triggerScoring` — included in
  // `cacheKey` purely to force a cache MISS on each tick
  // (`chart-request-cache` has no TTL of its own), never read otherwise.
  const [pollTick, setPollTick] = useState(0)

  const enabled = !!draftId
  const cacheKey = enabled
    ? `draft-run-evaluation|${draftId}|${runIdHint ?? ''}|${pollTick}`
    : null

  useDebouncedAbortableRequest<EvaluationData>({
    enabled,
    cacheKey,
    // No debounce for a poll tick's own refetch — `pollTick` only changes
    // on a timer/explicit trigger, never on a keystroke, so the 600ms
    // default would just add latency to "is scoring done yet".
    debounceMs: pollTick === 0 ? undefined : 0,
    // Each poll tick mints a never-reused `cacheKey` (below) purely to
    // force a fresh fetch — caching that key would leak one Map entry per
    // tick for as long as scoring runs, since nothing ever reads it back.
    skipCache: pollTick > 0,
    fetcher: () => fetchEvaluation(draftId!, runIdHint),
    onLoading: () => {
      // Only clear stale state on the FIRST load, not on a poll refetch —
      // a poll tick while `scoring` must not flash the whole panel back to
      // a loading skeleton every 2.5s.
      if (pollTick === 0) {
        setRun(null)
        setFit(null)
        setManifest(null)
        setLoading(true)
      }
      setError(null)
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

  // Self-poll only while THIS run's scoring container is actually in
  // flight — mirrors `pollRun` polling only while `status === 'RUNNING'`.
  // `awaiting-scoring` polls nothing on its own; the user's own click
  // (`triggerScoring`) is what starts this effect, by setting
  // `scoringContainerId` on the very next fetch.
  const scoring = run?.scoringContainerId != null
  useEffect(() => {
    if (!scoring) return
    const id = setInterval(() => setPollTick(t => t + 1), SCORING_POLL_MS)
    return () => clearInterval(id)
  }, [scoring])

  const triggerScoring = async () => {
    if (!draftId || !run) return
    await modelDraftRunService.score(draftId, run.id)
    setPollTick(t => t + 1)
  }

  return { run, fit, manifest, loading, error, triggerScoring }
}
