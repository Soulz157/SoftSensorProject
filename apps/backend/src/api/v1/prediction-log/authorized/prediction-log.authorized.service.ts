import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService, PrismaTypes } from '@softsensor/prisma';
import { AppException } from '@softsensor/common';
import {
  appendPredictionLog,
  predictionLogSeries,
} from '@/lib/python-preprocess-client';
import {
  buildRowSeries,
  driftThresholds,
  gradeSeries,
} from '@/lib/input-range-drift';
import { resolveDriftReference } from '@/lib/artifact-baseline';
import {
  DRIFT_RANGE_MAX_DAYS,
  InferenceWindowMonitoringService,
} from '@/api/v1/inference-window/authorized/inference-window-monitoring.authorized.service';

/** MODEL-SERVE-036. Trend points per tag, and the health population size the
 *  card names (`getHealthStatus` grades the newest 24 windows). */
const DRIFT_TREND_MAX_POINTS = 600;
const HEALTH_WINDOWS = 24;
import type {
  IngestPredictionLogDto,
  PredictionLogRangeQueryDto,
} from './dto/prediction-log.authorized.dto';
import { canReadWithGrant } from '@/lib/workspace-permission';

/**
 * MODEL-SERVE-005. Sampled synchronous-/predict logging (T01) and the
 * input-drift signal built on it (training range since MODEL-SERVE-036).
 *
 * Its own module rather than folded into model-serving/model-version,
 * matching this codebase's established one-feature-per-module convention
 * (model-run, model-version, prediction-job, model-serving are all their
 * own modules despite being tightly coupled to Model).
 */
@Injectable()
export class PredictionLogAuthorizedService {
  private readonly log = new Logger(PredictionLogAuthorizedService.name);

  constructor(
    private readonly prisma: PrismaService,
    // MODEL-SERVE-001-T17. `getInputDriftService` dispatches to
    // this for a model with an InferenceSchedule — see
    // `InferenceWindowMonitoringService.hasSchedule`'s own doc comment for
    // the full plane-selection rule.
    private readonly windowMonitoring: InferenceWindowMonitoringService,
  ) {}

  // ── access ───────────────────────────────────────────────────────────────

