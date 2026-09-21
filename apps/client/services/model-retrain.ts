import { fetchClient } from '@/lib/fetcher'
import {
  brandModelVersionNumber,
  type ModelVersionNumber,
} from '@/lib/model-version-number'
import type {
  CandidateInput,
  CandidateResult,
  CreateDraftRunInput,
  ModelCandidateJobKind,
  ModelCandidateJobStatus,
  ModelTrainingRunLog,
} from '@/services/model-draft'

interface ApiResponse<T> {
  data: T
  statusCode: number
  message: string
  type: string
}

/**
 * MODEL-SERVE-014. The comparison MODEL-SERVE-004-T05's `buildComparison`
 * publishes — never a bare RMSE delta. `basis.comparable === false` means
 * `rmseDelta` is null and BOTH raw metric triples below must still be
 * shown; a delta is only ever rendered when the basis says the two sides
 * were actually scored on the same thing.
 */
export interface RetrainComparison {
  basis: {
    goldArtifactId: string | null
    artifactChecksum: string | null
    targetY: string | null
    split: { method?: string; ratio?: number } | null
    comparable: boolean
    reason: string | null
  }
  incumbent: {
    versionId: string
    version: number
    stage: string
    algorithm: string
    metrics: { rmse: number | null; r2: number | null; mae: number | null }
  }
  candidate: {
    runId: string | null
    versionId: string | null
    /** Set only once the job has completed and minted its STAGING version. */
    version: number | null
    stage: string | null
    algorithm: string | null
    metrics: { rmse: number | null; r2: number | null; mae: number | null }
  }
  /** Negative = the candidate is better (lower RMSE). Null when the bases
   *  differ — see `basis.reason`. */
  rmseDelta: number | null
  selectionMetric: 'rmse'
}

/**
 * The retrain job row — a `ModelCandidateJob` owned by a Model rather than a
 * ModelDraft (`services/model-draft.ts`'s own `ModelCandidateJob` type
 * assumes the draft-owned shape and is not reused here: `modelDraftId` is
 * always null on a retrain job, `modelId`/`sourceVersionId`/
 * `resultVersionId` are retrain-only fields that type never carries).
 */
export interface RetrainJob {
  id: string
  modelId: string
  sourceVersionId: string | null
  resultVersionId: string | null
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
  idempotencyKey: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  candidates: CandidateResult[]
  comparison: RetrainComparison | null
}

/** The incumbent PRODUCTION version — resolved independently of any job, so
 *  the dialog knows the algorithm to build a Custom form around, and knows
 *  "no PRODUCTION version" before the user ever submits. Null means there
 *  is nothing to retrain against yet. */
export interface RetrainIncumbent {
  versionId: string
  version: number
  /** The real 12-value enum, not a client-invented subset — this is what
   *  `custom-finetune-form.tsx` pins Custom Finetune's one candidate to. */
  algorithm: CreateDraftRunInput['algorithm']
}

export interface CurrentRetrainState {
  incumbent: RetrainIncumbent | null
  job: RetrainJob | null
}

export interface TriggerRetrainInput {
  /** Held by the caller across a retry so a dropped response resolves to
   *  the SAME job rather than a second one — never regenerated per attempt. */
  idempotencyKey: string
  /** Omitted = the incumbent's own algorithm + hyperparameters, expanded
   *  server-side through the curated TUNING_GRID (Auto Finetune). Present =
   *  Custom Finetune's one candidate, still against the incumbent's own
   *  algorithm (see `custom-finetune-form.tsx`'s own note on why the
   *  algorithm picker was dropped). */
  candidates?: CandidateInput[]
}

/**
 * MODEL-SERVE-014-T02 corrected against MODEL-SERVE-004's real contract —
 * NOT what MODEL-SERVE-014-T02's own detail text describes ("the client
 * submits the retrain configuration"). `TriggerRetrainSchema` is `.strict()`
 * and accepts only `idempotencyKey` + `candidates`; artifact, target and
 * split are read server-side off the incumbent so the comparison this
 * feature publishes has one shared basis. See the ledger's corrected T01/T02
 * detail.
 */
export const modelRetrainService = {
  /** 201 on a fresh trigger, 200 when `idempotencyKey` replays an existing
   *  job — both return the same job envelope; treat them identically. A 409
   *  (another retrain already live) is thrown as `ApiError` by `fetchClient`
   *  with the real backend message — read `.status`, never parse the
   *  message string for a job id. */
  trigger: (
    modelId: string,
    body: TriggerRetrainInput,
  ): Promise<ApiResponse<RetrainJob>> =>
    fetchClient(`/api/v1/authorized/model/${modelId}/retrain`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  get: (modelId: string, jobId: string): Promise<ApiResponse<RetrainJob>> =>
    fetchClient(
      `/api/v1/authorized/model/${modelId}/retrain/${encodeURIComponent(jobId)}`,
      { method: 'GET' },
    ),

  /** MODEL-SERVE-014. The one discovery route the trigger/get pair does not
   *  provide on its own — what lets the retrain dialog and progress view
   *  survive a refresh or a second tab instead of only living in the
   *  triggering request's own React state. */
  current: (modelId: string): Promise<ApiResponse<CurrentRetrainState>> =>
    fetchClient(`/api/v1/authorized/model/${modelId}/retrain/current`, {
      method: 'GET',
    }),
}

/**
 * MODEL-SERVE-014. The retrain result's own STAGING version number, branded
 * so it can be handed to `modelVersionService.promote` (Apply to
 * Production).
 *
 * Minted HERE rather than at the button's call site, because this module is
 * the boundary that parses the server response carrying it — the rule
 * `lib/model-version-number.ts` states: minting stays confined to the
 * modules that read a version off a real server payload, never reachable
 * from a call site that merely knows a small integer.
 *
 * Null whenever there is nothing promotable yet: no comparison, no minted
 * version, or a candidate that is not STAGING (a retrain promotes nothing
 * on its own — only an explicit user action does).
 */
export function promotableCandidateVersion(
  comparison: RetrainComparison | null,
): ModelVersionNumber | null {
  const candidate = comparison?.candidate
  if (!candidate?.versionId || candidate.version === null) return null
  if (candidate.stage !== 'STAGING') return null
  return brandModelVersionNumber(candidate.version)
}

/** A model-owned training run's logs — same row shape
 *  `services/model-draft.ts`'s `ModelTrainingRun.logs` carries, fetched
 *  through the model-run-launch surface (`GET
 *  /authorized/model/:modelId/runs/:runId`) since a retrain candidate's run
 *  is owned by the Model, not a ModelDraft.
 *
 *  UNWRAPPED, unlike every other call in this file — `getRunService`
 *  (model-run-launch.authorized.service.ts) returns the Prisma row
 *  directly, not the `{statusCode, message, data}` envelope its
 *  draft-scoped sibling (`getDraftRunService`) wraps. Matched here rather
 *  than "fixed", since normalizing that envelope is a different module's
 *  change and out of this feature's scope. */
export const modelRunLogsService = {
  get: (
    modelId: string,
    runId: string,
  ): Promise<{
    id: string
    status: string
    failureReason: string | null
    logs: ModelTrainingRunLog[]
  }> =>
    fetchClient(
      `/api/v1/authorized/model/${modelId}/runs/${encodeURIComponent(runId)}`,
      { method: 'GET' },
    ),
}
