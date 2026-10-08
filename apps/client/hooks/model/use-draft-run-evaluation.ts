'use client'

import { useEffect, useRef, useState } from 'react'
import {
  modelDraftRunService,
  modelDraftService,
  type ModelRunStatus,
  type RunCvFolds,
  type RunFeatureImportance,
  type RunPermutationImportance,
} from '@/services/model-draft'
import { fitFromRun, type ModelFit, type FitPoint } from '@/lib/model-metrics'
import type { EvaluationPopulation } from '@/lib/metric-source'
import { ApiError } from '@/lib/fetcher'
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
  /** MODEL-FLOW-019-T20 follow-up. A non-CV run's own scored holdout
   *  series — null until its scoring phase completes; see
   *  `ModelTrainingRun.holdoutPredictionsKey`'s own doc comment
   *  (services/model-draft.ts) for why this is a separate column from
   *  `predictionsKey` rather than a second meaning for it. Lets Step 5
   *  offer "Score against holdout" to an ordinary run too, once it has a
   *  score (`holdoutMetrics`) but no series yet — the common real case,
   *  188 of 252 SUCCEEDED runs in this system, live-counted 2026-09-09. */
  holdoutPredictionsKey: string | null
  /** Non-null only while this run's own separate scoring phase (T07) is
   *  in flight — what Step 5 polls to show "scoring is running" rather
   *  than a dead "trigger scoring" button. */
  scoringContainerId: string | null
  /** MODEL-FLOW-019-T35. The run's own training-side metrics blob —
   *  `cv_rmse_mean`/`cv_mae_mean`/etc for a CV run, plain `rmse`/`mae` for
   *  an ordinary one. Needed so `seedMetricMeans` (lib/feature-count-sweep)
   *  can read this run's own fold means when it seeds a sweep; every other
   *  reader of a run's metrics on this hook's OWN fetch path already reads
   *  `run.metrics` directly inside `fetchEvaluation` before this summary is
   *  built — this field is that same raw blob, carried through rather than
   *  re-fetched. */
  metrics: Record<string, unknown> | null
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
  /** MODEL-FLOW-019-T09. `null` means "not recorded for this run" — either
   *  it predates feature-importance recording, or its algorithm has no such
   *  quantity to read (hgb/hist_gradient_boosting, mlp, grp, a non-linear
   *  svm, lstm, gru). REQUIRED (never optional) so a caller cannot forget to
   *  map it — the same enforcement `splitStats` below gets for the same
   *  reason. */
  featureImportance: RunFeatureImportance | null
  /** MODEL-FLOW-023-T10. `null` means "not recorded for this run" — either
   *  no strategy scored a permutation population for it (every algorithm
   *  except lstm/gru today), or it predates this column. REQUIRED, same
   *  enforcement `featureImportance` above gets. */
  permutationImportance: RunPermutationImportance | null
  /** MODEL-FLOW-014-T06's frozen split-distribution sidecar — `null` on a
   *  candidate-job run BY DESIGN (N candidates sharing one split is N
   *  redundant artifact reads for an identical answer) and on a run
   *  launched before that feature. REQUIRED so Step 5's
   *  observations-per-feature figure (AC26) cannot be silently dropped by a
   *  caller that forgets to map it. */
  splitStats: { source_rows: number; distinct_labelled_values: number } | null
  /** MODEL-FLOW-019-T31. Non-null only for a run that is one row of a
   *  feature-count sweep — what Step 5 keys the sweep table's presence off.
   *  REQUIRED (never optional), the same enforcement `featureImportance` and
   *  `splitStats` above get, and here it is load-bearing: a Prisma column
   *  plus a DTO field does NOT reach this hand-built summary, so a forgotten
   *  mapping would leave this `undefined` forever, the table would never
   *  mount, and nothing would error — the silent class that shipped image
   *  1.0.6 without importance.py for six days. */
  sweepId: string | null
  /** MODEL-FLOW-019-T31 / AC66. The run whose importance produced this
   *  sweep's shared ranking. Not the current run: each row records its OWN
   *  importance, which is not the ranking that chose its columns — naming the
   *  current run here would credit the ordering to the wrong fit. */
  sweepSeedRunId: string | null
  /** MODEL-FLOW-019-T31. The artifact this run trained on — what a sweep
   *  launched from this run's ranking must train every row against, since a
   *  ladder whose rows read different artifacts compares nothing. */
  goldArtifactId: string
  /** MODEL-FLOW-019-T31. Needed with `goldArtifactId` to ask /split-stats for
   *  the distinct labelled count when this run has no frozen `splitStats` of
   *  its own — the case for 187 of this system's 260 SUCCEEDED runs, since a
   *  candidate-job run stores none BY DESIGN (MODEL-FLOW-014-T06). */
  datasetId: string
}

