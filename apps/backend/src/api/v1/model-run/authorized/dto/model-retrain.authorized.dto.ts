import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { CandidateSchema } from './model-candidate-job.authorized.dto';

/**
 * MODEL-SERVE-004-T02. The retrain trigger's whole body — and it is
 * deliberately almost empty.
 *
 * Everything that decides WHAT is retrained (artifact, target, split,
 * algorithm, starting hyperparameters) is read server-side off the incumbent
 * PRODUCTION version and its source run, never accepted from the request:
 * the comparison this feature has to publish (T05) is only meaningful when
 * the candidate and the incumbent share one evaluation basis, and a body
 * that could name a different artifact or target would silently break that.
 *
 * `candidates` is the one optional override — an operator who wants to try
 * specific hyperparameter sets instead of the curated TUNING_GRID shortlist
 * can name them. They still run against the incumbent's artifact/target/
 * split, so the basis holds either way.
 */
export const TriggerRetrainSchema = z
  .object({
    // Opt-in, exactly like PredictionJob's. The per-model live lock is what
    // stops three concurrent triggers becoming three containers; this key is
    // what makes a retry after a dropped response return the ORIGINAL job
    // rather than starting a second search once the first has finished.
    idempotencyKey: z.string().min(1).max(200).optional(),

    // Same bound and same reasoning as CreateCandidateJobSchema's: this is a
    // count of CONTAINER spawns, and an unbounded list would let one request
    // queue an unbounded amount of compute with no review point. Omitted =
    // derived from the incumbent (the normal path).
    candidates: z.array(CandidateSchema).min(1).max(20).optional(),
  })
  .strict();

export class TriggerRetrainDto extends createZodDto(TriggerRetrainSchema) {}
