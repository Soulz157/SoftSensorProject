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
    const { scalingParams, derivedFeatures } = await this.resolveFeatureSpec(
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
        // T12. Named `derivedFeatures`, never `features` — this same
        // response already carries `featureColumns` (the full trained X
        // list, 21 strings on the live model); a sibling `features` holding
        // a handful of objects would be conflated with it by every future
        // reader. Only `formula` features are included (see
        // resolveFeatureSpec's own comment) — this tells a reader which
        // SOURCE COLUMNS feed a derived tag, never which one is Bad: no
        // status field exists anywhere on the /predict stream this tab
        // reads (see input-data-tab.tsx's own doc comment).
        derivedFeatures,
      },
    };
  }

  /** Never throws — a missing/unreadable manifest is a normal legacy state
   *  for a display read, not an error. Mirrors the honest-null discipline
   *  `lib/artifact-baseline.ts`'s `resolveColumnBaseline` already applies to
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

  /** Best-effort only — a failed read means the tab shows raw logged values
   *  with no equation annotation, never a broken tab. Same try/catch
   *  discipline `resolveFeatureColumns` above uses.
   *
   *  T12. Widened from `resolveScalingParams` (which this replaces) to also
   *  return each `formula` feature's human-readable equation — one MinIO
   *  read already made for `scalingParams`, so this is not a second I/O
   *  call. Scoped to `kind === 'formula'` deliberately: `config.display` and
   *  `config.vars` are formula's OWN config keys (feature_spec_service.py's
   *  `build_feature_spec`); `ratio`/`arith`/`lag`/`delta`/`rolling` carry
   *  different config shapes (feature_service.py's `_compute_feature_column`
   *  branches) that this display read does not attempt to interpret — a
   *  non-formula kind is simply omitted rather than guessed at. */
  private async resolveFeatureSpec(goldObjectKey: string): Promise<{
    scalingParams: Record<string, Record<string, number>> | null;
    derivedFeatures: Array<{ name: string; kind: string; display: string }>;
  }> {
    try {
      const { spec } = await readFeatureSpec(goldObjectKey);
      const derivedFeatures = (spec.features ?? [])
        .filter(
          (
            f,
          ): f is typeof f & {
            name: string;
            kind: 'formula';
            config: { display: string };
          } =>
            f.kind === 'formula' &&
            typeof f.name === 'string' &&
            typeof f.config?.display === 'string',
        )
        .map((f) => ({
          name: f.name,
          kind: f.kind,
          display: f.config.display,
        }));
      return {
        scalingParams: spec.scalingParams ?? null,
        derivedFeatures,
      };
    } catch {
      return { scalingParams: null, derivedFeatures: [] };
    }
  }
}
