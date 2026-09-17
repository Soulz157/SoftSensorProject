import { z } from 'zod';
import { postToPython, PYTHON_TIMEOUT } from './python-client';

/**
 * Typed wrappers over the preprocess endpoints the training pipeline needs.
 *
 * Plain exported functions, matching `python-client.ts` — this codebase has no
 * injectable client in the Python path, and introducing one just for training
 * would make two ways to reach the same service.
 *
 * Every response is PARSED, not cast, per the boundary convention
 * `postBinaryToPython`'s doc comment names as the rule it is the one exception
 * to. That matters more here than usual: a field arriving `undefined` because
 * of a snake_case/camelCase slip would silently pin a run to an empty
 * checksum, and the mismatch would only surface inside a container.
 */

/** Snake_case on the wire — the connector's own convention. */
const PresignArtifactSchema = z.object({
  data_url: z.string().url(),
  sidecar_urls: z.record(z.string(), z.string().url().nullable()),
  checksum: z.string().min(1),
  row_count: z.number().int().nonnegative(),
  // MODEL-SERVE-007-T06. The bucket the key is relative to — NestJS has no
  // S3 configuration of its own, so the connector is the only place this can
  // come from. OPTIONAL on purpose: a python deployment that predates the
  // field must not fail this parse, and every consumer already has a correct
  // answer without it (`classForKey`'s rootless default).
  bucket: z.string().min(1).optional(),
  expires_at: z.string(),
});

const PresignUploadSchema = z.object({
  upload_urls: z.record(z.string(), z.string().url()),
  expires_at: z.string(),
});

const MetadataSchema = z.object({
  tags: z.array(z.string()),
  column_count: z.number().int().nonnegative(),
  row_count: z.number().int().nonnegative(),
  start_time: z.string().nullable(),
  end_time: z.string().nullable(),
});

export type PresignedArtifact = z.infer<typeof PresignArtifactSchema>;
export type PresignedUpload = z.infer<typeof PresignUploadSchema>;
export type ArtifactMetadata = z.infer<typeof MetadataSchema>;

export async function presignArtifact(input: {
  source_key: string;
  sidecars?: string[];
}): Promise<PresignedArtifact> {
  const res = await postToPython<unknown>(
    '/v1/preprocess/artifacts/presign',
    { source_key: input.source_key, sidecars: input.sidecars ?? [] },
    // Not PYTHON_TIMEOUT.preprocess: this endpoint re-hashes the object to
    // return a verifiable checksum, so it is bounded by object SIZE, not by a
    // pipeline. Well short of 300s, but far more than a `test` call.
    PYTHON_TIMEOUT.metadata,
  );
  return PresignArtifactSchema.parse(res);
}

/**
 * EXACTLY ONE of `model_id` / `draft_id` — mirrors the Python schema's own
 * `exactly_one_owner` validator. A run started from the wizard has no
 * model_id yet (MODEL-FLOW-003-T08) and presigns under `drafts/` instead.
 */
export async function presignModelRunUpload(
  input:
    | {
        model_id: string;
        draft_id?: never;
        run_id: string;
        filenames: string[];
      }
    | {
        model_id?: never;
        draft_id: string;
        run_id: string;
        filenames: string[];
      },
): Promise<PresignedUpload> {
  const res = await postToPython<unknown>(
    '/v1/preprocess/models/runs/presign-upload',
    input,
    PYTHON_TIMEOUT.test,
  );
  return PresignUploadSchema.parse(res);
}

/**
 * MODEL-FLOW-016-T08/T07. `row_count` is `null` for anything that is not
 * `validate_ready.parquet` — confirmed live 2026-09-01: `presign_run_object`
 * (artifact_service.py) only computes it for that one filename, and returns
 * `None` for `model.joblib` (T07's own widening of this endpoint). A SEPARATE
 * schema from `PresignArtifactSchema`, not a shared one: that schema's
 * `row_count` is a real, non-nullable guarantee for a committed dataset
 * artifact (always a parquet file), and loosening it to nullable everywhere
 * would weaken that guarantee for every OTHER caller just to accommodate
 * this one. The original T08 doc comment claimed one schema was enough — it
 * was, until T07 widened the endpoint to accept a non-parquet filename;
 * caught live by actually running a scoring container end to end, not by
 * reading: `PresignArtifactSchema.parse` threw on a real `row_count: null`
 * response, uncaught, surfacing as a bare 500 with no diagnostic message.
 */
const PresignRunObjectSchema = z.object({
  data_url: z.string().url(),
  sidecar_urls: z.record(z.string(), z.string().url().nullable()),
  checksum: z.string().min(1),
  row_count: z.number().int().nonnegative().nullable(),
  expires_at: z.string(),
});

export type PresignedRunObject = z.infer<typeof PresignRunObjectSchema>;

