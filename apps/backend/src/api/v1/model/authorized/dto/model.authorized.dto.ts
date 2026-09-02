import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { HyperparametersSchema } from '@/api/v1/model-run/authorized/dto/model-run.authorized.dto';

export const DeployStatusEnum = z.enum([
  'stopped',
  'running',
  'error',
  'initializing',
]);
export const ProdStatusEnum = z.enum([
  'normal',
  'warning',
  'alert',
  'offline',
  'frozen',
]);

/**
 * MODEL-FLOW-006. Retrain/drift-monitoring settings — collected nowhere yet
 * (Phase4Deploy's own docblock: "nothing persists them, so rendering them
 * would collect settings that go nowhere") and confirmed empirically absent
 * from every one of the 16 rows in the live dev DB. Declared here anyway so
 * a future write path has somewhere to land without a second schema pass;
 * MODEL-FLOW-007 decides whether to wire the UI or delete this and its five
 * client atoms instead of leaving a field that only ever reads its default.
 */
export const DeploymentConfigSchema = z
  .object({
    autoRetrain: z.boolean().optional(),
    warnSd: z.number().optional(),
    criticalSd: z.number().optional(),
    driftMonitor: z.boolean().optional(),
    driftThresholdPct: z.number().optional(),
  })
  .strict();

/**
 * Training-config persisted to `Model.data.config`. THIS SCHEMA IS THE
 * AUTHORITY — `apps/client/lib/model-config.ts`'s `ModelConfig` interface
 * mirrors it, not the other way around. Reversed 2026-08-25 (MODEL-FLOW-006):
 * the previous `.passthrough()` version left this schema documenting six
 * fields while the client actually sent twelve, and a live audit of the 16
 * existing rows found the drift it allowed — dead pre-Data-Studio ETL keys
 * persisted verbatim, and both `targetVariable` (declared) and
 * `targetVariables` (used, undeclared) present across rows.
 *
 * `.strict()`, not the default strip: every key seen in production is
 * declared below (six of them as deprecated legacy), so strict cannot break
 * an existing row, and a genuinely new client field now fails loudly at the
 * boundary instead of silently becoming untyped storage — which is the
 * defect this rewrite exists to close. The dataset/ETL recipe itself lives
 * on `Dataset` (see dataset.authorized module) — a model only references it
 * by id.
 */
