import { createZodDto } from 'nestjs-zod';
import { RUN_UPLOAD_FILENAMES } from '@/lib/artifact-keys';

import { z } from 'zod';

const JsonScalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const MetricsSchema = z.record(z.string(), JsonScalar);

// MODEL-FLOW-009-T04. All 12 runnable algorithms: build_model
// (images/trainer/train.py) has a branch for each, including lstm/gru now
// that the windowing pipeline (build_windows/chronological_split_windows/
// assert_no_window_leakage), the torch runtime, and SequenceRegressor
// (sequence_model.py) all exist in the trainer image. The wizard's
// AlgorithmSelector no longer disables either.
export const TrainingAlgorithmEnum = z.enum([
  'ols',
  'ridge',
  'hist_gradient_boosting',
  'svm',
  'mlp',
  'grp',
  'pls',
  'random_forest',
  'lightgbm',
  'xgboost',
  'lstm',
  'gru',
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
  // Was a second inline copy of the same enum — the exact drift this task
  // exists to fix. Point at the one definition instead of a second list
  // someone has to remember to update in step.
  algorithm: TrainingAlgorithmEnum,
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

    // MODEL-FLOW-014-T06. The tags the Split Distribution panel was
    // showing at Start Training — sent so the frozen `splitStats` sidecar
    // (ModelTrainingRun.splitStats) can match what the user actually saw,
    // not an approximation. Optional: omitted, `launchDraftRun` freezes
    // against `[targetY]` alone. `.strict()` above means this field MUST
    // exist here before a caller can send it — added deliberately, not
    // discovered by a 400 the day the client starts including it.
    splitStatsTags: z.array(z.string()).max(20).optional(),

    /**
     * MODEL-FLOW-016-T03/T07. Present => this run is a CROSS-VALIDATION
     * run: k expanding time-ordered folds plus a refit, instead of one
     * chronological train/test cut. Bounds match
     * `CvExpandingSplitSpecSchema.n_splits` exactly (2-10) — the two are
     * the same number at opposite ends of the run's life (request here,
     * container's own `/complete` report there), and a mismatch would let
     * a run launch at a k its own completion callback then rejects.
     *
     * NOT persisted on ModelDraft (that model has no column for it and
     * this feature's acceptance criteria forbid adding one) — CV config
     * is client-only until Start Training commits it into the run's own
     * `splitSpec`, which is the durable record.
     */
    nSplits: z.coerce.number().int().min(2).max(10).optional(),
  })
  .strict()
  .refine((v) => !(v.nSplits !== undefined && v.trainTestSplit !== undefined), {
    message:
      'trainTestSplit and nSplits are mutually exclusive — a cross-validation ' +
      'run has k fold cuts, not one train/test ratio.',
    path: ['nSplits'],
  });

export const ListRunsQuerySchema = z
  .object({
    status: RunStatusEnum.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    before: z.coerce.date().optional(),
  })
  .strict();

// MODEL-FLOW-017-T03. 24, not 20: CreateCandidateJobSchema
// (dto/model-candidate-job.authorized.dto.ts) caps a submitted set at 20,
// but SWEEP_THEN_TUNE appends a phase-2 group to the SAME candidates array
// once phase 1 exhausts, bounded by TUNE_VARIANTS_PER_JOB=4
// (lib/tuning-grid.ts) — 24 is the real ceiling a caller can present.
export const MAX_PREDICTION_BATCH_RUN_IDS = 24;

export const RunPredictionsBatchQuerySchema = z
  .object({
    // Comma-separated, not a repeated query key — same "no `qs` parser
    // registered" reasoning ListRowsSchema.tags already documents.
    runIds: z
      .string()
      .min(1)
      .transform((v) => v.split(',').filter(Boolean))
      .pipe(
        z.array(z.string().uuid()).min(1).max(MAX_PREDICTION_BATCH_RUN_IDS),
      ),
  })
  .strict();

export const RunUploadFilenameEnum = z.enum(
  RUN_UPLOAD_FILENAMES as unknown as [string, ...string[]],
);

const ChronologicalSplitSpecSchema = z
  .object({
    method: z.literal('chronological'),
    ratio: z.number(),
    cut_timestamp: z.string(),
    train_rows: z.number().int().nonnegative(),
    test_rows: z.number().int().nonnegative(),
    source_rows: z.number().int().nonnegative(),
    labelled_rows: z.number().int().nonnegative(),
  })
  .strict();

// MODEL-FLOW-009-T04. lstm/gru's windowed split_spec — train.py's own
// split_spec comment states train_rows/test_rows/labelled_rows here are
// WINDOW counts, not row counts, unlike the tabular variant above.
// sequence_length is the one field this variant adds; every other field
// name matches so a caller reading .ratio/.cut_timestamp does not need to
// discriminate first.
const ChronologicalWindowedSplitSpecSchema = z
  .object({
    method: z.literal('chronological_windowed'),
    ratio: z.number(),
    cut_timestamp: z.string(),
    sequence_length: z.number().int().positive(),
    train_rows: z.number().int().nonnegative(),
    test_rows: z.number().int().nonnegative(),
    source_rows: z.number().int().nonnegative(),
    labelled_rows: z.number().int().nonnegative(),
  })
  .strict();

