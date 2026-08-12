import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * Contracts for DS-LAKE-009B's admin-triggered intermediate-artifact cleanup.
 */

export const RunArtifactCleanupSchema = z.object({
  /**
   * Defaults to true. The API boundary defaults to dry so the first live run
   * against real MinIO is an explicit opt-in, never an accidental one.
   */
  dryRun: z.boolean().default(true),
});

export class RunArtifactCleanupDto extends createZodDto(
  RunArtifactCleanupSchema,
) {}

/**
 * apps/python `schemas.preprocess.ArtifactReclaimResponse`. Same shape as
 * `dataset-version`'s `PythonCleanupSchema` — both endpoints return
 * `{prefix, deleted}` — kept as a separate schema so this module has no
 * cross-module DTO import for two fields.
 */
export const PythonArtifactReclaimSchema = z.object({
  prefix: z.string(),
  deleted: z.number().int().nonnegative(),
});