export const ModelConfigSchema = z
  .object({
    description: z.string().max(2000).optional(),
    datasetId: z.string().optional(),
    algorithm: z.string().optional(),
    /** Multi-select catalogue (up to 3, `algorithm-selector.tsx`'s MAX) —
     *  `algorithm` above mirrors `algorithms[0]`. */
    algorithms: z.array(z.string()).optional(),
    findBestModel: z.boolean().optional(),
    findBestParams: z.boolean().optional(),
    targetVariables: z.array(z.string()).optional(),
    /** @deprecated singular predecessor of `targetVariables`. Still declared
     *  on the client and present in real rows — kept so those rows round-trip;
     *  new writes should prefer `targetVariables`. */
    targetVariable: z.string().optional(),
    hyperparameters: HyperparametersSchema.optional(),
    lossFunction: z.string().optional(),
    /**
     * A PERCENTAGE (50-95), matching what the client actually sends
     * (`lib/model-config.ts`: "Train split percentage; test = 100 − this")
     * and what every observed row contains (70/80/85) — NOT the same unit as
     * `ModelDraft.splitRatio` or `ModelTrainingRun.splitSpec.ratio`, both
     * fractions. Unifying the unit across all three homes is MODEL-FLOW-007's
     * job, when Save Model can derive this from the adopted run's own
     * splitSpec instead of trusting the browser.
     */
    trainTestSplit: z.number().min(50).max(95).optional(),
    /**
     * MODEL-FLOW-007-T11. From the adopted run's `run_manifest.json` at Save
     * time — `null`/absent for a run trained before the trainer image that
     * started recording it. Lives inside `config`, not as a sibling key on
     * `Model.data`: `normalizeData` (model.authorized.service.ts) whitelists
     * top-level `data` keys explicitly and a field outside that list would
     * silently vanish on the next `updateModel` call (e.g. Save & Deploy's
     * immediate follow-up write) — `config` is one of the whitelisted keys,
     * so nesting here is what makes this survive.
     */
    frameworkVersions: z.record(z.string(), z.string()).nullable().optional(),
    /**
     * MODEL-FLOW-016-T12. Present only for a model adopted from a
     * Cross-Validation run — `null`/absent means an ordinary chronological
     * train/test run, which is what every row written before this feature
     * is. Derived SERVER-SIDE from the adopted run's own `splitSpec` at Save
     * time, never sent by the client.
     *
     * It exists because a CV run's headline numbers describe the
     * CONFIGURATION (the fold mean ± std in `metrics`), not the refit model
     * that actually ships — this feature's finding 3. Without this field a
     * CV-derived model is indistinguishable from a train/test one in the
     * saved row, and its fold mean reads as though it were the artifact's
     * own held-out score.
     *
     * `holdoutScored` records whether the separate, user-triggered scoring
     * phase (T07) ever ran — i.e. whether an honest held-out number for this
     * artifact exists at all. It cannot go stale in the false direction:
     * scoring is draft-scoped (`assertDraftWritable` refuses a SAVED
     * draft), so a model saved unscored can never be scored afterward.
     *
     * The holdout NUMBERS are deliberately not copied here — `ModelVersion.
     * sourceRunId` already points at the run row that owns them, the same
     * pointer-not-copy rule the rest of the save path follows. Nested
     * inside `config` for the same reason `frameworkVersions` above is.
     */
    crossValidation: z
      .object({
        method: z.literal('cv_expanding'),
        nSplits: z.number().int().min(2).max(10),
        holdoutScored: z.boolean(),
      })
      // `.strict()` like DeploymentConfigSchema above, and for the same
      // reason: zod's default STRIPS an unknown nested key silently, which is
      // the passthrough-era behaviour MODEL-FLOW-006 rewrote this schema to
      // remove. A nested field nobody declared must fail at the boundary.
      .strict()
      .nullable()
      .optional(),
    selectedMetrics: z.array(z.string()).optional(),
    deployment: DeploymentConfigSchema.optional(),

    // --- Legacy, pre-Data-Studio ETL fields — DEPRECATED ---
    // Written by an earlier version of the wizard that configured its own
    // data source/tag selection/time range inline, before that moved to Data
    // Studio. `z.unknown()`: real rows show heterogeneous shapes (dataSource
    // is a nested connection object including a masked password field,
    // fillStrategies an object, customDateRange sometimes null) and none of
    // it is read by any code today (verified by grep) — declared only so the
    // rows that carry them keep validating, never as fields a new write
    // should populate.
    /** @deprecated pre-Data-Studio. */
    dataSource: z.unknown().optional(),
    /** @deprecated pre-Data-Studio. */
    fillStrategies: z.unknown().optional(),
    /** @deprecated pre-Data-Studio. */
    timeRange: z.unknown().optional(),
    /** @deprecated pre-Data-Studio. */
    selectedTags: z.unknown().optional(),
    /** @deprecated pre-Data-Studio. */
    customDateRange: z.unknown().optional(),
    /** @deprecated pre-Data-Studio. */
    savedSourceId: z.unknown().optional(),
  })
  .strict();

export const CreateModelSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(100),
  nodeId: z.string().uuid().optional(),
  datasetId: z.string().uuid().optional(),
  config: ModelConfigSchema.optional(),
});

export const UpdateModelSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  nodeId: z.string().uuid().nullable().optional(),
  datasetId: z.string().uuid().nullable().optional(),
  deployStatus: DeployStatusEnum.optional(),
  prodStatus: ProdStatusEnum.optional(),
  statusDetail: z.string().max(500).nullable().optional(),
  config: ModelConfigSchema.optional(),
});

export const AppendLogSchema = z.object({
  level: z.enum(['info', 'warn', 'error']),
  message: z.string().min(1).max(500),
});

export const ModelQuerySchema = z.object({
  workspaceId: z.string().uuid(),
});

export const DeleteModelSchema = z.object({
  modelId: z.string().uuid(),
});

export class CreateModelDto extends createZodDto(CreateModelSchema) {}
export class UpdateModelDto extends createZodDto(UpdateModelSchema) {}
export class AppendLogDto extends createZodDto(AppendLogSchema) {}
export class ModelQueryDto extends createZodDto(ModelQuerySchema) {}
export class DeleteModelDto extends createZodDto(DeleteModelSchema) {}