/**
 * MODEL-FLOW-016-T08. Presigns a training-run-scoped object for reading —
 * `validate_ready.parquet` (`tryReplayHoldout`, model-run.authorized.
 * service.ts) and, as of T07, `model.joblib` (`scoreClaimService`,
 * model-run-score.authorized.service.ts). Deliberately NOT `presignArtifact`:
 * that call is hard-restricted server-side to `is_committed_artifact_key`
 * (a committed DATASET artifact's data.parquet) and refuses a run-scoped
 * key outright — confirmed live (2026-09-01) as the reason `holdoutMetrics`
 * had been null on every run in this system regardless of whether the
 * dataset actually had a holdout.
 */
export async function presignRunObject(input: {
  source_key: string;
}): Promise<PresignedRunObject> {
  const res = await postToPython<unknown>(
    '/v1/preprocess/models/runs/presign-object',
    { source_key: input.source_key },
    PYTHON_TIMEOUT.metadata,
  );
  return PresignRunObjectSchema.parse(res);
}

/**
 * MODEL-SERVE-003. Time-limited write URLs for a batch container's own two
 * outputs — mirrors `presignModelRunUpload`'s shape one root over, minus
 * the model_id/draft_id split (a PredictionJob always has a modelId).
 */
export async function presignPredictionJobUpload(input: {
  model_id: string;
  job_id: string;
  filenames: string[];
}): Promise<PresignedUpload> {
  const res = await postToPython<unknown>(
    '/v1/preprocess/prediction-jobs/presign-upload',
    input,
    PYTHON_TIMEOUT.test,
  );
  return PresignUploadSchema.parse(res);
}

/**
 * MODEL-SERVE-003. Presigns a PredictionJob's own output.parquet for
 * reading — mirrors `presignRunObject`'s shape one root over. Deliberately
 * NOT `presignArtifact`: that call is hard-restricted server-side to
 * `is_committed_artifact_key` and refuses a prediction-job-scoped key
 * outright, the same class of mistake `presignRunObject` itself exists to
 * fix for run-scoped objects one entity over. `row_count` mirrors
 * `PresignedRunObject`'s own nullable shape — a prediction-job output never
 * carries one (see `presign_prediction_job_object`'s own doc comment).
 */
export async function presignPredictionJobObject(input: {
  source_key: string;
}): Promise<PresignedRunObject> {
  const res = await postToPython<unknown>(
    '/v1/preprocess/prediction-jobs/presign-object',
    { source_key: input.source_key },
    PYTHON_TIMEOUT.metadata,
  );
  return PresignRunObjectSchema.parse(res);
}

/** MODEL-SERVE-001-T17. Mirrors apps/python's `_column_aggregate` return
 *  shape — same as `ColumnAggregateSchema` in `prediction-log.authorized.
 *  dto.ts`'s own `IngestPredictionLogSchema`, redefined locally rather
 *  than imported: this file's own established convention is one schema
 *  per response type, never cross-file reuse of a private DTO-internal
 *  const (every other schema below is local for the identical reason). */
const WindowColumnAggregateSchema = z.object({
  n: z.number().int().min(0),
  sum: z.number(),
  sumsq: z.number(),
  min: z.number(),
  max: z.number(),
});

/** Mirrors apps/python's `_psi_histograms` per-tag return shape — same as
 *  `FeatureHistogramSchema` in `prediction-log.authorized.dto.ts`. */
const WindowFeatureHistogramSchema = z.object({
  counts: z.array(z.number().int().min(0)),
  below: z.number().int().min(0),
  above: z.number().int().min(0),
});

/** Mirrors `InferenceWindowMaterializeResponse` field for field. */
const InferenceWindowMaterializeSchema = z.object({
  object_key: z.string().min(1),
  row_count: z.number().int().nonnegative(),
  scored_rows: z.number().int().nonnegative(),
  missing_pct: z.number(),
  checksum: z.string().min(1),
  // MODEL-SERVE-001-T17. `null` — never omitted, matching pydantic's own
  // `Optional[...] = None` field, which FastAPI still serialises as an
  // explicit `null` key — means "nothing coverable/referenceable", never
  // an error. See `_psi_histograms`/`_scaled_feature_stats`'s own doc
  // comments (apps/python/services/inference_window_service.py) for
  // exactly when each is null.
  feature_histograms: z
    .record(z.string(), WindowFeatureHistogramSchema)
    .nullable(),
  feature_stats: z.record(z.string(), WindowColumnAggregateSchema).nullable(),
  // MODEL-SERVE-009-T02. Per-tag state as of THIS fetch, read before
  // `drop_bad_feature_rows` — the only point where a Bad cell is still
  // visible (after it, every surviving row is Good by construction, which
  // MODEL-SERVE-001-T15 measured when it evaluated input.parquet as a
  // status surface). `.default({})` so a python process that predates this
  // field parses rather than throwing: the caller then writes nothing,
  // which is the correct behaviour for "this fetch told us nothing per
  // tag", and is NOT the same as a fetch that reported every tag missing.
  tag_observations: z
    .record(
      z.string(),
      z.object({
        // The last row's value REGARDLESS of its status — a Bad cell still
        // carries a number, and `last_status` is what says which it was.
        last_value: z.number(),
        // The FETCH PATH's arrival health (0 Good / 1 Bad / 2 Questionable),
        // never PI's own quality flag from the snapshot path.
        last_status: z.number().int(),
        observed_at: z.string(),
      }),
    )
    .default({}),
});

