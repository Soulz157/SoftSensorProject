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