/**
 * MODEL-FLOW-016-T11's derivation, MOVED to `lib/metric-source` by
 * MODEL-FLOW-019-T02 — what it decides is which SOURCE a run's headline
 * figure has, which is that module's whole subject, and a pure derivation
 * belongs in `lib/` rather than inside a hook module. Re-exported here so
 * every existing caller (`phase-5-evaluation`, `phase-6-deploy`,
 * `phase-4-model-selection`, and the tests that `importOriginal` this
 * module) keeps its import path unchanged.
 *
 * A CV run's own three-phase state, distinct from `fit === null` meaning
 * "not SUCCEEDED yet" on a plain run:
 * - `not-cv`: ordinary run — `fit` (if any) is that run's own test-split
 *   score, unchanged behaviour.
 * - `awaiting-scoring`: SUCCEEDED CV run, `predictionsKey` still null, no
 *   scoring container running — Step 5 shows the trigger action.
 * - `scoring`: a scoring container is in flight — Step 5 polls.
 * - `scored`: `predictionsKey` set — `fit` is that model's OWN holdout
 *   score (from `holdoutMetrics`, never the fold mean in `metrics`).
 */
export { cvScoringPhaseOf } from '@/lib/metric-source'
export type { CvScoringPhase } from '@/lib/metric-source'

export interface DraftRunManifestInfo {
  /** The leakage guard's own record (MODEL-FLOW-000-T02) — non-empty means
   *  this model needs target history at inference time it is not shown
   *  here. Null when the run recorded no manifest. */
  derivedFromTarget: string[] | null
  targetScaled: boolean | null
}

/** MODEL-FLOW-019-T13. The FULL-FRAME y-value ranges `run_predictions`
 *  already computes server-side (`services/model-draft.ts`'s own
 *  `RunPredictions.yTrueMin/yTrueMax/yPredMin/yPredMax`) — not on
 *  `ModelFit`, which is shared with the `models/[id]` monitoring surfaces
 *  and whose fields are metrics, not axis bounds. Kept separate so the
 *  parity scatter's shared domain is taken from the endpoint's own
 *  full-frame figure rather than from the rendered point set, and so the
 *  axis does not shift if that point set is ever decimated. Null whenever
 *  `fit` is null (no predictions fetched yet). */
export interface ParityRange {
  yTrueMin: number
  yTrueMax: number
  yPredMin: number
  yPredMax: number
}

/**
 * MODEL-FLOW-030. Why a population has no series to chart:
 *
 * - `no-series`  — nothing was recorded for it. For the holdout that is a run
 *                  never scored (or one that predates keeping the frame); the
 *                  caller states which, from the holdout-absence rules.
 * - `no-oof`     — a CV run trained before the out-of-fold artifact existed
 *                  (image < 1.0.21). It never will have one.
 * - `too-large`  — the series exceeds what the single-run endpoint serves
 *                  without decimation. NEVER decimated here: the histogram, QQ
 *                  plot and residual SD would then describe a sample, not the
 *                  population they are captioned with.
 * - `unreadable` — recorded but the read failed.
 */
export type PopulationAbsence =
  | 'no-series'
  | 'no-oof'
  | 'too-large'
  | 'unreadable'

/** The headline figures for a population — available whenever the run
 *  recorded them, WITH OR WITHOUT a series (about three quarters of this
 *  system's runs have holdout metrics and no holdout series). */
export interface PopulationMetrics {
  r2: number
  rmse: number
  mae: number
  /** Spread across folds — present only for the out-of-fold population, where
   *  `r2`/`rmse`/`mae` are fold MEANS. */
  std: { r2: number; rmse: number; mae: number } | null
  /** Folds averaged — out-of-fold only. */
  nSplits: number | null
}