export type InferenceWindowMaterializeResult = z.infer<
  typeof InferenceWindowMaterializeSchema
>;

/**
 * MODEL-SERVE-006-T04/T05/T06. Materializes one scheduled window's
 * pre-scale scoring input — the request shape mirrors `InferenceWindow
 * MaterializeRequest` on the python side. `pi`/`sql` carry PER-REQUEST
 * credentials already decrypted, same discipline every other data-source
 * call in this file follows; never logged, never echoed into an error.
 */
export async function materializeInferenceWindow(input: {
  feature_spec_key: string;
  feature_columns: string[];
  model_id: string;
  model_version_id: string;
  dt: string;
  hour: string;
  window_start: string;
  window_end: string;
  interval: string;
  pi?: Record<string, unknown>;
  sql?: Record<string, unknown>;
}): Promise<InferenceWindowMaterializeResult> {
  const res = await postToPython<unknown>(
    '/v1/preprocess/inference-window',
    input,
    // A real fetch against a source system, not a metadata read — bounded
    // by the same budget `materialize`'s own call site would need, though
    // this codebase has no dedicated PYTHON_TIMEOUT entry for it yet.
    PYTHON_TIMEOUT.preprocess,
  );
  return InferenceWindowMaterializeSchema.parse(res);
}

/** Mirrors `InferenceWindowTruthJoinResponse` field for field. */
const InferenceWindowTruthJoinSchema = z.object({
  // Null when nothing paired — python writes no object for an empty join.
  object_key: z.string().min(1).nullable(),
  checksum: z.string().min(1).nullable(),
  truth_rows: z.number().int().nonnegative(),
  prediction_rows: z.number().int().nonnegative(),
  paired_rows: z.number().int().nonnegative(),
  n: z.number().int().nonnegative(),
  sum_se: z.number(),
  sum_ae: z.number(),
  sum_signed: z.number(),
  sum_actual: z.number(),
  sum_actual_sq: z.number(),
});

export type InferenceWindowTruthJoinResult = z.infer<
  typeof InferenceWindowTruthJoinSchema
>;

/**
 * MODEL-SERVE-005-T03. Re-fetches one window's TARGET tag on its own,
 * much longer lag and joins it to that window's stored predictions.
 *
 * Returns SUFFICIENT STATISTICS, never a finished metric — `lib/live-
 * error.ts` turns them into r2/rmse/mae/sd here, the same split T01 draws
 * for prediction logging (python never computes an aggregate).
 *
 * `pi`/`sql` carry per-request decrypted credentials, the same discipline
 * `materializeInferenceWindow` follows; never logged, never echoed into an
 * error.
 */
export async function joinInferenceWindowTruth(input: {
  predictions_key: string;
  target_column: string;
  model_id: string;
  model_version_id: string;
  dt: string;
  hour: string;
  window_start: string;
  window_end: string;
  tolerance_seconds: number;
  pi?: Record<string, unknown>;
  sql?: Record<string, unknown>;
}): Promise<InferenceWindowTruthJoinResult> {
  const res = await postToPython<unknown>(
    '/v1/preprocess/inference-window/truth-join',
    input,
    // A real fetch against a source system plus an object read — the same
    // budget materializeInferenceWindow takes, for the same reason.
    PYTHON_TIMEOUT.preprocess,
  );
  return InferenceWindowTruthJoinSchema.parse(res);
}

/** Mirrors `InferenceWindowTruthSeriesResponse` field for field. */
const InferenceWindowTruthSeriesSchema = z.object({
  points: z.array(
    z.object({
      timestamp: z.string().min(1),
      predicted: z.number(),
      actual: z.number(),
      residual: z.number(),
    }),
  ),
  truncated: z.boolean(),
});

export type InferenceWindowTruthSeriesResult = z.infer<
  typeof InferenceWindowTruthSeriesSchema
>;

/**
 * MODEL-SERVE-005-T03, read side. The joined pairs behind a set of
 * windows. Takes the EXPLICIT keys this side already holds on
 * `InferenceWindowTruth.pairsKey` rather than asking python to list a
 * prefix — the database is the index for this root.
 */
export async function inferenceWindowTruthSeries(input: {
  keys: string[];
  limit?: number;
}): Promise<InferenceWindowTruthSeriesResult> {
  const res = await postToPython<unknown>(
    '/v1/preprocess/inference-window/truth-series',
    input,
    PYTHON_TIMEOUT.metadata,
  );
  return InferenceWindowTruthSeriesSchema.parse(res);
}

/**
 * MODEL-SERVE-006-T06. Time-limited write URLs for an infer-mode
 * container's own two outputs — mirrors `presignPredictionJobUpload`'s
 * shape one root over (inference/{modelId}/{modelVersionId}/dt=.../
 * hour=.../ instead of predictions/{modelId}/{jobId}/).
 */
