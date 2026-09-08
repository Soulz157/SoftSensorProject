import { Injectable } from '@nestjs/common';
import { PrismaService } from '@softsensor/prisma';
import { AppException } from '@softsensor/common';
import {
  getRunManifest,
  readFeatureSpec,
} from '@/lib/python-preprocess-client';

/**
 * The Input Data tab's read of a saved Model's trained schema — the
 * ordered X feature list (`run_manifest.json`'s `feature_columns`) and the
 * Y target (`ModelTrainingRun.targetY`), over `JwtAccessGuard` rather than
 * `ServingTokenGuard`. `ModelServingAuthorizedService.buildDescriptor`
 * already resolves this exact data for the machine-serving path, but three
 * things there are wrong for a browser display read and are deliberately
 * NOT copied here:
 *
 * 1. It requires `stage: 'PRODUCTION'` and 404s otherwise. Save Model
 *    always mints a STAGING ModelVersion in the same transaction
 *    (`model-draft.authorized.service.ts`, `@/lib/model-version-from-run`)
 *    — every saved Model has at least one version, so PRODUCTION-only would
 *    blank this tab for every model that has not been deployed yet.
 * 2. It THROWS a 422 when `feature_columns` is missing (a run predating
 *    MODEL-FLOW-016-T07). A display read must say so, not fail the tab —
 *    the same honest-legacy-null discipline
 *    `DatasetVersionAuthorizedService.getArtifactColumnStatsService` uses
 *    for a pre-sidecar artifact.
 * 3. It is unreachable from the browser (`ServingTokenGuard` only checks a
 *    machine token) — this is the whole reason the Input Data tab could
 *    only ever show traffic-derived data before this endpoint existed.
 */
@Injectable()
export class ModelInputSchemaAuthorizedService {
  constructor(private readonly prisma: PrismaService) {}

  /** Same duplication rationale `PredictionLogAuthorizedService` and four
   *  other authorized services already state for their own copy of this
   *  check — no shared helper across modules. VIEWER is rejected, same as
   *  the sibling `/predictions` and `/drift` reads this tab also calls —
   *  opening only this one read to VIEWER would produce a tab whose
   *  feature list loads while every status column still 403s. */
  private async assertModelAccess(modelId: string, user: Auth.UserPayload) {
    const model = await this.prisma.model.findUnique({
      where: { id: modelId },
      select: { id: true, workspaceId: true },
    });
    if (!model) {
      throw new AppException({
        statusCode: 404,
        message: 'Model not found',
        type: 'ERROR',
      });
    }
    if (user.role === 'ADMIN') return model;

    const workspace = await this.prisma.workspace.findFirst({
      where: { id: model.workspaceId, ownerId: user.id },
      select: { id: true },
    });
    if (workspace) return model;
    const member = await this.prisma.workspaceMember.findFirst({
      where: { workspaceId: model.workspaceId, userId: user.id },
    });
    if (!member || member.role === 'VIEWER') {
      throw new AppException({
        statusCode: 403,
        message: 'Forbidden: editor access required',
        type: 'ERROR',
      });
    }
    return model;
  }

  async getInputSchemaService(modelId: string, user: Auth.UserPayload) {
    await this.assertModelAccess(modelId, user);

    const sourceRunSelect = {
      select: { targetY: true, manifestKey: true },
    } as const;

    const version =
      (await this.prisma.modelVersion.findFirst({
        where: { modelId, stage: 'PRODUCTION' },
        include: { sourceRun: sourceRunSelect },
      })) ??
      (await this.prisma.modelVersion.findFirst({
        where: { modelId },
        orderBy: { version: 'desc' },
        include: { sourceRun: sourceRunSelect },
      }));

    if (!version) {
      throw new AppException({
        statusCode: 404,
        message: `Model ${modelId} has no version yet.`,
        type: 'ERROR',
      });
    }

    const { featureColumns, unavailableReason } =
      await this.resolveFeatureColumns(version.sourceRun.manifestKey);
    const scalingParams = await this.resolveScalingParams(
      version.goldObjectKey,
    );

    return {
      statusCode: 200,
      message: 'Input schema resolved',
      type: 'SUCCESS' as const,
      data: {
        modelId,
        versionId: version.id,
        version: version.version,
        stage: version.stage,
        featureColumns,
        unavailableReason,
        targetY: version.sourceRun.targetY,
        scalingParams,
      },
    };
  }

  /** Never throws — a missing/unreadable manifest is a normal legacy state
   *  for a display read, not an error. Mirrors the honest-null discipline
   *  `PredictionLogAuthorizedService.resolveBaseline` already applies to
   *  its own best-effort python read. */
  private async resolveFeatureColumns(manifestKey: string | null): Promise<{
    featureColumns: string[] | null;
    unavailableReason: string | null;
  }> {
    if (!manifestKey) {
      return {
        featureColumns: null,
        unavailableReason:
          'This training run has no recorded manifest — it predates feature-column tracking.',
      };
    }
    try {
      const manifest = await getRunManifest(manifestKey);
      const columns = manifest.feature_columns ?? null;
      if (!columns || columns.length === 0) {
        return {
          featureColumns: null,
          unavailableReason:
            "This training run's manifest has no recorded feature columns — it predates MODEL-FLOW-016-T07.",
        };
      }
      return { featureColumns: columns, unavailableReason: null };
    } catch (err) {
      return {
        featureColumns: null,
        unavailableReason: `Manifest unavailable: ${(err as Error).message}`,
      };
    }
  }

  /** Best-effort only — `scalingParams: null` means the tab shows scaled
   *  values instead of engineering units, never a broken tab. Same
   *  try/catch discipline `resolveFeatureColumns` above uses. */
  private async resolveScalingParams(
    goldObjectKey: string,
  ): Promise<Record<string, Record<string, number>> | null> {
    try {
      const { spec } = await readFeatureSpec(goldObjectKey);
      return spec.scalingParams ?? null;
    } catch {
      return null;
    }
  }
}
