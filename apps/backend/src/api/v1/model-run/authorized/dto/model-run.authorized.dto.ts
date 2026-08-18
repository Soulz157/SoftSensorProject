import { createZodDto } from 'nestjs-zod';
import { RUN_UPLOAD_FILENAMES } from '@/lib/artifact-keys';

import { z } from 'zod';

const JsonScalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const MetricsSchema = z.record(z.string(), JsonScalar);

export const TrainingAlgorithmEnum = z.enum([
  'ols',
  'ridge',
  'hgb',
  'hist_gradient_boosting',
]);

export const RunStatusEnum = z.enum([
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELED',
]);

export const HyperparametersSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);

export const CreateModelRunSchema = z.object({
  datasetId: z.string().uuid(),
  targetY: z.string().min(1),
  algorithm: z.enum(['hgb', 'hist_gradient_boosting', 'ridge', 'ols']),
  hyperparameters: z.record(z.string(), z.unknown()).default({}),
  // A FRACTION, not a percentage. `chronological_split` multiplies by
  // len(frame) directly — passing 80 would slice at 80x the row count and
  // raise "leaves one side empty" with a number nobody can trace back to a
  // UI slider. The client converts; this refuses anything outside the range
  // so a future caller cannot reintroduce the confusion.
  splitRatio: z.number().gt(0.5).lt(0.95).default(0.8),
  seed: z.number().int().default(42),
});

export const CreateTrainingRunSchema = z
  .object({
    goldArtifactId: z.string().uuid(),

    targetY: z.string().min(1).max(255),

    algorithm: TrainingAlgorithmEnum,
    hyperparameters: HyperparametersSchema.optional(),

    trainTestSplit: z.coerce.number().min(0.5).max(0.95).optional(),

    seed: z.coerce.number().int().min(1).max(2147483646).optional(),
  })
  .strict();

export const ListRunsQuerySchema = z
  .object({
    status: RunStatusEnum.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    before: z.coerce.date().optional(),
  })
  .strict();

export const RunUploadFilenameEnum = z.enum(
  RUN_UPLOAD_FILENAMES as unknown as [string, ...string[]],
);

export const RunLogSchema = z
  .object({
    /** Wider than AppendLogSchema's — train.py emits debug lines too. */
    level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    /**
     * 4000, not AppendLogSchema's 500: a leakage refusal or a checksum
     * mismatch message carries column lists and two full hashes. Still
     * capped — a run posts thousands of lines into a table with no retention
     * policy.
     */
    message: z.string().min(1).max(4000),
  })
  .strict();

export const RunUploadUrlsSchema = z
  .object({
    /**
     * Which run outputs to mint write URLs for. The model/run ids are NOT
     * accepted here: the service reads them off the run row, so a container
     * cannot choose whose prefix it writes to.
     */
    filenames: z
      .array(RunUploadFilenameEnum)
      .min(1)
      .max(RUN_UPLOAD_FILENAMES.length),
  })
  .strict();

export const RunCompleteSchema = z
  .object({
    status: z.enum(['SUCCEEDED', 'FAILED']),
    failureReason: z.string().max(2000).optional(),

    metrics: MetricsSchema.optional(),

    splitSpec: z
      .object({
        method: z.literal('chronological'),
        ratio: z.number(),
        cut_timestamp: z.string(),
        train_rows: z.number().int().nonnegative(),
        test_rows: z.number().int().nonnegative(),
        source_rows: z.number().int().nonnegative(),
        labelled_rows: z.number().int().nonnegative(),
      })
      .optional(),

    uploaded: z.array(RunUploadFilenameEnum).optional(),
  })
  .refine(
    (v) =>
      v.status !== 'SUCCEEDED' || (v.uploaded ?? []).includes('model.joblib'),
    {
      message: 'A SUCCEEDED run must report model.joblib among its uploads.',
      path: ['uploaded'],
    },
  )
  .refine((v) => v.status !== 'FAILED' || Boolean(v.failureReason), {
    message: 'A FAILED run must carry a failureReason.',
    path: ['failureReason'],
  })
  .strict();

export class RunLogDto extends createZodDto(RunLogSchema) {}
export class RunUploadUrlsDto extends createZodDto(RunUploadUrlsSchema) {}
export class RunCompleteDto extends createZodDto(RunCompleteSchema) {}

export class CreateTrainingRunDto extends createZodDto(
  CreateTrainingRunSchema,
) {}
export class CreateModelRunDto extends createZodDto(CreateModelRunSchema) {}
export class ListRunsQueryDto extends createZodDto(ListRunsQuerySchema) {}