export async function presignInferenceWindowUpload(input: {
  model_id: string;
  model_version_id: string;
  dt: string;
  hour: string;
  filenames: string[];
}): Promise<PresignedUpload> {
  const res = await postToPython<unknown>(
    '/v1/preprocess/inference-window/presign-upload',
    input,
    PYTHON_TIMEOUT.test,
  );
  return PresignUploadSchema.parse(res);
}

/**
 * MODEL-SERVE-006-T06. Presigns an inference window's own
 * predictions.parquet for reading — mirrors `presignPredictionJobObject`'s
 * shape one root over.
 */
export async function presignInferenceWindowObject(input: {
  source_key: string;
}): Promise<PresignedRunObject> {
  const res = await postToPython<unknown>(
    '/v1/preprocess/inference-window/presign-object',
    { source_key: input.source_key },
    PYTHON_TIMEOUT.metadata,
  );
  return PresignRunObjectSchema.parse(res);
}

export async function fetchArtifactMetadata(
  sourceKey: string,
): Promise<ArtifactMetadata> {
  const res = await postToPython<unknown>(
    '/v1/preprocess/metadata',
    { source_key: sourceKey },
    PYTHON_TIMEOUT.metadata,
  );
  return MetadataSchema.parse(res);
}

/** Subset of python's `ArtifactStatsResponse` — only what `claim()` needs to
 * presign the freshly-written holdout artifact afterward. */
const ReplayHoldoutForRunSchema = z.object({
  object_key: z.string().min(1),
  row_count: z.number().int().nonnegative(),
  checksum: z.string().min(1),
  /**
   * DS-LAKE-023-T05. Rows `prepare_holdout_for_run` dropped before scaling
   * because a kept feature tag was Bad — null/absent for the legacy
   * `replay_holdout_for_run` path, which this schema is also shared with
   * and which does not populate this field.
   */
  dropped_bad_rows: z.number().int().nonnegative().nullable().optional(),
});

export type ReplayHoldoutForRunResult = z.infer<
  typeof ReplayHoldoutForRunSchema
>;

/**
 * DS-LAKE-018-T05. Replays a training run's own GOLD recipe
 * (`feature_spec_key`) over its raw validation holdout, writing the
 * model-ready result to `target_key`. `claim()` is the only caller —
 * `presignArtifact({source_key: target_key})` afterward is what actually
 * hands the container a download URL for it.
 */
export async function replayHoldoutForRun(input: {
  feature_spec_key: string;
  source_key: string;
  target_key: string;
  holdout_from: string;
  overwrite?: boolean;
}): Promise<ReplayHoldoutForRunResult> {
  const res = await postToPython<unknown>(
    '/v1/preprocess/replay-holdout-for-run',
    input,
    PYTHON_TIMEOUT.preprocess,
  );
  return ReplayHoldoutForRunSchema.parse(res);
}

/**
 * DS-LAKE-023-T03. The SILVER-branch counterpart to `replayHoldoutForRun` —
 * for a holdout produced by the reordered features-stage split, which
 * already carries its derived columns and needs no `holdout_from` (there is
 * no lead-in to trim after the fact). `claim()` is the only caller, same as
 * `replayHoldoutForRun`; the two are mutually exclusive per run, chosen by
 * which artifact row carries `validationRowCount`.
 */
export async function prepareHoldoutForRun(input: {
  feature_spec_key: string;
  source_key: string;
  target_key: string;
  overwrite?: boolean;
}): Promise<ReplayHoldoutForRunResult> {
  const res = await postToPython<unknown>(
    '/v1/preprocess/prepare-holdout-for-run',
    input,
    PYTHON_TIMEOUT.preprocess,
  );
  return ReplayHoldoutForRunSchema.parse(res);
}

/** MODEL-FLOW-004. Snake_case on the wire, matching every other schema here. */
const RunPredictionsSchema = z.object({
  source_key: z.string().min(1),
  row_count: z.number().int().nonnegative(),
  residual_sd: z.number(),
  residual_rmse_check: z.number(),
  y_true_min: z.number(),
  y_true_max: z.number(),
  y_pred_min: z.number(),
  y_pred_max: z.number(),
  points: z.array(
    z.object({
      timestamp: z.string(),
      y_true: z.number(),
      y_pred: z.number(),
    }),
  ),
  derived_from_target: z.array(z.string()).nullable(),
  target_scaled: z.boolean().nullable(),
});

export type RunPredictions = z.infer<typeof RunPredictionsSchema>;

/**
 * MODEL-FLOW-004. Parsed actual/predicted series for one training run's test
 * split. `source_key`/`manifest_key` are resolved by the caller off the
 * `ModelTrainingRun` row (`predictionsKey`/`manifestKey`) — never accepted
 * from a browser request, the same discipline `presignModelRunUpload`'s ids
 * apply on the write side. `PYTHON_TIMEOUT.metadata`: like `presignArtifact`,
 * this reads and decodes the whole object, so it is bounded by object size,
 * not by a pipeline.
 */
export async function runPredictions(input: {
  source_key: string;
  manifest_key?: string | null;
}): Promise<RunPredictions> {
  const res = await postToPython<unknown>(
    '/v1/preprocess/models/runs/predictions',
    { source_key: input.source_key, manifest_key: input.manifest_key ?? null },
    PYTHON_TIMEOUT.metadata,
  );
  return RunPredictionsSchema.parse(res);
}

