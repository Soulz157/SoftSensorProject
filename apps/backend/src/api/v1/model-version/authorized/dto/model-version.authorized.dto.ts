import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * MODEL-SERVE-001-T06. Present only when a promote crosses the r2<=0 floor.
 * `reason` is required and non-empty — an override that left no trace would
 * be the same as no floor (the task's own words). `actorId`/`actorName`/`at`
 * are filled server-side from the authenticated caller, never trusted from
 * the request body.
 */
export const PromoteOverrideSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export const PromoteVersionSchema = z.object({
  override: PromoteOverrideSchema.optional(),
});

export const RollbackModelSchema = z.object({
  override: PromoteOverrideSchema.optional(),
});

/**
 * Label for a STAGING version. Trimmed; an empty string or null clears it
 * back to the bare `v{version}`.
 */
export const RenameVersionSchema = z.object({
  name: z.string().trim().max(100).nullable(),
});

export class PromoteVersionDto extends createZodDto(PromoteVersionSchema) {}
export class RenameVersionDto extends createZodDto(RenameVersionSchema) {}
export class RollbackModelDto extends createZodDto(RollbackModelSchema) {}
