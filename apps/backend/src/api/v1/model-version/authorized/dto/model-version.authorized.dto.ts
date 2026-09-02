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

export class PromoteVersionDto extends createZodDto(PromoteVersionSchema) {}
export class RollbackModelDto extends createZodDto(RollbackModelSchema) {}