/**
 * MODEL-FLOW-017-T02. One run's decimated series, or its failure. `error`
 * non-null means every other field but `source_key` is a placeholder —
 * mirrors the per-candidate loss-history soft-fail already established in
 * `model-candidate-job.authorized.service.ts`'s `reconcileAndShape`.
 */
const RunPredictionsBatchItemSchema = z.object({
  source_key: z.string().min(1),
  row_count: z.number().int().nonnegative().nullable(),
  residual_sd: z.number().nullable(),
  residual_rmse_check: z.number().nullable(),
  y_true_min: z.number().nullable(),
  y_true_max: z.number().nullable(),
  y_pred_min: z.number().nullable(),
  y_pred_max: z.number().nullable(),
  points: z.array(
    z.object({
      timestamp: z.string(),
      y_true: z.number(),
      y_pred: z.number(),
    }),
  ),
  downsampled: z.boolean(),
  error: z.string().nullable(),
});

const RunPredictionsBatchSchema = z.object({
  results: z.array(RunPredictionsBatchItemSchema),
});

export type RunPredictionsBatchItem = z.infer<
  typeof RunPredictionsBatchItemSchema
>;
export type RunPredictionsBatch = z.infer<typeof RunPredictionsBatchSchema>;

/**
 * MODEL-FLOW-017-T02/T03. Decimated actual/predicted series for N runs in
 * one call — Step 4 Model Selection's overlay + small-multiple charts.
 * `keys` are resolved by the caller off `ModelTrainingRun` rows
 * (`predictionsKey`), never accepted from a browser request, same
 * discipline `runPredictions` applies to its own key. Distinct from
 * `runPredictions`: that endpoint stays undecimated for Step 5's
 * full-width chart, this one always decimates and never throws per-run —
 * a bad run's item carries only `source_key` and `error`.
 */
export async function runPredictionsBatch(input: {
  keys: string[];
  max_points?: number;
}): Promise<RunPredictionsBatch> {
  const res = await postToPython<unknown>(
    '/v1/preprocess/models/runs/predictions/batch',
    {
      keys: input.keys,
      ...(input.max_points !== undefined
        ? { max_points: input.max_points }
        : {}),
    },
    PYTHON_TIMEOUT.metadata,
  );
  return RunPredictionsBatchSchema.parse(res);
}

/** MODEL-FLOW-013-T05/T07. Already the exact shape train.py wrote — no
 *  snake_case/camelCase mapping needed beyond the outer keys. */
const RunLossHistorySchema = z.object({
  algorithm: z.string().min(1),
  metric: z.string().min(1),
  series: z.record(z.string(), z.array(z.number())),
});

export type RunLossHistory = z.infer<typeof RunLossHistorySchema>;

/**
 * MODEL-FLOW-013-T05/T07. `source_key` is resolved by the caller off the
 * `ModelTrainingRun` row (`lossHistoryKey`) — never accepted from a browser
 * request, same discipline `runPredictions` applies to its own key.
 */
export async function getRunLossHistory(
  sourceKey: string,
): Promise<RunLossHistory> {
  const res = await postToPython<unknown>(
    '/v1/preprocess/models/runs/loss-history',
    { source_key: sourceKey },
    PYTHON_TIMEOUT.metadata,
  );
  return RunLossHistorySchema.parse(res);
}

/** MODEL-FLOW-016-T04/T11. Already the exact shape train.py wrote — no
 *  snake_case/camelCase mapping needed beyond the outer keys. Per-fold
 *  `train_r2`/`train_rmse`/`train_mae` sit beside each fold's own
 *  `r2`/`rmse`/`mae` so overfitting is visible fold-by-fold, not just in
 *  aggregate. */
const CvFoldRecordSchema = z.object({
  fold: z.number().int().positive(),
  cut_timestamp: z.string(),
  train_rows: z.number().int().nonnegative(),
  test_rows: z.number().int().nonnegative(),
  distinct: z.number().int().nonnegative(),
  r2: z.number(),
  rmse: z.number(),
  mae: z.number(),
  train_r2: z.number(),
  train_rmse: z.number(),
  train_mae: z.number(),
});

const RunCvFoldsSchema = z.object({
  algorithm: z.string().min(1),
  n_splits: z.number().int().min(2),
  folds: z.array(CvFoldRecordSchema),
});

export type RunCvFolds = z.infer<typeof RunCvFoldsSchema>;

/**
 * MODEL-FLOW-016-T04/T11. `source_key` is resolved by the caller off the
 * `ModelTrainingRun` row (`cvFoldsKey`) — never accepted from a browser
 * request, same discipline `getRunLossHistory` applies to its own key.
 */
export async function getRunCvFolds(sourceKey: string): Promise<RunCvFolds> {
  const res = await postToPython<unknown>(
    '/v1/preprocess/models/runs/cv-folds',
    { source_key: sourceKey },
    PYTHON_TIMEOUT.metadata,
  );
  return RunCvFoldsSchema.parse(res);
}

