import { Injectable } from '@nestjs/common';
import { PrismaService } from '@softsensor/prisma';
import { AppException } from '@softsensor/common';
import {
  getRunManifest,
  presignRunObject,
  readFeatureSpec,
} from '@/lib/python-preprocess-client';

/** Same narrowing convention `extractR2`/`extractRmse` already use for
 *  untyped Json columns (model-version.authorized.service.ts,
 *  model-candidate-job.authorized.service.ts) — an unreadable value is
 *  treated as absent, never guessed at. */
function asFrameworkVersions(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.every(([, v]) => typeof v === 'string')) return null;
  return Object.fromEntries(entries) as Record<string, string>;
}

/** One `feature_spec.json` feature entry, flattened into the shape
 *  `softsensor_scaling.max_replay_lookback` reads (per-kind fields at the
 *  top level, `name` alongside them). */
type ServingFeatureConfig = Record<string, unknown> & { kind?: string };

/**
 * MODEL-SERVE-002-T06. `feature_spec.json` nests each feature's per-kind
 * fields under `config`; `max_replay_lookback` reads them at the top level
 * (the shape apps/python feeds it). Flatten rather than re-model: this
 * endpoint is a pass-through for a recipe whose authority is
 * `feature_spec_service.build_feature_spec`, and re-describing its per-kind
 * fields here would be a second definition free to drift from that one.
 * An unreadable entry is dropped rather than guessed at, same convention as
 * `asFrameworkVersions` above.
 */
function asFeatureConfigs(value: unknown): ServingFeatureConfig[] {
  if (!Array.isArray(value)) return [];
  const configs: ServingFeatureConfig[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const row = entry as Record<string, unknown>;
    const nested =
      row.config && typeof row.config === 'object' && !Array.isArray(row.config)
        ? (row.config as Record<string, unknown>)
        : {};
    const flattened: ServingFeatureConfig = { ...nested };
    if (typeof row.kind === 'string') flattened.kind = row.kind;
    if (typeof row.name === 'string') flattened.name = row.name;
    configs.push(flattened);
  }
  return configs;
}

/**
 * MODEL-SERVE-002. Resolves a Model's PRODUCTION `ModelVersion` into
 * everything `apps/serving`'s loader and predict path need, in one round
 * trip — no DB, no S3 credentials on the serving side (same rule
 * `images/trainer/app/storage.py` states on itself: every transfer rides a
 * presigned URL).
 *
 * Its own module, matching `model-version`/`model-run`'s convention of one
 * feature per module — this has a different caller (`apps/serving`, via
 * `ServingTokenGuard`) and a different shape (read-only descriptor, not a
 * mutating promote) from either of those, so folding it into one of them
 * would mix two access models under one guard.
 */
@Injectable()
export class ModelServingAuthorizedService {
  constructor(private readonly prisma: PrismaService) {}

  /** T03. Every PRODUCTION version, across every model — the set
   *  `apps/serving` warms before answering /readyz. */
  async listProductionVersionsService() {
    const versions = await this.prisma.modelVersion.findMany({
      where: { stage: 'PRODUCTION' },
      select: { id: true, modelId: true, version: true },
    });
    return {
      statusCode: 200,
      message: 'Production versions listed',
      type: 'SUCCESS' as const,
      data: versions.map((v) => ({
        modelId: v.modelId,
        versionId: v.id,
        version: v.version,
      })),
    };
  }

  /**
   * T02/T04/T05/T06. Mirrors `ModelRunScoreAuthorizedService.
   * scoreClaimService`'s shape one entity higher (a model's PRODUCTION
   * version, not one training run).
   */
  async getDescriptorService(modelId: string) {
    const version = await this.prisma.modelVersion.findFirst({
      where: { modelId, stage: 'PRODUCTION' },
      include: {
        sourceRun: { select: { targetY: true, manifestKey: true } },
      },
    });
    if (!version) {
      throw new AppException({
        statusCode: 404,
        message: `Model ${modelId} has no PRODUCTION version.`,
        type: 'ERROR',
      });
    }
    return this.buildDescriptor(modelId, version);
  }

