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
  /** A FRACTION (0.5-0.95), never a percentage — same boundary rule as PatchModelDraftInput.splitRatio. */
  trainTestSplit?: number
  seed?: number
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
}