/** MODEL-FLOW-019-T09. `importance` is always non-negative — for a
 *  coefficient method it is `abs(coefficient)`, never the signed value, so
 *  ranking and "share of total" stay meaningful; `coefficient` (the signed
 *  value) is present only for "coefficient"/"pls-coefficient". */
const FeatureImportanceEntrySchema = z.object({
  name: z.string().min(1),
  importance: z.number(),
  coefficient: z.number().nullish(),
});

const RunFeatureImportanceSchema = z.object({
  algorithm: z.string().min(1),
  // "impurity" | "coefficient" | "pls-coefficient" — a reader cannot
  // calibrate an unlabelled figure, so this is never optional.
  method: z.string().min(1),
  standardized: z.boolean().nullable(),
  scaling_methods: z.array(z.string()),
  features: z.array(FeatureImportanceEntrySchema),
});

export type RunFeatureImportance = z.infer<typeof RunFeatureImportanceSchema>;

/**
 * MODEL-FLOW-019-T09. `source_key` is resolved by the caller off the
 * `ModelTrainingRun` row (`featureImportanceKey`) — never accepted from a
 * browser request, same discipline `getRunCvFolds` applies to its own key.
 */
export async function getRunFeatureImportance(
  sourceKey: string,
): Promise<RunFeatureImportance> {
  const res = await postToPython<unknown>(
    '/v1/preprocess/models/runs/feature-importance',
    { source_key: sourceKey },
    PYTHON_TIMEOUT.metadata,
  );
  return RunFeatureImportanceSchema.parse(res);
}

/** MODEL-FLOW-023-T10. A SECOND, independent artifact from
 *  `RunFeatureImportance` above — a signed, population-scored drop, never
 *  merged into that always-non-negative fit-internal shape. `importance` is
 *  the CLAMPED value (`max(0, importance_raw)`) a share column can safely
 *  sum; `importance_raw` rides beside it unclamped, same two-fields-not-one
 *  shape a coefficient method uses for its own signed value. `std` is
 *  REQUIRED — a permutation figure never renders without its spread. */
const PermutationFeatureImportanceEntrySchema = z.object({
  name: z.string().min(1),
  importance: z.number(),
  importance_raw: z.number(),
  std: z.number(),
});

const RunPermutationImportanceSchema = z.object({
  algorithm: z.string().min(1),
  // Always "permutation" today — a distinct string from
  // RunFeatureImportance.method's four values.
  method: z.string().min(1),
  // The population this run's drops were scored against, read VERBATIM off
  // the artifact — "test_windows" for lstm/gru today. Never derived
  // downstream from a run's CV/scoring phase (MODEL-FLOW-019 records that
  // exact derivation added and removed five times under different names).
  scored_on: z.string().min(1),
  // MODEL-FLOW-023-T10/AC16. The scored population's own size — a WINDOW
  // count for a sequence run, never assumed to be a row count.
  n: z.number().int().nonnegative(),
  // "rmse", minimised — MODEL-FLOW-005's own reason (a real run scored
  // r2 = -1,110,858 while its rmse stayed readable).
  metric: z.string().min(1),
  n_repeats: z.number().int().positive(),
  baseline_score: z.number(),
  features: z.array(PermutationFeatureImportanceEntrySchema),
});

export type RunPermutationImportance = z.infer<
  typeof RunPermutationImportanceSchema
>;

/**
 * MODEL-FLOW-023-T10. `source_key` is resolved by the caller off the
 * `ModelTrainingRun` row (`permutationImportanceKey`) — same discipline
 * `getRunFeatureImportance` applies to its own key.
 */
export async function getRunPermutationImportance(
  sourceKey: string,
): Promise<RunPermutationImportance> {
  const res = await postToPython<unknown>(
    '/v1/preprocess/models/runs/permutation-importance',
    { source_key: sourceKey },
    PYTHON_TIMEOUT.metadata,
  );
  return RunPermutationImportanceSchema.parse(res);
}

/** MODEL-FLOW-007-T11 / MODEL-SERVE-001-T01. `null` for a run trained before
 *  the trainer image that started recording each field — Save Model and
 *  ModelVersion creation both treat that as "not recorded", never as a
 *  reason to fail. `model_sha256` is nullable for the same reason:
 *  MODEL-SERVE-000-T01 confirmed the field exists on current manifests, but
 *  a run trained before the trainer started writing it has no honest value
 *  to fill in. */
const RunManifestSchema = z.object({
  framework_versions: z.record(z.string(), z.string()).nullable(),
  model_sha256: z.string().nullable().optional(),
  // MODEL-FLOW-016-T07. The exact columns, in the exact order, model.predict
  // expects — no DB column carries this. Null for a run trained before this
  // field was added, same honest-legacy-null policy as the fields above.
  feature_columns: z.array(z.string()).nullable().optional(),
});

export type RunManifestInfo = z.infer<typeof RunManifestSchema>;

