import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * MODEL-SERVE-032. A compare range. UTC instants only: `datetime()` without
 * `offset: true` accepts the `Z` form and rejects a naive wall-clock string,
 * which would otherwise be read as UTC and shift every point by the plant's
 * +7h. Half-open [from, to).
 */
export const CompareModelEvaluationSchema = z
  .object({
    from: z.string().datetime(),
    to: z.string().datetime(),
  })
  .strict()
  .refine((v) => Date.parse(v.to) > Date.parse(v.from), {
    message: 'to must be after from',
    path: ['to'],
  });

export class CompareModelEvaluationDto extends createZodDto(
  CompareModelEvaluationSchema,
) {}

/**
 * MODEL-SERVE-032. A model's PI output tags. Blank / null clears a slot.
 * The data source is NOT accepted here: it is the model's own production
 * source (its inference schedule), so a caller cannot aim the write at a
 * source the model does not run on.
 */
export const PutWriteBackConfigSchema = z
  .object({
    predictionTag: z.string().trim().max(512).nullable(),
    labTag: z.string().trim().max(512).nullable(),
  })
  .strict();

export class PutWriteBackConfigDto extends createZodDto(
  PutWriteBackConfigSchema,
) {}

/**
 * MODEL-SERVE-032. One write-back batch. UTC `Z` timestamps only (same reason
 * as the compare range). The destination TAG is deliberately absent: it comes
 * from the model's saved config, so a request cannot aim a write anywhere.
 */
export const WriteBackSchema = z
  .object({
    kind: z.enum(['PREDICTION', 'LAB']),
    points: z
      .array(
        z
          .object({
            timestamp: z.string().datetime(),
            value: z.number().finite(),
          })
          .strict(),
      )
      .min(1)
      .max(2000),
    /** The version that produced these predictions (echo of compare's
     *  `modelVersionId`); checked to belong to this model. */
    modelVersionId: z.string().uuid().optional(),
    /** Report what WOULD happen; write nothing, claim nothing. */
    dryRun: z.boolean().optional(),
  })
  .strict();

export class WriteBackDto extends createZodDto(WriteBackSchema) {}

export const WriteBackHistoryQuerySchema = z
  .object({
    kind: z.enum(['PREDICTION', 'LAB', 'ROLLBACK']).optional(),
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export class WriteBackHistoryQueryDto extends createZodDto(
  WriteBackHistoryQuerySchema,
) {}

/**
 * MODEL-SERVE-032. Undo one batch. `force` overrides DRIFT only (PI changed
 * since the write); it never overrides a later overlapping batch. `dryRun`
 * reports what a real call would do and changes nothing.
 */
export const RollbackSchema = z
  .object({
    force: z.boolean().optional(),
    dryRun: z.boolean().optional(),
  })
  .strict();

export class RollbackDto extends createZodDto(RollbackSchema) {}
