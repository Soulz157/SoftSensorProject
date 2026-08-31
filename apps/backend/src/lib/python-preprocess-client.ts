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

/** MODEL-FLOW-007-T11. `null` for a run trained before the trainer image that
 *  started recording this — Save Model treats that as "not recorded", never
 *  as a reason to fail the save. */
const RunManifestSchema = z.object({
  framework_versions: z.record(z.string(), z.string()).nullable(),
});

export type RunManifestInfo = z.infer<typeof RunManifestSchema>;

/**
 * MODEL-FLOW-007-T11. `sourceKey` is resolved by the caller off the
 * `ModelTrainingRun` row (`manifestKey`), same discipline `getRunLossHistory`
 * applies to its own key. Every other manifest field already has a column on
 * the run row — this exists only for `framework_versions`, which does not.
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
