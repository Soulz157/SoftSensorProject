import { fetchClient } from '@/lib/fetcher'

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

const base = '/api/v1/authorized/model-drafts'
const one = (draftId: string) => `${base}/${encodeURIComponent(draftId)}`

export const modelDraftService = {
  create: (body: CreateModelDraftInput): Promise<ApiResponse<ModelDraft>> =>
    fetchClient(base, { method: 'POST', body: JSON.stringify(body) }),

  get: (draftId: string): Promise<ApiResponse<ModelDraft>> =>
    fetchClient(one(draftId), { method: 'GET' }),

  patch: (
    draftId: string,
    body: PatchModelDraftInput,
  ): Promise<ApiResponse<ModelDraft>> =>
    fetchClient(one(draftId), { method: 'PATCH', body: JSON.stringify(body) }),

  abandon: (draftId: string): Promise<ApiResponse<ModelDraft>> =>
    fetchClient(`${one(draftId)}/abandon`, { method: 'POST' }),
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

export interface ModelTrainingRun {
  id: string
  status: ModelRunStatus
  failureReason: string | null
  targetY: string
  algorithm: string
  modelKey: string | null
  metrics: Record<string, unknown> | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  logs: ModelTrainingRunLog[]
}

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

export const modelDraftRunService = {
  create: (
    draftId: string,
    body: CreateDraftRunInput,
  ): Promise<ApiResponse<ModelTrainingRun>> =>
    fetchClient(runsBase(draftId), {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  get: (
    draftId: string,
    runId: string,
  ): Promise<ApiResponse<ModelTrainingRun>> =>
    fetchClient(oneRun(draftId, runId), { method: 'GET' }),
}