  /**
   * MODEL-SERVE-003-T05. The pinned-version twin of `getDescriptorService`
   * — resolves a SPECIFIC ModelVersion regardless of its current stage,
   * never "whatever is PRODUCTION right now". A PredictionJob pins its
   * modelVersionId at submit time precisely so a promote landing mid-batch
   * cannot silently retarget an in-flight job (V03) — an ARCHIVED version
   * must still resolve here, or a promote would strand every job pinned to
   * the version it demoted.
   */
  async getDescriptorByVersionIdService(modelVersionId: string) {
    const version = await this.prisma.modelVersion.findUnique({
      where: { id: modelVersionId },
      include: {
        sourceRun: { select: { targetY: true, manifestKey: true } },
      },
    });
    if (!version) {
      throw new AppException({
        statusCode: 404,
        message: `ModelVersion ${modelVersionId} not found.`,
        type: 'ERROR',
      });
    }
    return this.buildDescriptor(version.modelId, version);
  }

  private async buildDescriptor(
    modelId: string,
    version: {
      id: string;
      version: number;
      algorithm: string;
      modelObjectKey: string;
      modelChecksum: string | null;
      goldObjectKey: string;
      featureSpecKey: string | null;
      frameworkVersions: unknown;
      imageDigest: string;
      sourceRun: { targetY: string; manifestKey: string | null };
    },
  ) {
    const presigned = await presignRunObject({
      source_key: version.modelObjectKey,
    });

    const manifest = version.sourceRun.manifestKey
      ? await getRunManifest(version.sourceRun.manifestKey)
      : null;

    // Nothing else records predict-time column order — a hard refusal,
    // same discipline scoreClaimService already applies to its own
    // feature_columns read (model-run-score.authorized.service.ts:190-195).
    const featureColumns = manifest?.feature_columns ?? null;
    if (!featureColumns || featureColumns.length === 0) {
      throw new AppException({
        statusCode: 422,
        message:
          `Model ${modelId}'s PRODUCTION version has no recorded ` +
          'feature_columns in its run manifest — its training image ' +
          'predates MODEL-FLOW-016-T07. Cannot serve.',
        type: 'ERROR',
      });
    }

    const specResult = await readFeatureSpec(version.goldObjectKey);
    // Cheap insurance the descriptor never re-derives through a different
    // artifact than the one this version actually pins — verified 0
    // mismatches across all 73 live ModelTrainingRun rows before this
    // check was written (see MODEL-SERVE-002's plan, Stage 1b step 4).
    // Skipped only when featureSpecKey itself is unset (nothing pinned to
    // compare against — honest-legacy-null, not a silent pass).
    if (
      version.featureSpecKey &&
      specResult.feature_spec_key !== version.featureSpecKey
    ) {
      throw new AppException({
        statusCode: 422,
        message:
          `Feature spec key mismatch for model ${modelId}: version pins ` +
          `${version.featureSpecKey}, resolved ` +
          `${specResult.feature_spec_key}.`,
        type: 'ERROR',
      });
    }

    const spec = specResult.spec;
    const scalers: Record<string, string> = {};
    for (const row of spec.scaling ?? []) scalers[row.tag] = row.method;

    return {
      statusCode: 200,
      message: 'Descriptor resolved',
      type: 'SUCCESS' as const,
      data: {
        modelId,
        versionId: version.id,
        version: version.version,
        algorithm: version.algorithm,
        targetY: version.sourceRun.targetY,
        modelUrl: presigned.data_url,
        modelChecksum: version.modelChecksum,
        featureColumns,
        // Resolved the same default-aware way to_model_ready itself uses
        // (scalers.get(tag, DEFAULT_SCALER)) — never by checking `scaling`
        // for non-emptiness. See the empty-scaling-array trap finding.
        scalers,
        scalingParams: spec.scalingParams ?? {},
        derivedFromTarget: spec.derived_from_target ?? [],
        targetScaled: spec.target_scaled ?? false,
        // MODEL-SERVE-002-T06. The recipe, FLATTENED — feature_spec.json
        // stores `{name, kind, config: {...}}`, but max_replay_lookback
        // reads the per-kind fields (`k`, `window`, `tag`, `tags`, `vars`)
        // at the top level, which is the shape apps/python already feeds it
        // (artifact_service.py's `[f.to_step() for f in request.features]`).
        // Flattened here so serving computes the history depth with that
        // same function rather than a reimplementation.
        features: asFeatureConfigs(spec.features),
        // Prefer the live manifest read (the actual recorded transcript)
        // over the pinned snapshot on the version row; fall back to the
        // snapshot only when the manifest read has nothing.
        frameworkVersions:
          asFrameworkVersions(manifest?.framework_versions) ??
          asFrameworkVersions(version.frameworkVersions),
        imageDigest: version.imageDigest,
      },
    };
  }
}
