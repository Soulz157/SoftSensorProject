import { fetchClient } from '@/lib/fetcher'
import {
  brandModelVersionNumber,
  type ModelVersionNumber,
} from '@/lib/model-version-number'
import {
  toRunPredictions,
  type RunPredictions,
  type RunPredictionsWire,
} from '@/services/model-draft'
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
type MetricTriple = {
  rmse: number | null
  r2: number | null
  mae: number | null
}

/**
 * MODEL-SERVE-019-T03/D02. The evaluation basis a single metric figure was
 * computed on — never render a figure without its own `*Basis`. `from`/`to`/
 * `rowCount` come from persisted rows; any can be null alongside
 * `unavailableReason`. `frame`/`usedFor` are internal codes: map them to
 * plain text in `lib/retrain-basis.ts` — never render them raw (no
 * "incumbent"/"frozen"/"basis" on screen, see that module's own note).
 */
export interface EvalBasis {
  frame:
    | 'MERGED_TEST_SPLIT'
    | 'FROZEN_INCUMBENT_TEST'
    | 'NEW_DATA_WINDOW'
    | 'INCUMBENT_TEST_SPLIT'
  from: string | null
  to: string | null
  rowCount: number | null
  usedFor: 'RANK_CANDIDATES' | 'COMPARE_TO_PRODUCTION' | 'REPORT_ONLY'
  unavailableReason: string | null
}

/** MODEL-SERVE-015-T05/019-T03. The merged training composition — closes
 *  015-T05's stranded "combined row count" acceptance criterion. Null for
 *  KEEP_EXISTING, which never combines anything. */
export interface TrainingComposition {
  baseTrainRowCount: number | null
  newTrainRowCount: number | null
  dedupeDropped: number | null
  cutTimestamp: string | null
  combinedRowCount: number | null
  /** What the candidate was actually FIT on (its own recorded split), as
   *  opposed to what the combined data CONTAINS above. The newest rows — the
   *  new data — fall in the test split, so these can differ sharply. */
  fitRowCount: number | null
  fitUpTo: string | null
  /** True/false when the persisted facts settle whether any new-data row was
   *  in the fit; null when they cannot. Never guessed. */
  newDataUsedInFit: boolean | null
}