export interface PopulationEvaluation {
  population: EvaluationPopulation
  metrics: PopulationMetrics | null
  /** The charted series. Null when `absence` is set. */
  fit: ModelFit | null
  parityRange: ParityRange | null
  absence: PopulationAbsence | null
}

export interface UseDraftRunEvaluationResult {
  run: DraftRunSummary | null
  manifest: DraftRunManifestInfo | null
  /** The run's own population: the test split, or — for a CV run — its
   *  out-of-fold series. */
  own: PopulationEvaluation | null
  /** The dataset's raw validation holdout, once scored. */
  holdout: PopulationEvaluation | null
  loading: boolean
  error: string | null
  triggerScoring: () => Promise<void>
}

interface EvaluationData {
  run: DraftRunSummary | null
  manifest: DraftRunManifestInfo | null
  own: PopulationEvaluation | null
  holdout: PopulationEvaluation | null
}

const NO_DATA: EvaluationData = {
  run: null,
  manifest: null,
  own: null,
  holdout: null,
}

function requireMetric(
  metrics: Record<string, unknown> | null,
  key: 'r2' | 'rmse' | 'mae',
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

/** MODEL-FLOW-030. What a poll tick may reuse: the run's OWN population (and
 *  the manifest it carried) is fixed once the run SUCCEEDED — holdout scoring
 *  writes only the holdout series — so re-reading up to 20,000 points through
 *  python every 2.5s for it is pure cost. */
interface OwnSnapshot {
  runId: string
  own: PopulationEvaluation
  manifest: DraftRunManifestInfo | null
}

async function fetchEvaluation(
  draftId: string,
  runIdHint: string | null,
  reuse: OwnSnapshot | null = null,
): Promise<EvaluationData> {
  const runId = await resolveRunId(draftId, runIdHint)
  if (!runId) return NO_DATA

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
    holdoutPredictionsKey: run.holdoutPredictionsKey,
    scoringContainerId: run.scoringContainerId,
    metrics: run.metrics,
    holdoutMetrics: run.holdoutMetrics,
    cvFolds: run.cvFolds ?? null,
    featureImportance: run.featureImportance ?? null,
    permutationImportance: run.permutationImportance ?? null,
    splitStats: run.splitStats,
    sweepId: run.sweepId ?? null,
    sweepSeedRunId: run.sweepSeedRunId ?? null,
    goldArtifactId: run.goldArtifactId,
    datasetId: run.datasetId,
  }

  if (run.status !== 'SUCCEEDED') {
    return { ...NO_DATA, run: summary }
  }

  const isCv = run.cvFoldsKey !== null
  // Only a population that loaded cleanly is reused: an absence (unreadable,
  // too-large) is retried on the next tick rather than frozen.
  const reusable =
    reuse && reuse.runId === runId && reuse.own.absence === null ? reuse : null
  const [own, holdout] = await Promise.all([
    reusable
      ? Promise.resolve<LoadedPopulation>({
          evaluation: reusable.own,
          manifest: reusable.manifest,
        })
      : isCv
        ? loadOutOfFold(draftId, runId, run)
        : loadTestSplit(draftId, runId, run),
    loadHoldout(draftId, runId, run, isCv),
  ])

  return {
    run: summary,
    // The manifest is the leakage guard's record for the RUN, not for a
    // population; whichever series loaded carries the same one.
    manifest: own.manifest ?? holdout.manifest,
    own: own.evaluation,
    holdout: holdout.evaluation,
  }
}

interface LoadedPopulation {
  evaluation: PopulationEvaluation
  manifest: DraftRunManifestInfo | null
}

type RunDetail = Awaited<ReturnType<typeof modelDraftRunService.get>>['data']

function toFit(
  pred: Awaited<ReturnType<typeof modelDraftRunService.predictions>>['data'],
  metrics: { r2: number; rmse: number; mae: number },
): { fit: ModelFit; parityRange: ParityRange; manifest: DraftRunManifestInfo } {
  const points: FitPoint[] = pred.points.map(p => ({
    timestamp: p.timestamp,
    actual: p.yTrue,
    predicted: p.yPred,
    residual: p.yTrue - p.yPred,
  }))
  return {
    fit: fitFromRun(points, { ...metrics, sd: pred.residualSd }),
    parityRange: {
      yTrueMin: pred.yTrueMin,
      yTrueMax: pred.yTrueMax,
      yPredMin: pred.yPredMin,
      yPredMax: pred.yPredMax,
    },
    manifest: {
      derivedFromTarget: pred.derivedFromTarget,
      targetScaled: pred.targetScaled,
    },
  }
}