  /** Editor-level, the same rule every other mutating-or-reading Model
   *  route in this codebase applies (model-version, model-run-launch,
   *  prediction-job, model-retrain all hold an identical copy — see
   *  ModelRetrainAuthorizedService's own note on why a shared helper has
   *  not been extracted for four call sites, unchanged at five). */
  private async assertModelAccess(
    modelId: string,
    user: Auth.UserPayload,
    // 'edit' (default) is every mutating route: OWNER/STAFF only.
    // 'monitoring-read' is a read a VIEWER may make once an OWNER granted
    // MONITORING_VIEW. Never pass it from a route that changes anything.
    access: 'edit' | 'monitoring-read' = 'edit',
  ) {
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
    const allowed =
      access === 'monitoring-read'
        ? canReadWithGrant(member, 'MONITORING_VIEW')
        : !!member && member.role !== 'VIEWER';
    if (!allowed) {
      throw new AppException({
        statusCode: 403,
        message:
          access === 'monitoring-read'
            ? 'Forbidden: monitoring access required'
            : 'Forbidden: editor access required',
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
        // MODEL-SERVE-001-T13. `PrismaTypes.DbNull` is what actually
        // writes SQL NULL into a nullable Json column — a plain JS `null`
        // is type-rejected by the generated client (it would instead mean
        // "store the JSON literal null", only legal on a NOT NULL Json
        // column, which this is not).
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        featureHistograms:
          dto.featureHistograms === null
            ? PrismaTypes.DbNull
            : JSON.parse(JSON.stringify(dto.featureHistograms)),
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
    await this.assertModelAccess(modelId, user, 'monitoring-read');

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

    // MODEL-SERVE-008-T06. MODEL-SERVE-001-T10 Part A's finding was that
    // this stream is empty BY CONSTRUCTION for a scheduled-only model, and
    // the chart says so. T02's live driver makes that implication false for
    // any model whose driver is on: scheduled inference still never writes
    // here, but something else now does. A section that names a cause which
    // no longer applies is worse than one that says nothing, because a
    // reader trusts it.
    //
    // Rides along on this response rather than costing the client a second
    // request — it is one boolean about the same model over the same range,
    // and the chart cannot tell the two empty states apart without it.
    const schedule = await this.prisma.inferenceSchedule.findUnique({
      where: { modelId },
      select: { livePredictEnabled: true },
    });

    return {
      statusCode: 200,
      message: 'Prediction series fetched',
      type: 'SUCCESS' as const,
      data: {
        points,
        truncated,
        // False with no schedule row at all — no driver, so the original
        // by-construction sentence is the correct one.
        livePredictEnabled: schedule?.livePredictEnabled ?? false,
      },
    };
  }

  /**
   * MODEL-SERVE-036. Input drift by training range over the PRODUCTION
   * version's live inputs: per tag, the share of values outside its
   * training [min, max], with the trend and hourly stats behind it. On the
   * /predict plane the logged rows themselves are read (`predictionLogSeries`)
   * and bucketed here with `bucketValue`, the mirror of the Python primitive,
   * so the badge and the chart count one population. Capped to 31 days.
   *
   * MODEL-SERVE-001-T17. PLANE DISPATCH, decided with the user 2026-09-15:
   * a model with an InferenceSchedule reads its windows' input files
   * instead — `PredictionLog` is written by `/predict` ONLY, so a
   * scheduled-only model's PredictionLog is empty BY CONSTRUCTION, and
   * everything below this check would correctly compute nothing forever.
   * See `InferenceWindowMonitoringService.hasSchedule`'s own doc comment for
   * the full rule. Everything from here down is the `/predict`-plane
   * implementation, reached only for a model with no schedule.
   */
  async getInputDriftService(
    modelId: string,
    query: PredictionLogRangeQueryDto,
    user: Auth.UserPayload,
  ) {
    await this.assertModelAccess(modelId, user, 'monitoring-read');

    if (await this.windowMonitoring.hasSchedule(modelId)) {
      return this.windowMonitoring.getInputDriftReport(
        modelId,
        query.from,
        query.to,
      );
    }

    const production = await this.prisma.modelVersion.findFirst({
      where: { modelId, stage: 'PRODUCTION' },
    });
    if (!production) {
      throw new AppException({
        statusCode: 404,
        message: `Model ${modelId} has no PRODUCTION version. Nothing to compare live inputs against.`,
        type: 'ERROR',
      });
    }

    // Same 31-day cap as the window plane.
    const toMs = Date.parse(query.to);
    const floor = toMs - DRIFT_RANGE_MAX_DAYS * 86_400_000;
    const capped = Date.parse(query.from) < floor;
    const from = capped ? new Date(floor).toISOString() : query.from;

    const series = await predictionLogSeries({
      model_id: modelId,
      model_version_id: production.id,
      from,
      to: query.to,
    });
    const reference = await resolveDriftReference(production.goldObjectKey);
    const thresholds = driftThresholds();
    const rowSeries = buildRowSeries(
      series.points,
      reference,
      DRIFT_TREND_MAX_POINTS,
    );
    const graded = gradeSeries(rowSeries, reference, thresholds);
    const hours = new Set(series.points.map((p) => p.timestamp.slice(0, 13)))
      .size;

    return {
      statusCode: 200,
      message: 'Input drift report fetched',
      type: 'SUCCESS' as const,
      data: {
        ...graded.report,
        // MODEL-SERVE-018-D05. A /predict payload carries no y.
        targetColumn: null,
        target: null,
        series: graded.series,
        basis: {
          plane: 'predict' as const,
          modelVersionId: production.id,
          version: production.version,
          from,
          to: query.to,
          windowsUsed: hours,
          capped,
          truncated: series.truncated,
          maxDays: DRIFT_RANGE_MAX_DAYS,
          missing: 0,
          healthWindows: HEALTH_WINDOWS,
          thresholds,
        },
      },
    };
  }
}
