import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@softsensor/prisma';
import { AppException } from '@softsensor/common';
import { env } from '@/config/env.config';
import { postToPython, PYTHON_TIMEOUT } from '@/lib/python-client';
import {
  appendPredictionLog,
  predictionLogSeries,
} from '@/lib/python-preprocess-client';
import { PythonColumnStatsSchema } from '@/api/v1/dataset-version/authorized/dto/dataset-version.authorized.dto';
import {
  computeDrift,
  poolFeatureStats,
  type ColumnBaselineMap,
  type FeatureStatsMap,
} from '@/lib/prediction-drift';
import type {
  IngestPredictionLogDto,
  PredictionLogRangeQueryDto,
} from './dto/prediction-log.authorized.dto';

/**
 * MODEL-SERVE-005. Sampled synchronous-/predict logging (T01) and the
 * distribution-drift signal (T02) built on it.
 *
 * Its own module rather than folded into model-serving/model-version,
 * matching this codebase's established one-feature-per-module convention
 * (model-run, model-version, prediction-job, model-serving are all their
 * own modules despite being tightly coupled to Model).
 */
@Injectable()
export class PredictionLogAuthorizedService {
  private readonly log = new Logger(PredictionLogAuthorizedService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── access ───────────────────────────────────────────────────────────────

  /** Editor-level, the same rule every other mutating-or-reading Model
   *  route in this codebase applies (model-version, model-run-launch,
   *  prediction-job, model-retrain all hold an identical copy — see
   *  ModelRetrainAuthorizedService's own note on why a shared helper has
   *  not been extracted for four call sites, unchanged at five). */
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

  // ── ingest (ServingTokenGuard) ──────────────────────────────────────────

  /**
   * MODEL-SERVE-005-T01. Called once per LOGGED request — apps/serving has
   * already decided to sample this request in, at what rate, and which
   * rows to keep. Structurally cannot fail the caller: an object-write
   * failure still yields a PredictionLog row with `objectKey: null` rather
   * than losing the aggregates, the same "aggregates first, detail
   * best-effort" discipline `freezeSplitStats` applies to a run row one
   * layer over.
   */
  async ingestPredictionLogService(dto: IngestPredictionLogDto) {
    const [model, version] = await Promise.all([
      this.prisma.model.findUnique({
        where: { id: dto.modelId },
        select: { id: true },
      }),
      this.prisma.modelVersion.findFirst({
        where: { id: dto.modelVersionId, modelId: dto.modelId },
        select: { id: true },
      }),
    ]);
    if (!model || !version) {
      // A serving-token caller with a stale/wrong id is a configuration
      // bug on that side, not a client error to shape gracefully — 404 is
      // enough for its own logs to catch, and it never reaches a browser.
      throw new NotFoundException(
        `Model ${dto.modelId} / version ${dto.modelVersionId} not found`,
      );
    }

    let objectKey: string | null = null;
    let objectChecksum: string | null = null;
    if (dto.rows.length > 0) {
      try {
        const written = await appendPredictionLog({
          model_id: dto.modelId,
          model_version_id: dto.modelVersionId,
          requested_at: dto.requestedAt,
          rows: dto.rows,
        });
        objectKey = written.object_key;
        objectChecksum = written.object_checksum;
      } catch (err) {
        // The object write is best-effort by design — see this method's
        // own doc comment. Logged, never thrown: the aggregates below are
        // still real and still the whole input to T02's drift signal.
        this.log.error(
          `prediction-log append failed for model ${dto.modelId} version ${dto.modelVersionId}`,
          err,
        );
      }
    }

    const created = await this.prisma.predictionLog.create({
      data: {
        modelId: dto.modelId,
        modelVersionId: dto.modelVersionId,
        objectKey,
        objectChecksum,
        rowCount: dto.rowCount,
        loggedRows: dto.loggedRows,
        samplingRate: dto.samplingRate,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        featureStats: JSON.parse(JSON.stringify(dto.featureStats)),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        predictionStats: JSON.parse(JSON.stringify(dto.predictionStats)),
        requestedAt: new Date(dto.requestedAt),
      },
      select: { id: true },
    });

    return {
      statusCode: 201,
      message: 'Prediction logged',
      type: 'SUCCESS' as const,
      data: { id: created.id },
    };
  }

  // ── read (JwtAccessGuard) ───────────────────────────────────────────────

  /**
   * MODEL-SERVE-005. The Monitoring page's series — one point per RAW
   * logged row (not per request), read from the Parquet objects
   * `ingestPredictionLogService` wrote. A range can span a promote, so
   * this resolves every DISTINCT modelVersionId this model actually logged
   * in [from, to] from Postgres first (cheap — PredictionLog is indexed on
   * (modelId, requestedAt)), then reads each version's own object prefix
   * in parallel and merges — the object layout is partitioned per version,
   * so one python call cannot span two.
   */
  async getPredictionSeriesService(
    modelId: string,
    query: PredictionLogRangeQueryDto,
    user: Auth.UserPayload,
  ) {
    await this.assertModelAccess(modelId, user);

    const versions = await this.prisma.predictionLog.findMany({
      where: {
        modelId,
        requestedAt: { gte: new Date(query.from), lte: new Date(query.to) },
      },
      select: { modelVersionId: true },
      distinct: ['modelVersionId'],
    });

    const results = await Promise.all(
      versions.map((v) =>
        predictionLogSeries({
          model_id: modelId,
          model_version_id: v.modelVersionId,
          from: query.from,
          to: query.to,
        }).then((r) => ({ modelVersionId: v.modelVersionId, ...r })),
      ),
    );

    const points = results
      .flatMap((r) =>
        r.points.map((p) => ({ ...p, modelVersionId: r.modelVersionId })),
      )
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const truncated = results.some((r) => r.truncated);

    return {
      statusCode: 200,
      message: 'Prediction series fetched',
      type: 'SUCCESS' as const,
      data: { points, truncated },
    };
  }

  /**
   * MODEL-SERVE-005-T02. The current PRODUCTION version's live inputs,
   * pooled from PredictionLog's own sufficient-statistics aggregates over
   * [from, to], compared against the training artifact's own
   * column_stats.json — never a separately-computed baseline (the
   * acceptance criterion this ledger states verbatim).
   */
  async getDriftService(
    modelId: string,
    query: PredictionLogRangeQueryDto,
    user: Auth.UserPayload,
  ) {
    await this.assertModelAccess(modelId, user);

    const production = await this.prisma.modelVersion.findFirst({
      where: { modelId, stage: 'PRODUCTION' },
    });
    if (!production) {
      throw new AppException({
        statusCode: 404,
        message: `Model ${modelId} has no PRODUCTION version. Nothing to compare live traffic against.`,
        type: 'ERROR',
      });
    }

    const rows = await this.prisma.predictionLog.findMany({
      where: {
        modelVersionId: production.id,
        requestedAt: { gte: new Date(query.from), lte: new Date(query.to) },
      },
      select: { featureStats: true },
    });

    const pooled = poolFeatureStats(
      rows.map((r) => r.featureStats as unknown as FeatureStatsMap),
    );

    const baseline = await this.resolveBaseline(production.goldObjectKey);

    const report = computeDrift(pooled, baseline, {
      warnSd: env.DRIFT_WARN_SD,
      criticalSd: env.DRIFT_CRITICAL_SD,
      outOfRangePct: env.DRIFT_OUT_OF_RANGE_PCT,
    });

    return {
      statusCode: 200,
      message: 'Drift report fetched',
      type: 'SUCCESS' as const,
      data: {
        ...report,
        basis: {
          modelVersionId: production.id,
          version: production.version,
          goldArtifactId: production.goldArtifactId,
          goldObjectKey: production.goldObjectKey,
          sampleRequests: rows.length,
          from: query.from,
          to: query.to,
        },
      },
    };
  }

  /**
   * Reads column_stats.json for the PRODUCTION version's own training
   * artifact — the SAME sidecar `getArtifactColumnStatsService` serves,
   * called directly via `postToPython` rather than through that
   * user-scoped service: this call has no `user` to re-authorize with
   * (access was already checked once, on the Model), the same reasoning
   * `freezeSplitStats` gives for calling python directly instead of
   * through a request-scoped service method.
   *
   * A missing sidecar (a legacy artifact predating column_stats.json) is
   * NOT an error here — every column simply reports UNKNOWN with a named
   * reason (`computeDrift`'s own "no training baseline" branch), the same
   * honest-empty-state discipline `getArtifactHoldoutService` uses for a
   * dataset with no holdout.
   */
  private async resolveBaseline(
    goldObjectKey: string,
  ): Promise<ColumnBaselineMap> {
    try {
      const result = PythonColumnStatsSchema.parse(
        await postToPython(
          '/v1/preprocess/column-stats',
          { source_key: goldObjectKey },
          PYTHON_TIMEOUT.metadata,
        ),
      );
      const baseline: ColumnBaselineMap = {};
      for (const [tag, stats] of Object.entries(result.stats)) {
        baseline[tag] = {
          mean: stats.mean ?? null,
          std: stats.std ?? null,
          percentiles: stats.percentiles
            ? { p1: stats.percentiles.p1, p99: stats.percentiles.p99 }
            : null,
        };
      }
      return baseline;
    } catch (err) {
      this.log.warn(
        `column_stats unavailable for ${goldObjectKey}; drift will report every column UNKNOWN: ${(err as Error).message}`,
      );
      return {};
    }
  }
}