/** The single-run endpoint refuses a frame over its point cap and does not
 *  decimate (`MAX_PREDICTION_POINTS`, apps/python/schemas/preprocess.py). */
function isTooLarge(err: unknown): boolean {
  return err instanceof Error && /rows, over the \d+/.test(err.message)
}

function numberOf(
  bag: Record<string, unknown> | null,
  key: string,
): number | null {
  const v = bag?.[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * A non-CV run's own population: its TEST split. Strict about the METRICS, as
 * before this feature — a successful run whose metrics cannot be read is an
 * error to show, not an absence to explain.
 *
 * An over-cap SERIES is the one exception, handled like the other two
 * populations: the page keeps its tiles, the holdout tab, importance and the
 * Retrain action, and the panel says the series is not drawn. Before, that
 * single throw took the whole of Step 5 down with it.
 */
async function loadTestSplit(
  draftId: string,
  runId: string,
  run: RunDetail,
): Promise<LoadedPopulation> {
  const metrics = {
    r2: requireMetric(run.metrics, 'r2'),
    rmse: requireMetric(run.metrics, 'rmse'),
    mae: requireMetric(run.metrics, 'mae'),
  }
  let predRes: Awaited<ReturnType<typeof modelDraftRunService.predictions>>
  try {
    predRes = await modelDraftRunService.predictions(draftId, runId, 'test')
  } catch (err) {
    if (!isTooLarge(err)) throw err
    return {
      manifest: null,
      evaluation: {
        population: 'test-split',
        metrics: { ...metrics, std: null, nSplits: null },
        fit: null,
        parityRange: null,
        absence: 'too-large',
      },
    }
  }
  const { fit, parityRange, manifest } = toFit(predRes.data, metrics)
  return {
    manifest,
    evaluation: {
      population: 'test-split',
      metrics: { ...metrics, std: null, nSplits: null },
      fit,
      parityRange,
      absence: null,
    },
  }
}

/**
 * MODEL-FLOW-030. A CV run's own population: its OUT-OF-FOLD series. The
 * tiles are the fold MEAN ± std (`metrics.cv_*`) — never a figure recomputed
 * from the pooled series, whose RMSE is a different number. The series' own
 * residual SD (`fit.sd`) is the pooled figure and the diagnostics' basis.
 *
 * A run with no out-of-fold object (trained before image 1.0.21) keeps its
 * fold tiles and says so; an over-cap series does the same and draws nothing,
 * rather than feeding the diagnostics a decimated sample.
 */
async function loadOutOfFold(
  draftId: string,
  runId: string,
  run: RunDetail,
): Promise<LoadedPopulation> {
  const mean = {
    r2: numberOf(run.metrics, 'cv_r2_mean'),
    rmse: numberOf(run.metrics, 'cv_rmse_mean'),
    mae: numberOf(run.metrics, 'cv_mae_mean'),
  }
  const std = {
    r2: numberOf(run.metrics, 'cv_r2_std'),
    rmse: numberOf(run.metrics, 'cv_rmse_std'),
    mae: numberOf(run.metrics, 'cv_mae_std'),
  }
  const metrics: PopulationMetrics | null =
    mean.r2 !== null && mean.rmse !== null && mean.mae !== null
      ? {
          r2: mean.r2,
          rmse: mean.rmse,
          mae: mean.mae,
          std:
            std.r2 !== null && std.rmse !== null && std.mae !== null
              ? { r2: std.r2, rmse: std.rmse, mae: std.mae }
              : null,
          nSplits: numberOf(run.metrics, 'n_splits'),
        }
      : null

  const absent = (absence: PopulationAbsence): LoadedPopulation => ({
    manifest: null,
    evaluation: {
      population: 'cv-oof',
      metrics,
      fit: null,
      parityRange: null,
      absence,
    },
  })
  if (!metrics) return absent('no-series')

  try {
    const predRes = await modelDraftRunService.predictions(
      draftId,
      runId,
      'cv-oof',
    )
    const { fit, parityRange, manifest } = toFit(predRes.data, metrics)
    return {
      manifest,
      evaluation: {
        population: 'cv-oof',
        metrics,
        fit,
        parityRange,
        absence: null,
      },
    }
  } catch (err) {
    if (isTooLarge(err)) return absent('too-large')
    // The key always resolves for a CV run; a missing OBJECT is a 404 from the
    // reader. Anything else is a read failure worth saying so about.
    if (err instanceof ApiError && err.status === 404) return absent('no-oof')
    return absent('unreadable')
  }
}

/**
 * The dataset's raw validation HOLDOUT, for either run kind. Tiles come from
 * `holdoutMetrics` whenever they exist, series or not; the series is fetched
 * only when the run recorded one (a CV run's `predictionsKey` IS its holdout, a
 * non-CV run's `holdoutPredictionsKey` is — `predictionKeyFor`'s rule).
 */
async function loadHoldout(
  draftId: string,
  runId: string,
  run: RunDetail,
  isCv: boolean,
): Promise<LoadedPopulation> {
  const r2 = numberOf(run.holdoutMetrics, 'r2')
  const rmse = numberOf(run.holdoutMetrics, 'rmse')
  const mae = numberOf(run.holdoutMetrics, 'mae')
  const metrics: PopulationMetrics | null =
    r2 !== null && rmse !== null && mae !== null
      ? { r2, rmse, mae, std: null, nSplits: null }
      : null

  const absent = (absence: PopulationAbsence): LoadedPopulation => ({
    manifest: null,
    evaluation: {
      population: 'holdout',
      metrics,
      fit: null,
      parityRange: null,
      absence,
    },
  })

  const seriesKey = isCv ? run.predictionsKey : run.holdoutPredictionsKey
  if (!seriesKey || !metrics) return absent('no-series')

  try {
    const predRes = await modelDraftRunService.predictions(
      draftId,
      runId,
      'holdout',
    )
    const { fit, parityRange, manifest } = toFit(predRes.data, metrics)
    return {
      manifest,
      evaluation: {
        population: 'holdout',
        metrics,
        fit,
        parityRange,
        absence: null,
      },
    }
  } catch (err) {
    return absent(isTooLarge(err) ? 'too-large' : 'unreadable')
  }
}

const SCORING_POLL_MS = 2500

export function useDraftRunEvaluation(
  draftId: string | null,
  runIdHint: string | null,
): UseDraftRunEvaluationResult {
  const [run, setRun] = useState<DraftRunSummary | null>(null)
  const [manifest, setManifest] = useState<DraftRunManifestInfo | null>(null)
  const [own, setOwn] = useState<PopulationEvaluation | null>(null)
  const [holdout, setHoldout] = useState<PopulationEvaluation | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Bumped by the poll effect below and by `triggerScoring` — included in
  // `cacheKey` purely to force a cache MISS on each tick
  // (`chart-request-cache` has no TTL of its own), never read otherwise.
  const [pollTick, setPollTick] = useState(0)
  // The last clean own-population load, for a poll tick to reuse. A ref, not
  // state: nothing renders from it.
  const ownSnapshot = useRef<OwnSnapshot | null>(null)

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
    fetcher: () =>
      fetchEvaluation(
        draftId!,
        runIdHint,
        // First load and any non-poll fetch read everything fresh.
        pollTick > 0 ? ownSnapshot.current : null,
      ),
    onLoading: () => {
      // Only clear stale state on the FIRST load, not on a poll refetch —
      // a poll tick while `scoring` must not flash the whole panel back to
      // a loading skeleton every 2.5s.
      if (pollTick === 0) {
        setRun(null)
        setManifest(null)
        setOwn(null)
        setHoldout(null)
        setLoading(true)
      }
      setError(null)
    },
    onSettled: result => {
      if (result.status === 'ready') {
        setRun(result.data.run)
        setManifest(result.data.manifest)
        setOwn(result.data.own)
        setHoldout(result.data.holdout)
        ownSnapshot.current =
          result.data.run && result.data.own
            ? {
                runId: result.data.run.id,
                own: result.data.own,
                manifest: result.data.manifest,
              }
            : null
      } else {
        setError(result.error)
      }
      setLoading(false)
    },
    onIdle: () => {
      setRun(null)
      setManifest(null)
      setOwn(null)
      setHoldout(null)
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

  return { run, manifest, own, holdout, loading, error, triggerScoring }
}
