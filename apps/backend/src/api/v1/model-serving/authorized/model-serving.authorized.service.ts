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