// MODEL-FLOW-016-T03 (finding 7). A CV run's own splitSpec — k cut points,
// not one. Deliberately LIGHTWEIGHT: fold cut/row counts only, no
// r2/rmse/mae — those live in cv_folds.json, a separate object-storage
// artifact (T04), never duplicated into this DB-stored column. `.strict()`
// like every sibling variant: MODEL-FLOW-009-T04's windowed variant was
// found one review short of 400ing a successful run's own /complete call
// for the exact reason this union exists — a caller sending a shape this
// schema does not know about must be refused, not silently accepted.
const CvExpandingFoldSchema = z
  .object({
    cut_timestamp: z.string(),
    train_rows: z.number().int().nonnegative(),
    test_rows: z.number().int().nonnegative(),
  })
  .strict();

const CvExpandingSplitSpecSchema = z
  .object({
    method: z.literal('cv_expanding'),
    n_splits: z.number().int().min(2).max(10),
    source_rows: z.number().int().nonnegative(),
    labelled_rows: z.number().int().nonnegative(),
    distinct_labelled_values: z.number().int().nonnegative(),
    folds: z.array(CvExpandingFoldSchema),
  })
  .strict();

export const SplitSpecSchema = z.discriminatedUnion('method', [
  ChronologicalSplitSpecSchema,
  ChronologicalWindowedSplitSpecSchema,
  CvExpandingSplitSpecSchema,
]);

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

    // DS-LAKE-018-T05. Same shape as `metrics`, scored on the replayed raw
    // validation holdout instead of the chronological test split. A
    // SEPARATE field, never merged into `metrics` — the report must keep a
    // test score and a holdout score visibly distinct, not blend them into
    // one number. Absent whenever the dataset has no holdout, or claim()'s
    // own replay failed — both leave training itself unaffected.
    holdoutMetrics: MetricsSchema.optional(),

    splitSpec: SplitSpecSchema.optional(),

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

/**
 * MODEL-FLOW-016-T07. The scoring container's own `/score-complete` — a
 * DELIBERATELY narrower sibling of `RunCompleteSchema`, not a reuse of it:
 * scoring writes ONLY `predictionsKey` + `holdoutMetrics` (see
 * `model-run-score.authorized.service.ts`'s doc comment) and must never
 * carry `metrics`/`splitSpec`/`modelKey`-shaped fields that would let a
 * scoring callback overwrite a training run's own recorded outcome.
 */
export const ScoreCompleteSchema = z
  .object({
    status: z.enum(['SUCCEEDED', 'FAILED']),
    failureReason: z.string().max(2000).optional(),
    holdoutMetrics: MetricsSchema.optional(),
    // Deliberately a LITERAL, not the full RunUploadFilenameEnum a scoring
    // container could otherwise claim to have uploaded — scoring ever
    // writes exactly one file. The service's own upload-URL minting
    // (scoreUploadUrlsService) enforces the same allowlist independently,
    // so a divergence here would only ever be caught here, not there.
    uploaded: z.array(z.literal('predictions.parquet')).max(1).optional(),
  })
  .refine(
    (v) =>
      v.status !== 'SUCCEEDED' ||
      (v.uploaded ?? []).includes('predictions.parquet'),
    {
      message:
        'A SUCCEEDED score must report predictions.parquet among its uploads.',
      path: ['uploaded'],
    },
  )
  .refine((v) => v.status !== 'SUCCEEDED' || v.holdoutMetrics !== undefined, {
    message: 'A SUCCEEDED score must report holdoutMetrics.',
    path: ['holdoutMetrics'],
  })
  .refine((v) => v.status !== 'FAILED' || Boolean(v.failureReason), {
    message: 'A FAILED score must carry a failureReason.',
    path: ['failureReason'],
  })
  .strict();

export class RunLogDto extends createZodDto(RunLogSchema) {}
export class RunUploadUrlsDto extends createZodDto(RunUploadUrlsSchema) {}
export class RunCompleteDto extends createZodDto(RunCompleteSchema) {}
export class ScoreCompleteDto extends createZodDto(ScoreCompleteSchema) {}

export class CreateTrainingRunDto extends createZodDto(
  CreateTrainingRunSchema,
) {}
export class CreateModelRunDto extends createZodDto(CreateModelRunSchema) {}
export class ListRunsQueryDto extends createZodDto(ListRunsQuerySchema) {}
export class RunPredictionsBatchQueryDto extends createZodDto(
  RunPredictionsBatchQuerySchema,
) {}
