import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * Contracts for MODEL-FLOW-011's admin-triggered ModelDraft reclaim sweep.
 * Same shape as `artifact-cleanup.admin.dto.ts` — two entities, one pattern.
 */

export const RunModelDraftCleanupSchema = z.object({
  /**
   * Defaults to true. The API boundary defaults to dry so the first live run
   * against real MinIO is an explicit opt-in, never an accidental one.
   */
  dryRun: z.boolean().default(true),
});

export class RunModelDraftCleanupDto extends createZodDto(
  RunModelDraftCleanupSchema,
) {}

/**
 * apps/python `schemas.preprocess.DraftRunReclaimResponse`. Same `{prefix,
 * deleted}` shape as `PythonArtifactReclaimSchema` — kept as a separate
 * schema so this module has no cross-module DTO import for two fields.
 */
export const PythonDraftRunReclaimSchema = z.object({
  prefix: z.string(),
  deleted: z.number().int().nonnegative(),
});
