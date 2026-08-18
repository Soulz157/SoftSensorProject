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

export async function presignModelRunUpload(input: {
  model_id: string;
  run_id: string;
  filenames: string[];
}): Promise<PresignedUpload> {
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
