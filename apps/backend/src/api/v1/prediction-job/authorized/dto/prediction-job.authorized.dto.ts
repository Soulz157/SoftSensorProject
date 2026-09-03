import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * MODEL-SERVE-003-T02. `idempotencyKey` is optional, not required — a
 * caller submits it deliberately to make a retry safe; a caller that
 * never retries is not forced to invent one (see
 * decisions.batch_input_is_pre_scale's sibling reasoning on the input
 * contract: opt-in behaviour, never an assumed one). In the DTO body, not
 * a header — @Headers is used in ZERO other backend files (see the
 * delta-re-audit finding), so a header here would be the first and only
 * instance of that pattern.
 */
export const SubmitPredictionJobSchema = z.object({
  inputKey: z.string().trim().min(1),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
});

export class SubmitPredictionJobDto extends createZodDto(
  SubmitPredictionJobSchema,
) {}

/** MODEL-SERVE-003. The container's own report — mirrors
 *  `ScoreCompleteSchema`'s shape one entity over. */
export const PredictionJobCompleteSchema = z
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

export class PredictionJobCompleteDto extends createZodDto(
  PredictionJobCompleteSchema,
) {}

export const PredictionJobLogSchema = z.object({
  level: z.enum(['info', 'warn', 'error']).default('info'),
  message: z.string().max(4000),
});

export class PredictionJobLogDto extends createZodDto(PredictionJobLogSchema) {}

export const PredictionJobUploadUrlsSchema = z.object({
  filenames: z.array(z.string()).min(1).max(2),
});

export class PredictionJobUploadUrlsDto extends createZodDto(
  PredictionJobUploadUrlsSchema,
) {}