export interface RetrainComparison {
  basis: {
    goldArtifactId: string | null
    artifactChecksum: string | null
    targetY: string | null
    split: { method?: string; ratio?: number } | null
    comparable: boolean
    reason: string | null
    /** MODEL-SERVE-015. Which invariant `comparable` is proving —
     *  'KEEP_EXISTING' means one shared artifact/checksum/split;
     *  'AUGMENT_DATA'/'NEW_DATA_ONLY' means the candidate was scored on the
     *  current production version's own test rows regardless of what it
     *  trained on. State this alongside a delta — "comparable" does not
     *  mean one universal thing. Internal code — never rendered raw. */
    strategy: 'KEEP_EXISTING' | 'AUGMENT_DATA' | 'NEW_DATA_ONLY'
    /** Non-null only for a new-data strategy. `kind` mirrors the backend's
     *  `ModelTrainingRun.evalSetKind` — null means the candidate has not
     *  been scored against that basis yet. */
    evalSet: { kind: string | null; checksum: string | null } | null
    trainingComposition: TrainingComposition | null
  }
  incumbent: {
    versionId: string
    version: number
    stage: string
    algorithm: string
    /** MODEL-SERVE-020-T05. The run the current version was trained by —
     *  what the Retrain tab's charts read its test predictions from. */
    sourceRunId: string
    metrics: MetricTriple
    metricsBasis: EvalBasis
  }
  candidate: {
    runId: string | null
    versionId: string | null
    /** Set only once the job has completed and minted its STAGING version. */
    version: number | null
    stage: string | null
    algorithm: string | null
    metrics: MetricTriple
    /** Null for a KEEP_EXISTING (or legacy) job — that path predates the
     *  "every figure names its basis" requirement and is display-only
     *  history from here on. */
    metricsBasis: EvalBasis | null
    /** MODEL-SERVE-015-T04. A new-data strategy only — the candidate's OWN
     *  test split over the COMBINED (existing + new) data, reported
     *  separately from `metrics` (the figure `rmseDelta` is computed from).
     *  Null for a plain (014) retrain. */
    newRegimeMetrics: MetricTriple | null
    newRegimeMetricsBasis: EvalBasis | null
    /** The candidate's score on the operator-defined NEW-DATA validation
     *  window, when a retrain carved one out. Null when no window was
     *  requested, when the trainer image predates the feature, or when
     *  scoring soft-failed.
     *
     *  MUST NOT be differenced against the incumbent: the incumbent was
     *  never scored on these rows, so such a delta would be meaningless.
     *  It stands on its own, beside `rmseDelta` rather than inside it. */
    newDataHoldoutMetrics: MetricTriple | null
    /** Rows in that window, and the MEASURED first/last timestamps of the
     *  rows actually held out — not the bounds the operator asked for — so
     *  the UI can state what the figure above was computed on. */
    newDataHoldoutRowCount: number | null
    newDataHoldoutFrom: string | null
    newDataHoldoutTo: string | null
    newDataHoldoutBasis: EvalBasis | null
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
  /** MODEL-SERVE-015/017. Null for every plain (014) or KEEP_EXISTING
   *  retrain job. MODEL-SERVE-019 was missing 'NEW_DATA_ONLY' here — a job
   *  created under that strategy typed as impossible. */
  retrainStrategy: 'AUGMENT_DATA' | 'NEW_DATA_ONLY' | null
  baseDatasetVersionId: string | null
  additionalDatasetVersionId: string | null
  combinedArtifactId: string | null
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
  /** MODEL-SERVE-015-T01. The dataset the incumbent was ACTUALLY trained on
   *  — resolved server-side off the incumbent's own pinned artifact, never
   *  `Model.datasetId` (which can point somewhere else by the time a
   *  retrain is triggered). Shown read-only as the augmentation strategy's
   *  "Base Dataset". Null when the incumbent's artifact has no DatasetVersion
   *  row (a legacy or draft-only artifact) — data augmentation is
   *  unavailable in that case; Keep Existing Data still works. */
  baseDataset: {
    datasetId: string
    datasetName: string
    versionId: string | null
    versionNumber: number | null
  } | null
  /** MODEL-SERVE-017. The incumbent's own computed split boundary, from its
   *  source run's `splitSpec`. New data must start strictly AFTER this — the
   *  server refuses anything earlier (`assertCompatible`), because those rows
   *  are the frozen evaluation set. Used to clamp the fetch range picker so
   *  an impossible window is never offered. Null when the source run
   *  recorded no boundary; the picker then goes unclamped and the server's
   *  own 422 is the guard. */
  cutTimestamp: string | null
  /** The version's own hyperparameters — Custom Finetune's table opens on
   *  these. Null when the version recorded none. */
  hyperparameters: Record<string, unknown> | null
  /** The train ratio a retrain reuses unless Custom Finetune names its own
   *  (0–1). Null for a cross-validated or unreadable split. */
  trainTestSplit: number | null
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
  /** MODEL-SERVE-019. REQUIRED — this REVISES 015-T01's own note, which
   *  defaulted an omitted field to 'KEEP_EXISTING' server-side. A retrain
   *  now always ingests new data: 'AUGMENT_DATA' or 'NEW_DATA_ONLY', each
   *  requiring `additionalDatasetVersionId` (the server's own `.strict()`
   *  schema refuses one without the other). 'KEEP_EXISTING' stays a valid
   *  value ONLY for replaying an old job by `idempotencyKey` — sending it on
   *  a fresh request is refused with 422. */
  strategy: 'KEEP_EXISTING' | 'AUGMENT_DATA' | 'NEW_DATA_ONLY'
  additionalDatasetVersionId?: string
  /** The operator's NEW-DATA validation window: a slice of the newly merged
   *  dataset held out of training and scored on its own, so the retrain
   *  reports how the candidate does on the NEW data and not only on the
   *  incumbent's old frozen rows.
   *
   *  Both or neither — the server refuses a half-open pair rather than
   *  guessing at it — and only on a strategy that ingests new data. The real
   *  bounds check happens server-side, where the dataset's actual first/last
   *  timestamps are known. ISO-8601. */
  newValidationFrom?: string
  newValidationTo?: string
  /** Custom Finetune's own train ratio (0.5–0.95). Omitted = the current
   *  version's ratio, reused server-side. */
  trainTestSplit?: number
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

/**
 * MODEL-SERVE-020-T04/T05. Which per-row series to read for a retrain run:
 * `test` is the run's own test split (for the current version, its full test
 * data), `holdout` the slice the new version is scored on against the current
 * version's test data, `new_data_holdout` the rows set aside from the new
 * dataset. MODEL-SERVE-021 adds `current_new_data_holdout` — the CURRENT
 * version's OWN series on that same window, present only for a NEW_DATA_ONLY
 * (replace) retrain, read off the CANDIDATE run (never the current version's
 * own run — that scoring never touches it). Mirrors the backend's
 * `ModelRunPredictionPopulationEnum`.
 */
export type RetrainPredictionPopulation =
  | 'test'
  | 'holdout'
  | 'new_data_holdout'
  | 'current_new_data_holdout'

/** A Model-owned run's per-row predictions. A 404 (thrown as `ApiError` by
 *  `fetchClient`) carries the server's own reason naming which population is
 *  missing — surface that message, never a generic one. */
export const modelRunPredictionsService = {
  get: async (
    modelId: string,
    runId: string,
    population: RetrainPredictionPopulation,
  ): Promise<ApiResponse<RunPredictions>> => {
    const res: ApiResponse<RunPredictionsWire> = await fetchClient(
      `/api/v1/authorized/model/${modelId}/runs/${encodeURIComponent(runId)}/predictions?population=${population}`,
      { method: 'GET' },
    )
    return { ...res, data: toRunPredictions(res.data) }
  },
}
