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
export const RetrainStrategyEnum = z.enum([
  'KEEP_EXISTING',
  'AUGMENT_DATA',
  // MODEL-SERVE-017. Train on the newly selected data ALONE, leaving the
  // incumbent's own training rows out. This overturns the recorded decision
  // `retrain_is_blocked_on_the_same_definition_as_fine_tuning` ("not a
  // retrain on different/widened data"), at the user's explicit request on
  // 2026-09-23.
  //
  // MODEL-SERVE-021 REVERSES how it stays comparable. It used to be scored
  // on the incumbent's own frozen test rows, which is why the new dataset
  // had to start strictly after the incumbent's cut timestamp — the same
  // rule AUGMENT_DATA still follows. This strategy now REPLACES the
  // training data outright: the new dataset may overlap the incumbent's own
  // data freely (an operator's real request — the new dataset covers the
  // SAME period the incumbent trained on). Comparability instead comes from
  // scoring BOTH the candidate and the incumbent's own saved model on the
  // SAME operator-defined validation window (in the training container —
  // see `claim()`'s own comment), which is why `newValidationFrom/To` is now
  // REQUIRED for this strategy (enforced below) rather than optional, and
  // why the window must start on/after the incumbent's own cut timestamp
  // (python's own check, since only it can see the real data) — never
  // before it, or the incumbent would be "tested" on rows it trained on.
  'NEW_DATA_ONLY',
]);

/**
 * The strategies that carry an `additionalDatasetVersionId`. Both the DTO's
 * refinements and the service branch on this rather than naming
 * `AUGMENT_DATA` directly, so a fourth strategy cannot half-land.
 */
export const NEW_DATA_STRATEGIES = ['AUGMENT_DATA', 'NEW_DATA_ONLY'] as const;

export function usesNewData(
  strategy: string | null | undefined,
): strategy is (typeof NEW_DATA_STRATEGIES)[number] {
  return (NEW_DATA_STRATEGIES as readonly string[]).includes(strategy ?? '');
}

/** MODEL-SERVE-026-T07. One retrain acceptance criterion — the client
 *  engine's 'retrain' scope (lib/acceptance-criteria.ts), re-validated here
 *  with the SAME rules so a hand-built request cannot store a comparison the
 *  picker would refuse: both operands on the shared window; not the same
 *  figure twice; same units (R² never meets an error); and not a pair that is
 *  algebraically one-way within one version (RMSE vs its own MAE or error
 *  SD). `target-sd` (SD of the lab values) belongs to the window, not a
 *  version. No field carries a typed number. Change both copies together. */
const RetrainOperandSchema = z
  .object({
    metric: z.enum(['rmse', 'mae', 'r2', 'residual-sd', 'target-sd']),
    subject: z.enum(['candidate', 'current', 'window']),
    population: z.enum(['shared-window', 'own-test']),
  })
  .strict()
  .refine((o) => (o.metric === 'target-sd') === (o.subject === 'window'), {
    message:
      'SD of lab values belongs to the window; every other figure to a version.',
  });

type RetrainOperandInput = z.infer<typeof RetrainOperandSchema>;

const ONE_WAY: ReadonlyArray<readonly [string, string]> = [
  ['rmse', 'mae'],
  ['rmse', 'residual-sd'],
];

export function isOfferableRetrainPair(
  a: RetrainOperandInput,
  b: RetrainOperandInput,
): boolean {
  if (a.population !== 'shared-window' || b.population !== 'shared-window')
    return false;
  if (a.metric === b.metric && a.subject === b.subject) return false;
  if ((a.metric === 'r2') !== (b.metric === 'r2')) return false;
  if (
    a.subject === b.subject &&
    ONE_WAY.some(
      ([x, y]) =>
        (a.metric === x && b.metric === y) ||
        (a.metric === y && b.metric === x),
    )
  )
    return false;
  return true;
}

