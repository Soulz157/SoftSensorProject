import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  HyperparametersSchema,
  TrainingAlgorithmEnum,
} from './model-run.authorized.dto';

/**
 * MODEL-FLOW-005. "Fine-tuning" = a hyperparameter search: one algorithm, one
 * artifact, one split, N hyperparameter sets tried in sequence, best kept.
 * Deliberately NOT a nested object per set with its own algorithm/split — the
 * decision (decisions.fine_tuning_undefined) fixes those, only the
 * hyperparameters vary between sets.
 */
export const CreateFineTuningJobSchema = z
  .object({
    goldArtifactId: z.string().uuid(),
    targetY: z.string().min(1).max(255),
    algorithm: TrainingAlgorithmEnum,
    trainTestSplit: z.coerce.number().min(0.5).max(0.95).optional(),

    // At least 2 — one set is not a search, it is a normal training run
    // (createDraftRunService already exists for that). Capped well below
    // MIN_LABELLED_ROWS-scale concerns: this is a count of CONTAINER spawns,
    // and an unbounded list would let one request queue an unbounded amount
    // of compute with no review point.
    hyperparameterSets: z.array(HyperparametersSchema).min(2).max(20),
  })
  .strict();

export class CreateFineTuningJobDto extends createZodDto(
  CreateFineTuningJobSchema,
) {}