/**
 * MODEL-FLOW-007-T11. `sourceKey` is resolved by the caller off the
 * `ModelTrainingRun` row (`manifestKey`), same discipline `getRunLossHistory`
 * applies to its own key. Every other manifest field already has a column on
 * the run row — this exists for `framework_versions` and `model_sha256`,
 * neither of which does (MODEL-SERVE-001-T01 added the second read).
 */
export async function getRunManifest(
  sourceKey: string,
): Promise<RunManifestInfo> {
  const res = await postToPython<unknown>(
    '/v1/preprocess/models/runs/manifest',
    { source_key: sourceKey },
    PYTHON_TIMEOUT.metadata,
  );
  return RunManifestSchema.parse(res);
}

/** MODEL-SERVE-001-T05. `exists: false` implies `checksum: null` — there is
 *  nothing to hash. */
const ModelObjectVerifySchema = z.object({
  exists: z.boolean(),
  checksum: z.string().nullable(),
});

export type ModelObjectVerifyResult = z.infer<typeof ModelObjectVerifySchema>;

/**
 * MODEL-SERVE-001-T05. Called by promote/rollback BEFORE flipping a
 * ModelVersion's stage — deliberately its own endpoint, not
 * `presignArtifact`, which is hard-restricted to committed dataset
 * artifacts and refuses a model.joblib key outright.
 */
export async function verifyModelObject(
  sourceKey: string,
): Promise<ModelObjectVerifyResult> {
  const res = await postToPython<unknown>(
    '/v1/preprocess/models/runs/verify-object',
    { source_key: sourceKey },
    PYTHON_TIMEOUT.metadata,
  );
  return ModelObjectVerifySchema.parse(res);
}

/**
 * MODEL-SERVE-002. `spec` is intentionally loose (`.passthrough()`, every
 * field optional) — `build_feature_spec` writes a versioned document that
 * only WIDENS over time (`FeatureSpecResponse`'s own docstring, DS-LAKE-
 * 025-T06), so a strict schema here would 500 on a legacy sidecar that
 * reads perfectly well. Only the fields the descriptor endpoint actually
 * reads are named; everything else passes through unvalidated.
 */
const FeatureSpecSchema = z
  .object({
    source_key: z.string().min(1),
    feature_spec_key: z.string().min(1),
    spec: z
      .object({
        target_y: z.string().nullable().optional(),
        target_scaled: z.boolean().nullable().optional(),
        scaling: z
          .array(z.object({ tag: z.string(), method: z.string() }))
          .optional(),
        scalingParams: z
          .record(z.string(), z.record(z.string(), z.number()))
          .optional(),
        /**
         * MODEL-SERVE-001-T13. Frozen PSI reference bins, one entry per tag
         * in each — same keying as `scalingParams` above, same "computed
         * once at training time, never re-fit" lifecycle. `psiRefEdges` is
         * RAW engineering units (T13 STEP 4), unlike `scalingParams`, which
         * describes a scaler applied to the model-ready frame. Absent on a
         * spec written before this task (legacy artifact) — read as "no
         * PSI reference", never defaulted to an empty-but-present map that
         * would look like "computed, nothing to report".
         */
        psiRefEdges: z.record(z.string(), z.array(z.number())).optional(),
        psiBinCount: z.record(z.string(), z.number().int()).optional(),
        psiBinMode: z
          .record(z.string(), z.enum(['continuous', 'categorical']))
          .optional(),
        /**
         * MODEL-SERVE-001-T13 correction. The REAL measured reference
         * population per bin — never assumed uniform. A quantile
         * (continuous) split is equal-frequency by construction, but a
         * categorical split is NOT (a valve closed 90% of the time has a
         * 90/10 reference split, not 50/50) — `computePsi`'s expected% term
         * reads this directly rather than deriving it from `psiBinCount`.
         * Same per-tag, per-bin-index keying/ordering as `psiRefEdges`.
         */
        psiRefCounts: z
          .record(z.string(), z.array(z.number().int()))
          .optional(),
        derived_from_target: z.array(z.string()).nullable().optional(),
        /**
         * MODEL-SERVE-002-T06. The recipe itself, passed through to serving
         * so it can compute the required history depth with the SAME code
         * apps/python uses (softsensor_scaling.max_replay_lookback) rather
         * than a TypeScript reimplementation that could drift. Each entry's
         * `config` carries the per-kind fields that determine lookback
         * (`k` for lag, `window` for rolling), so it is kept loose here
         * rather than re-modelled — the authority on its shape is
         * feature_spec_service.build_feature_spec, not this schema.
         */
        features: z
          .array(
            z
              .object({
                name: z.string().optional(),
                kind: z.string().optional(),
                config: z.record(z.string(), z.unknown()).optional(),
              })
              .passthrough(),
          )
          .optional(),
      })
      .passthrough(),
  })
  .passthrough();

export type FeatureSpecResult = z.infer<typeof FeatureSpecSchema>;

