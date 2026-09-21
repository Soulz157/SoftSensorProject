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
 *
 * MODEL-SERVE-015 AMENDS THIS, IT DOES NOT ABANDON IT. The invariant above
 * was "one basis, therefore one artifact" — that held because nothing ever
 * varied the training artifact. `strategy: 'AUGMENT_DATA'` is the one
 * deliberate exception, and it narrows to: **one EVALUATION basis; the
 * TRAINING artifact may differ.** The candidate still trains on artifact,
 * target and split derived server-side (never from the request) — the ONLY
 * new freedom is which DATASET VERSION gets merged in, and that merge
 * itself is server-orchestrated (`ModelRetrainAugmentAuthorizedService`),
 * never a client-supplied artifact id. The comparison this feature publishes
 * stays meaningful because the candidate is scored on the incumbent's own
 * frozen test rows regardless of what it trained on — see `buildComparison`
 * and `ModelTrainingRun.evalSetKind`'s own comments.
 */
export const RetrainStrategyEnum = z.enum(['KEEP_EXISTING', 'AUGMENT_DATA']);

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

    // MODEL-SERVE-015-T01. Defaults to the 014 behavior — every existing
    // caller (no field sent) is unaffected. `AUGMENT_DATA` requires
    // `additionalDatasetVersionId`; the reverse is also enforced below so a
    // caller cannot send one without the other and get silently ignored.
    strategy: RetrainStrategyEnum.optional().default('KEEP_EXISTING'),

    // The operator-selected DatasetVersion to merge with the incumbent's own
    // training data. A DatasetVersion id, not an artifact id — the same
    // "name a version, let the server resolve its committed artifact"
    // discipline the rest of this DTO already applies to the incumbent's
    // own artifact.
    additionalDatasetVersionId: z.string().uuid().optional(),
  })
  .strict()
  .refine(
    (body) =>
      body.strategy !== 'AUGMENT_DATA' || !!body.additionalDatasetVersionId,
    {
      message: "strategy 'AUGMENT_DATA' requires additionalDatasetVersionId.",
      path: ['additionalDatasetVersionId'],
    },
  )
  .refine(
    (body) =>
      body.strategy === 'AUGMENT_DATA' || !body.additionalDatasetVersionId,
    {
      message:
        "additionalDatasetVersionId requires strategy: 'AUGMENT_DATA' — " +
        'omit one or the other.',
      path: ['additionalDatasetVersionId'],
    },
  );

export class TriggerRetrainDto extends createZodDto(TriggerRetrainSchema) {}
