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