/**
 * MODEL-SERVE-002. Reads ONLY feature_spec.json beside a committed
 * artifact — the data object itself is never opened (`artifact_service.
 * feature_spec`, DS-LAKE-025-T06). The descriptor endpoint calls this with
 * `ModelVersion.goldObjectKey` and asserts the returned `feature_spec_key`
 * equals `ModelVersion.featureSpecKey` (verified 0-mismatch across all 73
 * live ModelTrainingRun rows before this call was written) — cheap
 * insurance that the descriptor never re-derives through a different
 * artifact than the one the version actually pins.
 */
export async function readFeatureSpec(
  sourceKey: string,
): Promise<FeatureSpecResult> {
  const res = await postToPython<unknown>(
    '/v1/preprocess/feature-spec',
    { source_key: sourceKey },
    PYTHON_TIMEOUT.serving,
  );
  return FeatureSpecSchema.parse(res);
}

const PredictionLogAppendResultSchema = z.object({
  object_key: z.string().min(1),
  object_checksum: z.string().min(1),
  row_count: z.number().int().nonnegative(),
});

export type PredictionLogAppendResult = z.infer<
  typeof PredictionLogAppendResultSchema
>;

/**
 * MODEL-SERVE-005-T01. Writes one logged request's capped rows as a single
 * Parquet object. `PredictionLogAuthorizedService.ingestPredictionLogService`
 * calls this ONLY when `rows.length > 0` — a 0-row append is refused
 * server-side (schemas/preprocess.py `min_length=1`) and would otherwise
 * surface as an opaque 422 for a case the caller can and does avoid.
 */
export async function appendPredictionLog(input: {
  model_id: string;
  model_version_id: string;
  requested_at: string;
  rows: Array<{ features: Record<string, number>; prediction: number }>;
}): Promise<PredictionLogAppendResult> {
  const res = await postToPython<unknown>(
    '/v1/preprocess/prediction-log/append',
    input,
    PYTHON_TIMEOUT.serving,
  );
  return PredictionLogAppendResultSchema.parse(res);
}

const PredictionLogPointSchema = z.object({
  timestamp: z.string(),
  prediction: z.number(),
  features: z.record(z.string(), z.number()),
});

const PredictionLogSeriesResultSchema = z.object({
  points: z.array(PredictionLogPointSchema),
  truncated: z.boolean(),
});

export type PredictionLogSeriesResult = z.infer<
  typeof PredictionLogSeriesResultSchema
>;

/**
 * MODEL-SERVE-005. Reads every logged row for ONE (modelId, modelVersionId)
 * pair in a time range — scoped to one version because that is how the
 * write side partitions objects (serving_log_prefix). A range spanning a
 * promote calls this once per distinct modelVersionId the caller's own
 * PredictionLog rows name, then merges — see
 * `PredictionLogAuthorizedService.getPredictionSeriesService`.
 */
export async function predictionLogSeries(input: {
  model_id: string;
  model_version_id: string;
  from: string;
  to: string;
}): Promise<PredictionLogSeriesResult> {
  const res = await postToPython<unknown>(
    '/v1/preprocess/prediction-log/series',
    input,
    PYTHON_TIMEOUT.serving,
  );
  return PredictionLogSeriesResultSchema.parse(res);
}

/** Mirrors python's `PreviewCell`/`PreviewRow`, the shape `/v1/preprocess/rows`
 *  already returns to the client for artifact hydration. */
const ArtifactCellSchema = z.object({
  value: z.number(),
  status: z.enum(['Good', 'Bad', 'Questionable']),
});

const ArtifactRowSchema = z.object({
  timestamp: z.string(),
  cells: z.record(z.string(), ArtifactCellSchema),
});

const ArtifactRowsSchema = z.object({
  source_key: z.string(),
  total_row_count: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  rows: z.array(ArtifactRowSchema),
});

export type ArtifactRow = z.infer<typeof ArtifactRowSchema>;
export type ArtifactRowsResult = z.infer<typeof ArtifactRowsSchema>;

/**
 * MODEL-SERVE-008-T02. Read a page of rows out of ANY parquet object by key.
 *
 * `RowsRequest.source_key` is an arbitrary object key, not an artifact id —
 * which is what lets the live-prediction driver read back the `input.parquet`
 * `materializeInferenceWindow` just wrote, instead of teaching NestJS to
 * parse parquet or adding a second python endpoint that would duplicate the
 * feature pipeline. Three EXISTING calls, no new input shape.
 *
 * The rows come back in RAW ENGINEERING UNITS: `inference_window_service`'s
 * own module doc states the frame it writes is never passed through
 * `to_model_ready`, because the container applies the fitted transform — the
 * same boundary MODEL-SERVE-002's /predict and MODEL-SERVE-003's batch path
 * hold. So these values are already pre-scale and go to /predict unaltered;
 * scaling them here would be a fourth opinion about what scaling means.
 */
export async function readArtifactRows(input: {
  source_key: string;
  offset?: number;
  limit?: number;
  tags?: string[];
}): Promise<ArtifactRowsResult> {
  const res = await postToPython<unknown>(
    '/v1/preprocess/rows',
    input,
    // An object-store read, not a source-system fetch — the bounded budget,
    // not `preprocess`'s five minutes.
    PYTHON_TIMEOUT.serving,
  );
  return ArtifactRowsSchema.parse(res);
}
