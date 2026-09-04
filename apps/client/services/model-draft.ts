import { fetchClient } from '@/lib/fetcher'
import type { AIModel } from '@/types'
import type { DeploymentConfig } from '@/lib/model-config'

/**
 * `ModelDraft` — the Model Creation wizard's server-side owner while no
 * `Model` row exists yet (MODEL-FLOW-002, see decisions.draft_persistence).
 *
 * Deliberately mirrors `services/dataset-draft.ts`'s shape closely, with one
 * intentional divergence: `patch` exists here and does not there. A training
 * container has no browser and reads its spec from this row over HTTP, so
 * the row must be kept current as Step 2's config changes — the dataset
 * wizard ships its recipe once, at Save; this one cannot.
 */

interface ApiResponse<T> {
  data: T
  statusCode: number
  message: string
  type: string
}

export type ModelDraftStatus = 'ACTIVE' | 'TRAINED' | 'SAVED' | 'ABANDONED'

export interface ModelDraft {
  id: string
  name: string | null
  workspaceId: string
  plantId: string | null
  nodeId: string | null
  datasetId: string | null
  targetY: string | null
  algorithm: string | null
  hyperparameters: unknown
  splitRatio: number | null
  status: ModelDraftStatus
  currentRunId: string | null
  /** MODEL-FLOW-013-T08. `selectedRunId ?? bestRunId` from the draft's most
   *  recent terminal candidate job, else `currentRunId` — the one field
   *  Evaluation/Save-Model-adoption should read, never `currentRunId`
   *  directly, so a user's selection can override what they see. */
  resolvedRunId: string | null
  /** MODEL-FLOW-018-T02. The user's own explicit standalone choice (a run no
   *  ModelCandidateJob owns) — null until Select is used, and null again
   *  once a newer launch or a job-level selection supersedes it. Distinct
   *  from `resolvedRunId`, which is non-null for ANY draft with any run at
   *  all: this is the one field that says whether the user actually chose
   *  something, which is what a "Carrying forward: …" footer needs to know
   *  before it renders. */
  selectedRunId: string | null
  savedModelId: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateModelDraftInput {
  workspaceId: string
  name?: string
  plantId?: string
  nodeId?: string
  datasetId?: string
}

/**
 * All-optional — the client PATCHes whichever fields changed, debounced.
 * splitRatio is a FRACTION (0.5-0.95), never a percentage — convert at the
 * call site, same boundary rule MODEL-FLOW-003-T10 states for the API.
 */
export interface PatchModelDraftInput {
  name?: string
  plantId?: string | null
  nodeId?: string | null
  datasetId?: string | null
  targetY?: string | null
  algorithm?: string | null
  hyperparameters?: Record<string, unknown>
  splitRatio?: number | null
}

/**
 * Filters for the draft list (MODEL-FLOW-010-T08). Both optional and neither
 * widens access — the server scopes to the caller's workspaces regardless.
 */
export interface ListModelDraftsQuery {
  workspaceId?: string
  status?: ModelDraftStatus
}

const base = '/api/v1/authorized/model-drafts'
const one = (draftId: string) => `${base}/${encodeURIComponent(draftId)}`

export const modelDraftService = {
  create: (body: CreateModelDraftInput): Promise<ApiResponse<ModelDraft>> =>
    fetchClient(base, { method: 'POST', body: JSON.stringify(body) }),

  list: (
    query: ListModelDraftsQuery = {},
  ): Promise<ApiResponse<ModelDraft[]>> => {
    const params = new URLSearchParams()
    if (query.workspaceId) params.set('workspaceId', query.workspaceId)
    if (query.status) params.set('status', query.status)
    const qs = params.toString()
    return fetchClient(qs ? `${base}?${qs}` : base, { method: 'GET' })
  },

  get: (draftId: string): Promise<ApiResponse<ModelDraft>> =>
    fetchClient(one(draftId), { method: 'GET' }),

  patch: (
    draftId: string,
    body: PatchModelDraftInput,
  ): Promise<ApiResponse<ModelDraft>> =>
    fetchClient(one(draftId), { method: 'PATCH', body: JSON.stringify(body) }),

  abandon: (draftId: string): Promise<ApiResponse<ModelDraft>> =>
    fetchClient(`${one(draftId)}/abandon`, { method: 'POST' }),

  /**
   * MODEL-FLOW-007. The ONLY persistence boundary — creates the Model,
   * adopting the draft's winning run by pointer. What a user can still
   * choose at Save time; algorithm/hyperparameters/target/split are derived
   * server-side from that run, not sent here. 409s if the draft is already
   * SAVED, 422s if it has no SUCCEEDED run yet.
   */
  save: (
    draftId: string,
    body: {
      name: string
      nodeId?: string
      description?: string
      deployment?: DeploymentConfig
    },
  ): Promise<ApiResponse<AIModel>> =>
    fetchClient(`${one(draftId)}/save`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** MODEL-FLOW-018-T02. Records which STANDALONE run (one no
   *  ModelCandidateJob owns) carries forward. Refused server-side (400) for
   *  a run not of this draft, one still QUEUED/RUNNING, one that FAILED/
   *  CANCELED, or one whose own candidate job is still QUEUED/RUNNING. */
  selectRun: (
    draftId: string,
    runId: string,
  ): Promise<ApiResponse<ModelDraft>> =>
    fetchClient(`${one(draftId)}/select-run`, {
      method: 'POST',
      body: JSON.stringify({ runId }),
    }),
}

/**
 * Draft-scoped training runs (MODEL-FLOW-003) — `authorized/model-drafts/
 * :draftId/runs*`, mounted by `ModelDraftRunAuthorizedController` alongside
 * the draft CRUD this file already wraps. Kept in this file rather than a
 * new one: same base path, same auth shape, and a run cannot outlive the
 * draft that owns it until Save Model adopts it.
 */

export type ModelRunStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELED'

export interface ModelTrainingRunLog {
  id: string
  level: string
  message: string
  createdAt: string
}

/**
 * The run's split spec (MODEL-FLOW-012 audit). `{method: 'chronological',
 * ratio}` is written at launch time REGARDLESS of algorithm
 * (model-run-launch.authorized.service.ts hardcodes 'chronological' as a
 * placeholder); the remaining keys — and, for lstm/gru,
 * `method: 'chronological_windowed'` plus `sequence_length` — arrive only
 * via the container's own POST /complete, so a FAILED run (which never
 * reaches /complete) keeps the 2-key placeholder shape forever. Treat
 * everything past `ratio` as absent, not zero.
 *
 * MODEL-FLOW-009-T04. `train_rows`/`test_rows`/`labelled_rows` are WINDOW
 * counts, not row counts, when `method` is 'chronological_windowed' —
 * train.py's own split_spec comment states this; this type does not
 * encode it further (a single loose interface, matching this file's
 * existing convention, rather than a true discriminated union).
 */
/** MODEL-FLOW-016-T04/T11. `cv_folds.json` verbatim — snake_case, matching
 *  every other python-passthrough JSON blob this file leaves unmapped
 *  (`metrics`, `holdoutMetrics`) rather than the wire-shape/camelCase
 *  split `RunPredictions` uses. `train_r2`/`train_rmse`/`train_mae` sit
 *  beside each fold's own `r2`/`rmse`/`mae` so overfitting is visible
 *  fold-by-fold, not just in the aggregate mean±std on `metrics`. */
export interface CvFoldRecord {
  fold: number
  cut_timestamp: string
  train_rows: number
  test_rows: number
  distinct: number
  r2: number
  rmse: number
  mae: number
  train_r2: number
  train_rmse: number
  train_mae: number
}

export interface RunCvFolds {
  algorithm: string
  n_splits: number
  folds: CvFoldRecord[]
}

export interface ModelRunSplitSpec {
  method: 'chronological' | 'chronological_windowed'
  ratio: number
  cut_timestamp?: string
  sequence_length?: number
  train_rows?: number
  test_rows?: number
  source_rows?: number
  labelled_rows?: number
}

/**
 * Widened by MODEL-FLOW-012 to match what the backend already returns —
 * listDraftRunsService/getDraftRunService only ever omit `tokenHash`; every
 * other run column reaches the browser. This interface was the narrow part,
 * not the API (see that feature's T01/T03 notes in docs/feature_list.json).
 */
export interface ModelTrainingRun {
  id: string
  status: ModelRunStatus
  failureReason: string | null
  datasetId: string
  goldArtifactId: string
  artifactChecksum: string
  featureSpecKey: string | null
  targetY: string
  algorithm: string
  hyperparameters: Record<string, unknown>
  seed: number
  splitSpec: ModelRunSplitSpec
  imageDigest: string
  modelKey: string | null
  metrics: Record<string, unknown> | null
  holdoutMetrics: Record<string, unknown> | null
  /** MODEL-FLOW-013-T05a. Present only for the algorithms train.py can
   *  extract a real loss trajectory from — mode A/B render selection reads
   *  this, never the algorithm name. */
  lossHistoryKey: string | null
  /** MODEL-FLOW-016-T04/T05a. Set only by `complete()` for a Cross-
   *  Validation run — the durable, typed signal for CV render mode (never
   *  `splitSpec.method`, never the algorithm name). Null on an ordinary
   *  run, which already scores its holdout inline during training. */
  cvFoldsKey: string | null
  /** MODEL-FLOW-016-T06/T07. Null pre-scoring on a CV run (there is no
   *  test-split predictions file for CV — see `use-draft-run-evaluation`'s
   *  CV branch); set once the separate scoring phase completes. An
   *  ordinary (non-CV) run has this set at training `complete()` time,
   *  same as before this feature. */
  predictionsKey: string | null
  /** MODEL-FLOW-016-T07. Non-null only while a scoring container is
   *  in flight for this run — its ONLY purpose is letting the UI poll
   *  "scoring is currently running" (mirrors `containerId` for training). */
  scoringContainerId: string | null
  /** MODEL-FLOW-016-T11. Attached by `getDraftRunService` (never a second
   *  endpoint — mirrors the `lossHistory` precedent) when `cvFoldsKey` is
   *  set; `undefined` on a list-endpoint row (`ModelTrainingRunListItem`
   *  never attaches it), `null` on a `get()` row for a non-CV run OR when
   *  the read itself soft-failed. Never conflate the two — a per-fold
   *  table has nothing to show in either case, but only `null` after a
   *  `get()` call means "this really is/was checked". */
  cvFolds?: RunCvFolds | null
  candidateJobId: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  logs: ModelTrainingRunLog[]
}

/** The list endpoint sends no `logs` — only `get` for a single run does. */
export type ModelTrainingRunListItem = Omit<ModelTrainingRun, 'logs'>

/**
 * `algorithm` is deliberately narrower than `store/model-pipeline.ts`'s full
 * `Algorithm` catalogue — train.py's `build_model` implements exactly these
 * 10 (images/trainer/train.py); `lstm`/`gru` are the two catalogue entries
 * still deferred. Callers must refuse anything else client-side
 * (MODEL-FLOW-003-T10) rather than send it and let the container fail.
 */
export interface CreateDraftRunInput {
  goldArtifactId: string
  targetY: string
  algorithm:
    | 'ols'
    | 'ridge'
    | 'hist_gradient_boosting'
    | 'svm'
    | 'mlp'
    | 'grp'
    | 'pls'
    | 'random_forest'
    | 'lightgbm'
    | 'xgboost'
  hyperparameters?: Record<string, unknown>
  /** A FRACTION (0.5-0.95), never a percentage — same boundary rule as
   * PatchModelDraftInput.splitRatio. Mutually exclusive with `nSplits` —
   * matches CreateTrainingRunSchema's own .refine() server-side. */
  trainTestSplit?: number
  /** MODEL-FLOW-016-T10. Present => Cross-Validation (2-10 expanding
   * folds); absent => the ordinary chronological `trainTestSplit` above. */
  nSplits?: number
  seed?: number
  /** MODEL-FLOW-014-T06. The Split Distribution panel's tag selection at
   * launch, so the frozen splitStats sidecar matches what was displayed. */
  splitStatsTags?: string[]
}

const runsBase = (draftId: string) => `${one(draftId)}/runs`
const oneRun = (draftId: string, runId: string) =>
  `${runsBase(draftId)}/${encodeURIComponent(runId)}`

/**
 * A training run's test-split predictions, parsed (MODEL-FLOW-004). Every
 * scalar (`rowCount`, `residualSd`, the y ranges) is computed server-side
 * over the FULL frame — this endpoint has no decimation branch, so
 * `rowCount === points.length` always. `residualRmseCheck` is a cross-check
 * against the run's own `metrics.rmse`, not a second source of truth to
 * display — Step 4 shows `ModelTrainingRun.metrics`.
 */
export interface RunPredictionPoint {
  timestamp: string
  yTrue: number
  yPred: number
}

export interface RunPredictions {
  sourceKey: string
  rowCount: number
  residualSd: number
  residualRmseCheck: number
  yTrueMin: number
  yTrueMax: number
  yPredMin: number
  yPredMax: number
  points: RunPredictionPoint[]
  /** From the run's manifest — the leakage guard's own record. Null when no
   *  manifest was recorded (predates MODEL-FLOW-003-T08 or `manifestKey` is
   *  unset). */
  derivedFromTarget: string[] | null
  targetScaled: boolean | null
}

/** Wire shape is snake_case (the python service's own convention) — mapped
 *  once here so every other caller works in the client's camelCase. */
interface RunPredictionsWire {
  source_key: string
  row_count: number
  residual_sd: number
  residual_rmse_check: number
  y_true_min: number
  y_true_max: number
  y_pred_min: number
  y_pred_max: number
  points: { timestamp: string; y_true: number; y_pred: number }[]
  derived_from_target: string[] | null
  target_scaled: boolean | null
}

function toRunPredictions(wire: RunPredictionsWire): RunPredictions {
  return {
    sourceKey: wire.source_key,
    rowCount: wire.row_count,
    residualSd: wire.residual_sd,
    residualRmseCheck: wire.residual_rmse_check,
    yTrueMin: wire.y_true_min,
    yTrueMax: wire.y_true_max,
    yPredMin: wire.y_pred_min,
    yPredMax: wire.y_pred_max,
    points: wire.points.map(p => ({
      timestamp: p.timestamp,
      yTrue: p.y_true,
      yPred: p.y_pred,
    })),
    derivedFromTarget: wire.derived_from_target,
    targetScaled: wire.target_scaled,
  }
}

/**
 * MODEL-FLOW-017-T02/T03. One run's DECIMATED series, or its failure — the
 * batch counterpart of `RunPredictions` above. `error` non-null means every
 * numeric field is `null` and `points` is empty; `runId` is resolved
 * server-side from the `predictionsKey` the caller asked for, so the client
 * never has to re-match a source key back to a run itself.
 */
export interface RunPredictionsBatchItem {
  runId: string | null
  sourceKey: string
  rowCount: number | null
  residualSd: number | null
  residualRmseCheck: number | null
  yTrueMin: number | null
  yTrueMax: number | null
  yPredMin: number | null
  yPredMax: number | null
  points: RunPredictionPoint[]
  /** True count exceeded what was returned — see `points.length` for what
   *  actually rendered. State this in the chart, per DraftScatterResult's
   *  own "N of M shown" precedent. */
  downsampled: boolean
  error: string | null
}

export interface RunPredictionsBatchResult {
  results: RunPredictionsBatchItem[]
}

interface RunPredictionsBatchItemWire {
  source_key: string
  row_count: number | null
  residual_sd: number | null
  residual_rmse_check: number | null
  y_true_min: number | null
  y_true_max: number | null
  y_pred_min: number | null
  y_pred_max: number | null
  points: { timestamp: string; y_true: number; y_pred: number }[]
  downsampled: boolean
  error: string | null
  runId: string | null
}

interface RunPredictionsBatchWire {
  results: RunPredictionsBatchItemWire[]
}

function toRunPredictionsBatch(
  wire: RunPredictionsBatchWire,
): RunPredictionsBatchResult {
  return {
    results: wire.results.map(item => ({
      runId: item.runId,
      sourceKey: item.source_key,
      rowCount: item.row_count,
      residualSd: item.residual_sd,
      residualRmseCheck: item.residual_rmse_check,
      yTrueMin: item.y_true_min,
      yTrueMax: item.y_true_max,
      yPredMin: item.y_pred_min,
      yPredMax: item.y_pred_max,
      points: item.points.map(p => ({
        timestamp: p.timestamp,
        yTrue: p.y_true,
        yPred: p.y_pred,
      })),
      downsampled: item.downsampled,
      error: item.error,
    })),
  }
}

// ── Candidate jobs (MODEL-FLOW-005, generalized by MODEL-FLOW-013) ─────────
// Algorithm sweep ("Find Best Model") or hyperparameter search over
// draft-scoped runs, mirroring modelDraftRunService's shape one level up —
// same `authorized/model-drafts` prefix, same envelope.

export type ModelCandidateJobStatus = ModelRunStatus
export type ModelCandidateJobKind =
  | 'HYPERPARAMETER_SEARCH'
  | 'ALGORITHM_SWEEP'
  /** MODEL-FLOW-013-T11. Phase 1 sweeps the selected algorithms; phase 2
   *  (appended server-side once phase 1 exhausts) tunes phase 1's winner via
   *  a curated shortlist — see `CandidateResult.phase` below. */
  | 'SWEEP_THEN_TUNE'

export interface CandidateInput {
  algorithm: CreateDraftRunInput['algorithm']
  hyperparameters: Record<string, unknown>
}

export interface CreateCandidateJobInput {
  goldArtifactId: string
  targetY: string
  trainTestSplit?: number
  kind: ModelCandidateJobKind
  candidates: CandidateInput[]
}

/** One candidate's own outcome, resolved against its run row server-side
 *  (MODEL-FLOW-013-T06) — `runId` is null until this candidate's turn to
 *  launch, `status` is `'PENDING'` for that same case. */
export interface CandidateResult {
  runId: string | null
  algorithm: string
  hyperparameters: Record<string, unknown>
  /** MODEL-FLOW-013-T11. 1 (the sweep) or 2 (SWEEP_THEN_TUNE's tune-the-
   *  winner phase). Always present in the server response (defaults to 1
   *  server-side for a candidate written before this field existed). */
  phase: number
  status: ModelRunStatus | 'PENDING'
  failureReason: string | null
  metrics: { r2: number | null; rmse: number | null; mae: number | null } | null
  trainMetrics: {
    r2: number | null
    rmse: number | null
    mae: number | null
  } | null
  lossHistoryKey: string | null
  /** MODEL-FLOW-013-T05a/T07. The render mode is a property of the RUN —
   *  present iff `lossHistoryKey` is, never keyed off `algorithm`. Null
   *  means mode B (paired train/test marks), regardless of algorithm. */
  lossHistory: {
    algorithm: string
    metric: string
    series: Record<string, number[]>
  } | null
  /** MODEL-FLOW-017-T03. A pointer only — the client resolves its OWN batch
   *  of runIds from `predictionsKey !== null` and fetches every series in
   *  one call (`modelDraftRunService.predictionsBatch`), rather than this
   *  job response embedding the series inline the way it does for
   *  `lossHistory` (a chart's full series is much larger than a loss
   *  curve's few hundred floats). */
  predictionsKey: string | null
  /** Present on a CV candidate. Combined with `predictionsKey`, tells the
   *  client whether a non-null predictionsKey is a test-split series or a
   *  scored holdout — see MODEL-FLOW-016 AC5's 2026-09-04 amendment. */
  cvFoldsKey: string | null
  /** Non-null while a CV candidate's holdout-scoring phase is in flight. */
  scoringContainerId: string | null
}

export interface ModelCandidateJob {
  id: string
  modelDraftId: string
  targetY: string
  goldArtifactId: string
  trainTestSplit: number | null
  kind: ModelCandidateJobKind
  totalRuns: number
  completedRuns: number
  status: ModelCandidateJobStatus
  failureReason: string | null
  currentRunId: string | null
  bestRunId: string | null
  bestRmse: number | null
  selectedRunId: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  candidates: CandidateResult[]
}

const candidateJobsBase = (draftId: string) => `${one(draftId)}/candidate-jobs`
const oneCandidateJob = (draftId: string, jobId: string) =>
  `${candidateJobsBase(draftId)}/${encodeURIComponent(jobId)}`

export const modelDraftCandidateJobService = {
  create: (
    draftId: string,
    body: CreateCandidateJobInput,
  ): Promise<ApiResponse<ModelCandidateJob>> =>
    fetchClient(candidateJobsBase(draftId), {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  get: (
    draftId: string,
    jobId: string,
  ): Promise<ApiResponse<ModelCandidateJob>> =>
    fetchClient(oneCandidateJob(draftId, jobId), { method: 'GET' }),

  /** MODEL-FLOW-013-T08. Refused server-side unless the job is terminal and
   *  runId names one of its own SUCCEEDED candidates. */
  select: (
    draftId: string,
    jobId: string,
    runId: string,
  ): Promise<ApiResponse<ModelCandidateJob>> =>
    fetchClient(`${oneCandidateJob(draftId, jobId)}/select`, {
      method: 'POST',
      body: JSON.stringify({ runId }),
    }),
}

export const modelDraftRunService = {
  create: (
    draftId: string,
    body: CreateDraftRunInput,
  ): Promise<ApiResponse<ModelTrainingRun>> =>
    fetchClient(runsBase(draftId), {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** MODEL-FLOW-012 — every run for the run picker, most-recent-first (server order). */
  list: (draftId: string): Promise<ApiResponse<ModelTrainingRunListItem[]>> =>
    fetchClient(runsBase(draftId), { method: 'GET' }),

  get: (
    draftId: string,
    runId: string,
  ): Promise<ApiResponse<ModelTrainingRun>> =>
    fetchClient(oneRun(draftId, runId), { method: 'GET' }),

  predictions: async (
    draftId: string,
    runId: string,
  ): Promise<ApiResponse<RunPredictions>> => {
    const res: ApiResponse<RunPredictionsWire> = await fetchClient(
      `${oneRun(draftId, runId)}/predictions`,
      { method: 'GET' },
    )
    return { ...res, data: toRunPredictions(res.data) }
  },

  /**
   * MODEL-FLOW-017-T02/T03. Decimated actual/predicted series for every run
   * in `runIds`, one call — Step 4's overlay + small-multiple charts. A run
   * that is not SUCCEEDED or has no predictions artifact is silently absent
   * from `results`, not an error; a run whose series could not be read
   * still has an entry, with `error` set. Empty `runIds` short-circuits
   * without a request — there is nothing to ask for.
   */
  predictionsBatch: async (
    draftId: string,
    runIds: string[],
  ): Promise<ApiResponse<RunPredictionsBatchResult>> => {
    if (runIds.length === 0) {
      return {
        statusCode: 200,
        message: 'No run ids requested',
        type: 'SUCCESS',
        data: { results: [] },
      }
    }
    const res: ApiResponse<RunPredictionsBatchWire> = await fetchClient(
      `${runsBase(draftId)}/predictions/batch?runIds=${runIds
        .map(encodeURIComponent)
        .join(',')}`,
      { method: 'GET' },
    )
    return { ...res, data: toRunPredictionsBatch(res.data) }
  },

  /** MODEL-FLOW-016-T07/T11. Triggers a CV run's separate holdout-scoring
   *  phase (refused server-side for a non-CV run, or one already scoring —
   *  see `triggerScoringService`'s own checks). Poll `get()` afterwards for
   *  `scoringContainerId` (in flight) / `predictionsKey` + `holdoutMetrics`
   *  (finished), same as training's own poll loop. */
  score: (
    draftId: string,
    runId: string,
  ): Promise<ApiResponse<{ runId: string; scoring: true }>> =>
    fetchClient(`${oneRun(draftId, runId)}/score`, { method: 'POST' }),
}
