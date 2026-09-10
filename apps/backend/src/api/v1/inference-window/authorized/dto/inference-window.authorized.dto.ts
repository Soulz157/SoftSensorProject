import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * MODEL-SERVE-006-T09. Enable/disable + cadence/lag for one model's
 * schedule, plus the wizard's five deploy-step guardrails, adopted under
 * THEIR names (store/model-pipeline.ts's mpAutoRetrainAtom/
 * mpRetrainWarnSdAtom/mpRetrainCriticalSdAtom/mpDriftMonitorAtom/
 * mpDriftThresholdPctAtom) — a parallel vocabulary here would mean the
 * wizard and the scheduler describing one setting two ways.
 *
 * `sourceId` is optional here and required by the SERVICE, not this schema
 * (D8): it is only mandatory when the pinned version's source dataset has
 * more than one `sourceIds` entry, which this DTO cannot see.
 *
 * `warnSd < criticalSd` is checked here ONLY when both arrive in the same
 * request — a partial update sending just one of the pair is re-checked in
 * the SERVICE against the row's final, merged state, since this schema has
 * no view of what is already persisted.
 */
export const PutInferenceScheduleSchema = z
  .object({
    enabled: z.boolean(),
    cadenceMinutes: z.number().int().positive().max(1440).optional(),
    lagMinutes: z.number().int().nonnegative().max(1440).optional(),
    sourceId: z.string().trim().min(1).optional(),
    autoRetrain: z.boolean().optional(),
    warnSd: z.number().positive().optional(),
    criticalSd: z.number().positive().optional(),
    driftMonitor: z.boolean().optional(),
    driftThresholdPct: z.number().positive().max(100).optional(),
  })
  .strict()
  .refine(
    (dto) =>
      dto.warnSd === undefined ||
      dto.criticalSd === undefined ||
      dto.warnSd < dto.criticalSd,
    { message: 'warnSd must be less than criticalSd.' },
  );

export class PutInferenceScheduleDto extends createZodDto(
  PutInferenceScheduleSchema,
) {}

/**
 * MODEL-SERVE-006-T11. A range, not a single window — over-requesting is
 * harmless (T01's unique constraint makes a repeated insert a no-op), so
 * this deliberately does not require the caller to know which windows are
 * already missing.
 */
export const BackfillInferenceWindowsSchema = z
  .object({
    from: z.string().datetime(),
    to: z.string().datetime(),
  })
  .strict()
  .refine((dto) => new Date(dto.to) > new Date(dto.from), {
    message: '`to` must be after `from`.',
  });

export class BackfillInferenceWindowsDto extends createZodDto(
  BackfillInferenceWindowsSchema,
) {}

/** MODEL-SERVE-006. The infer-mode container's own terminal report —
 *  mirrors `PredictionJobCompleteSchema`'s shape one entity over. */
export const InferenceWindowCompleteSchema = z
  .object({
    status: z.enum(['SUCCEEDED', 'FAILED']),
    rowCount: z.number().int().nonnegative().optional(),
    outputChecksum: z.string().min(1).optional(),
    uploaded: z.array(z.string()).max(2).optional(),
    failureReason: z.string().max(2000).optional(),
  })
  .strict()
  .refine(
    (dto) =>
      dto.status !== 'SUCCEEDED' ||
      (dto.rowCount !== undefined && dto.outputChecksum !== undefined),
    {
      message: 'A SUCCEEDED report must include rowCount and outputChecksum.',
    },
  )
  .refine((dto) => dto.status !== 'FAILED' || !!dto.failureReason, {
    message: 'A FAILED report must include failureReason.',
  });

export class InferenceWindowCompleteDto extends createZodDto(
  InferenceWindowCompleteSchema,
) {}

export const InferenceWindowLogSchema = z.object({
  level: z.enum(['info', 'warn', 'error']).default('info'),
  message: z.string().max(4000),
});

export class InferenceWindowLogDto extends createZodDto(
  InferenceWindowLogSchema,
) {}

export const InferenceWindowUploadUrlsSchema = z.object({
  filenames: z.array(z.string()).min(1).max(2),
});

export class InferenceWindowUploadUrlsDto extends createZodDto(
  InferenceWindowUploadUrlsSchema,
) {}