export const RetrainCriterionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('retrain-comparison'),
      left: RetrainOperandSchema,
      operator: z.enum(['lt', 'gt']),
      right: RetrainOperandSchema,
    })
    .strict()
    .refine((c) => isOfferableRetrainPair(c.left, c.right), {
      message:
        'This comparison is not offered: both sides must be on the shared ' +
        'validation window, in the same units, and able to come out either way.',
    }),
  z.object({ kind: z.literal('retrain-r2-floor') }).strict(),
]);

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

    // MODEL-SERVE-019. REQUIRED, no default — this REVISES 015-T01's own
    // comment, which defaulted an omitted field to 'KEEP_EXISTING' so every
    // pre-015 caller kept working unchanged. The user asked to remove that
    // path: a retrain now always ingests new data. `'KEEP_EXISTING'` stays
    // IN THE ENUM (never deleted — historical jobs/versions still store it,
    // and `usesNewData`/comparison reads must keep recognizing it) but the
    // trigger service (`triggerRetrainService`) refuses a NEW request that
    // names it, AFTER the idempotency replay lookup — a retry of an old
    // KEEP_EXISTING job by its idempotencyKey must still return that job,
    // not a 422 for a strategy nobody chose on this call.
    strategy: RetrainStrategyEnum,

    // The operator-selected DatasetVersion to merge with the incumbent's own
    // training data. A DatasetVersion id, not an artifact id — the same
    // "name a version, let the server resolve its committed artifact"
    // discipline the rest of this DTO already applies to the incumbent's
    // own artifact.
    additionalDatasetVersionId: z.string().uuid().optional(),
    // The operator's NEW-DATA validation window: a slice of the newly
    // merged dataset held out of training and scored separately, so the
    // retrain can report how the candidate does on the NEW data rather
    // than only on the incumbent's old frozen rows.
    //
    // Bounds are NOT range-checked here. Only python, which loads the
    // frame, can tell whether they fall inside the new dataset's real
    // first/last timestamps — the same division of labour the existing
    // `cut_timestamp`/`new_start` checks already follow. This layer
    // enforces only what it can actually know: well-formed dates, both or
    // neither, and only on a strategy that has new data to cut.
    newValidationFrom: z.string().datetime().optional(),
    newValidationTo: z.string().datetime().optional(),

    // Custom Finetune's own train/test ratio. Omitted = the current
    // version's ratio, reused verbatim (the normal path). Safe to change on
    // both new-data strategies: neither compares on this split —
    // AUGMENT_DATA scores the candidate on the current version's FROZEN test
    // rows and NEW_DATA_ONLY on the shared validation window — and only the
    // retired KEEP_EXISTING basis checked split equality. Same bounds as
    // CreateCandidateJobSchema's.
    trainTestSplit: z.number().min(0.5).max(0.95).optional(),

    // MODEL-SERVE-026-T05. Expanding folds for the CV-GAP measurement: each
    // candidate also refits its configuration per fold and is scored beside
    // the current version, so the gap between the two gets a fold spread. A
    // measurement only — candidates still rank on their own test RMSE.
    // 2..10 mirrors CreateTrainingRunDto's nSplits bounds; the REAL ceiling
    // is data-dependent (distinct labelled values // 10) and is checked
    // against the combined artifact in the trigger, before any job exists.
    cvFolds: z.number().int().min(2).max(10).optional(),

    // MODEL-SERVE-026-T06. Custom Finetune also refits the current
    // version's own configuration on the new data ("B") unless this is
    // false — one more fit, so a change can be attributed to the data or to
    // the settings. Auto Finetune always includes B; ignored there.
    refitCurrentSettings: z.boolean().optional(),

    // MODEL-SERVE-026-T07. The acceptance criteria the operator chose
    // before starting — a verdict the Retrain tab states, never a gate.
    // Shapes mirror the client engine's 'retrain' scope
    // (lib/acceptance-criteria.ts); the refine below re-checks its rule
    // server-side so a hand-built request cannot store a cross-population
    // comparison. No numeric threshold field exists to send.
    acceptanceCriteria: z.array(RetrainCriterionSchema).max(10).optional(),
  })
  .strict()
  .refine((body) => !body.cvFolds || body.strategy === 'NEW_DATA_ONLY', {
    // AUGMENT_DATA trains mostly on the current version's OWN training rows
    // (base_train), so a fold gap there would score the current version on
    // data it fitted — invalid by construction, not merely unsupported.
    message:
      "cvFolds requires strategy 'NEW_DATA_ONLY' — under 'AUGMENT_DATA' " +
      "most training rows are the current version's own, so the current " +
      'version cannot be scored fairly on those folds.',
    path: ['cvFolds'],
  })
  .refine(
    (body) =>
      (body.newValidationFrom === undefined) ===
      (body.newValidationTo === undefined),
    {
      message:
        'newValidationFrom and newValidationTo must be supplied together.',
      path: ['newValidationTo'],
    },
  )
  .refine((body) => usesNewData(body.strategy) || !body.newValidationFrom, {
    message:
      'A new-data validation window requires a strategy that ingests new ' +
      "data ('AUGMENT_DATA' or 'NEW_DATA_ONLY').",
    path: ['newValidationFrom'],
  })
  .refine(
    (body) => body.strategy !== 'NEW_DATA_ONLY' || !!body.newValidationFrom,
    {
      // MODEL-SERVE-021-D02. Unlike AUGMENT_DATA, where the window is
      // optional (the frozen-slice comparison still works without one),
      // NEW_DATA_ONLY carves no frozen slice at all any more — a window is
      // the ONLY basis left for comparing the two versions.
      message:
        "strategy 'NEW_DATA_ONLY' requires newValidationFrom/newValidationTo " +
        '— it replaces the training data outright, so the current and new ' +
        'versions are compared on this window instead of a frozen slice.',
      path: ['newValidationFrom'],
    },
  )
  .refine(
    (body) => !usesNewData(body.strategy) || !!body.additionalDatasetVersionId,
    {
      message:
        "strategy 'AUGMENT_DATA' and 'NEW_DATA_ONLY' require " +
        'additionalDatasetVersionId.',
      path: ['additionalDatasetVersionId'],
    },
  )
  .refine(
    (body) => usesNewData(body.strategy) || !body.additionalDatasetVersionId,
    {
      message:
        "additionalDatasetVersionId requires strategy: 'AUGMENT_DATA' or " +
        "'NEW_DATA_ONLY' — omit one or the other.",
      path: ['additionalDatasetVersionId'],
    },
  );

export class TriggerRetrainDto extends createZodDto(TriggerRetrainSchema) {}
