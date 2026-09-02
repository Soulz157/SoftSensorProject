import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  HyperparametersSchema,
  TrainingAlgorithmEnum,
} from './model-run.authorized.dto';

/**
 * MODEL-FLOW-005, generalized by MODEL-FLOW-013-T03. Originally "fine-tuning"
 * = a hyperparameter search: one algorithm, one artifact, one split, N
 * hyperparameter sets tried in sequence, best kept. `kind` now distinguishes
 * that shape (HYPERPARAMETER_SEARCH — every candidate repeats the same
 * algorithm) from an algorithm sweep (ALGORITHM_SWEEP, "Find Best Model" —
 * each candidate names its own). `algorithm` moved OFF the job root and INTO
 * each candidate so both kinds share one shape; targetY/goldArtifactId/
 * trainTestSplit stay on the job root — varying those would make candidates
 * incomparable.
 */
export const CandidateSchema = z
  .object({
    algorithm: TrainingAlgorithmEnum,
    hyperparameters: HyperparametersSchema,
  })
  .strict();

export const CandidateJobKindEnum = z.enum([
  'HYPERPARAMETER_SEARCH',
  'ALGORITHM_SWEEP',
  'SWEEP_THEN_TUNE',
]);

export const CreateCandidateJobSchema = z
  .object({
    goldArtifactId: z.string().uuid(),
    targetY: z.string().min(1).max(255),
    trainTestSplit: z.coerce.number().min(0.5).max(0.95).optional(),
    kind: CandidateJobKindEnum,

    // At least 1 for HYPERPARAMETER_SEARCH — a single algorithm + its
    // current hyperparameters, expanded server-side into the curated
    // TUNING_GRID variants by createJob (tuning-grid.ts's own grid stays
    // the one place this shortlist is declared, never duplicated
    // client-side). ALGORITHM_SWEEP/SWEEP_THEN_TUNE keep requiring 2 — one
    // candidate there is not a sweep, it is a normal training run
    // (createDraftRunService already exists for that) — enforced by the
    // .refine() below since the bare array bound can no longer say it.
    // Capped well below MIN_LABELLED_ROWS-scale concerns: this is a count
    // of CONTAINER spawns, and an unbounded list would let one request
    // queue an unbounded amount of compute with no review point.
    candidates: z.array(CandidateSchema).min(1).max(20),
  })
  .strict()
  .refine(
    (data) =>
      data.kind === 'HYPERPARAMETER_SEARCH' || data.candidates.length >= 2,
    {
      message:
        'ALGORITHM_SWEEP/SWEEP_THEN_TUNE need at least 2 candidates — one candidate is a normal training run, not a sweep.',
      path: ['candidates'],
    },
  );

export class CreateCandidateJobDto extends createZodDto(
  CreateCandidateJobSchema,
) {}

/**
 * MODEL-FLOW-013-T08. `runId` must be one of the job's own SUCCEEDED
 * candidates and the job must be terminal — both enforced in the service,
 * not here, since they need a DB read. Writes ONLY
 * ModelCandidateJob.selectedRunId; ModelDraft.currentRunId keeps its
 * existing single writer (advanceJobForRun's completion branch),
 * untouched by this route.
 */
export const SelectCandidateSchema = z
  .object({
    runId: z.string().uuid(),
  })
  .strict();

export class SelectCandidateDto extends createZodDto(SelectCandidateSchema) {}
