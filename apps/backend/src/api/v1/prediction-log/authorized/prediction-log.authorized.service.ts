import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService, PrismaTypes } from '@softsensor/prisma';
import { AppException } from '@softsensor/common';
import { env } from '@/config/env.config';
import {
  appendPredictionLog,
  predictionLogSeries,
} from '@/lib/python-preprocess-client';
import {
  applyConsecutiveBreachRule,
  computeDrift,
  poolFeatureStats,
  type FeatureStatsMap,
} from '@/lib/prediction-drift';
import {
  computePsi,
  poolHistograms,
  PSI_EPSILON,
  type FeatureHistogramMap,
} from '@/lib/prediction-psi';
import {
  resolveColumnBaseline,
  resolvePsiReference,
} from '@/lib/artifact-baseline';
import { InferenceWindowMonitoringService } from '@/api/v1/inference-window/authorized/inference-window-monitoring.authorized.service';
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

  constructor(
    private readonly prisma: PrismaService,
    // MODEL-SERVE-001-T17. `getDriftService`/`getPsiService` dispatch to
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
   * MODEL-SERVE-005-T02. The current PRODUCTION version's live inputs,
   * pooled from PredictionLog's own sufficient-statistics aggregates over
   * [from, to], compared against the training artifact's own
   * column_stats.json — never a separately-computed baseline (the
   * acceptance criterion this ledger states verbatim).
   *
   * MODEL-SERVE-001-T17. PLANE DISPATCH, decided with the user 2026-09-15:
   * a model with an InferenceSchedule reads `InferenceWindow.featureStats`
   * instead — the SAME reason MODEL-SERVE-001-T10 had to state on the
   * client (`DriftPanel`'s own empty-state copy): `PredictionLog` is
   * written by `/predict` ONLY, so a scheduled-only model's PredictionLog
   * is empty BY CONSTRUCTION, and everything below this check would
   * correctly compute nothing forever. See `InferenceWindowMonitoring
   * Service.hasSchedule`'s own doc comment for the full rule. Everything
   * from here down is the ORIGINAL, UNCHANGED `/predict`-plane
   * implementation — reached only for a model with no schedule.
   */
  async getDriftService(
    modelId: string,
    query: PredictionLogRangeQueryDto,
    user: Auth.UserPayload,
  ) {
    await this.assertModelAccess(modelId, user);

    if (await this.windowMonitoring.hasSchedule(modelId)) {
      return this.windowMonitoring.getDriftReport(
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

    const baseline = await resolveColumnBaseline(production.goldObjectKey);

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
          // MODEL-SERVE-001-T17. Named on every basis, on both planes —
          // see InferenceWindowMonitoringService's own basisOf for the
          // window-plane counterpart.
          plane: 'predict' as const,
          // The thresholds `computeDrift` was ACTUALLY called with, echoed
          // for the same reason `PsiReport.basis.thresholds` already is
          // (see its own doc comment): the panel now explains a verdict by
          // naming the number that produced it, and a client-side literal
          // would silently disagree with this service the moment
          // DRIFT_WARN_SD moves. Additive — no existing reader breaks.
          thresholds: {
            warnSd: env.DRIFT_WARN_SD,
            criticalSd: env.DRIFT_CRITICAL_SD,
            outOfRangePct: env.DRIFT_OUT_OF_RANGE_PCT,
          },
        },
      },
    };
  }

  /**
   * MODEL-SERVE-008-T03. The DENSE drift signal — the same z-score, the same
   * thresholds, evaluated per short bucket and gated by a consecutive-breach
   * rule.
   *
   * ITS OWN ROUTE, NEVER A REPLACEMENT FOR `/drift`. `getDriftService`
   * dispatches on InferenceSchedule ROW PRESENCE (MODEL-SERVE-001-T17, whose
   * tests assert PredictionLog is never touched when a schedule exists) and
   * that dispatch is deliberately unchanged: a model running BOTH planes
   * keeps a window-plane drift panel that answers exactly the question its
   * caption claims. Folding a 10-minute signal into that hourly table would
   * put two metrics with different cadences in one place, which
   * MODEL-SERVE-001-T16 already refused for PSI. Two readouts, two cadences,
   * two captions.
   *
   * WHY BUCKETS AND NOT ONE POOL: pooling the whole range into a single
   * `computeDrift` answers "was the average of this range drifted", which
   * hides a breach that started twenty minutes ago inside hours of healthy
   * traffic. Bucketing at the model's own live cadence is what makes
   * "sustained right now" a question the data can answer at all.
   *
   * THE BASELINE IS THE SAME SIDECAR THE WINDOW PLANE READS — `resolve
   * ColumnBaseline` over the production version's own `goldObjectKey`. T17
   * extracted it for exactly this: a second plane reads the identical
   * sidecar the identical way, so the two signals can never disagree about
   * what "training distribution" means. NOTE THE DILUTION IT INHERITS
   * (MODEL-SERVE-001-T13, measured): `column_stats.json` spans the WHOLE
   * committed artifact rather than the train split, so the reference is
   * systematically wider and this signal UNDER-flags. A denser cadence does
   * not fix that and this endpoint must not be described as more sensitive
   * than it is.
   */
  async getLiveDriftService(
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

    const schedule = await this.prisma.inferenceSchedule.findUnique({
      where: { modelId },
      select: { livePredictEnabled: true, livePredictCadenceMinutes: true },
    });

    const rows = await this.prisma.predictionLog.findMany({
      where: {
        modelVersionId: production.id,
        requestedAt: { gte: new Date(query.from), lte: new Date(query.to) },
      },
      select: { featureStats: true, requestedAt: true },
      orderBy: { requestedAt: 'asc' },
    });

    const baseline = await resolveColumnBaseline(production.goldObjectKey);
    const thresholds = {
      warnSd: env.DRIFT_WARN_SD,
      criticalSd: env.DRIFT_CRITICAL_SD,
      outOfRangePct: env.DRIFT_OUT_OF_RANGE_PCT,
    };

    // One bucket per live cadence, so a "consecutive bucket" means one
    // scoring interval and the rule counts the thing the operator set.
    const bucketMs =
      Math.max(1, schedule?.livePredictCadenceMinutes ?? 10) * 60_000;
    const byBucket = new Map<number, FeatureStatsMap[]>();
    for (const row of rows) {
      const slot = Math.floor(row.requestedAt.getTime() / bucketMs) * bucketMs;
      const list = byBucket.get(slot) ?? [];
      list.push(row.featureStats as unknown as FeatureStatsMap);
      byBucket.set(slot, list);
    }

    // Oldest-first: `applyConsecutiveBreachRule` reads from the NEWEST
    // backwards, because the question is "is this breach sustained right
    // now", never "was there ever a run of breaches in this range".
    const buckets = [...byBucket.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([slot, stats]) => ({
        at: new Date(slot).toISOString(),
        report: computeDrift(poolFeatureStats(stats), baseline, thresholds),
      }));

    const report = applyConsecutiveBreachRule(
      buckets,
      env.LIVE_DRIFT_CONSECUTIVE_BREACHES,
    );

    return {
      statusCode: 200,
      message: 'Live drift report fetched',
      type: 'SUCCESS' as const,
      data: {
        ...report,
        basis: {
          modelVersionId: production.id,
          version: production.version,
          goldArtifactId: production.goldArtifactId,
          goldObjectKey: production.goldObjectKey,
          sampleRequests: rows.length,
          bucketMinutes: bucketMs / 60_000,
          // So a reader can tell "no breach" from "the driver is off and
          // this readout is describing nothing".
          livePredictEnabled: schedule?.livePredictEnabled ?? false,
          from: query.from,
          to: query.to,
          // A THIRD plane label, not a reuse of 'predict': these are the
          // same rows as /drift's predict plane but evaluated on a
          // different cadence under a different rule, and a caller that
          // cannot tell them apart will eventually render one as the other.
          plane: 'predict-live' as const,
        },
      },
    };
  }

  /**
   * MODEL-SERVE-001-T13. The second drift metric, published ALONGSIDE
   * `getDriftService`'s z-score, never replacing it — same `[from, to]`
   * query contract as `/drift`, the SAME `PredictionLog` rows (pooled
   * differently: `featureHistograms`, not `featureStats`), the SAME
   * PRODUCTION-version resolution. SEPARATE CADENCE (T13's own resolved
   * openDecision #2): PSI needs `binCount * PSI_MIN_SAMPLES_PER_BIN` live
   * samples before a figure is even computed, which one z-score request's
   * `[from, to]` will often not clear — the CALLER is expected to request a
   * wider range (the client defaults this to a rolling 24h window; this
   * endpoint itself enforces no particular range, only the sample floor).
   *
   * MODEL-SERVE-001-T17. PLANE DISPATCH — see `getDriftService`'s own doc
   * comment immediately above for the full rule and its reason; identical
   * here. Everything from here down is the ORIGINAL, UNCHANGED `/predict`-
   * plane implementation, reached only for a model with no schedule.
   */
  async getPsiService(
    modelId: string,
    query: PredictionLogRangeQueryDto,
    user: Auth.UserPayload,
  ) {
    await this.assertModelAccess(modelId, user);

    if (await this.windowMonitoring.hasSchedule(modelId)) {
      return this.windowMonitoring.getPsiReport(modelId, query.from, query.to);
    }

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
      select: { featureHistograms: true },
    });

    // `featureHistograms` is nullable at the ROW level (a request logged
    // before T13, or served under a spec that predated it) — `null` here,
    // never an object with per-tag nulls inside it. Filtered out BEFORE
    // `poolHistograms`, which expects every array entry to be an object it
    // can `Object.entries` over; passing a bare `null` through would throw.
    const histograms = rows
      .map((r) => r.featureHistograms)
      .filter((h): h is NonNullable<typeof h> => h !== null);

    const pooled = poolHistograms(
      histograms.map((h) => h as unknown as FeatureHistogramMap),
    );

    const reference = await resolvePsiReference(production.goldObjectKey);

    const report = computePsi(pooled, reference, {
      warn: env.PSI_WARN,
      critical: env.PSI_CRITICAL,
      minSamplesPerBin: env.PSI_MIN_SAMPLES_PER_BIN,
    });

    return {
      statusCode: 200,
      message: 'PSI report fetched',
      type: 'SUCCESS' as const,
      data: {
        ...report,
        basis: {
          modelVersionId: production.id,
          version: production.version,
          goldArtifactId: production.goldArtifactId,
          goldObjectKey: production.goldObjectKey,
          // MODEL-SERVE-001-T16. `rows.length` is captured BEFORE the
          // null-`featureHistograms` filter above — it overstates what
          // actually fed `poolHistograms`. Kept for parity with `/drift`'s
          // own `sampleRequests`; `histogramRequests` below is the honest
          // figure a "computed over" readout should actually print.
          sampleRequests: rows.length,
          histogramRequests: histograms.length,
          from: query.from,
          to: query.to,
          // T16: the env-derived thresholds/epsilon `computePsi` was just
          // called with, so the screen's own disclaimer reads real
          // config rather than a literal that silently drifts from it.
          thresholds: {
            warn: env.PSI_WARN,
            critical: env.PSI_CRITICAL,
            minSamplesPerBin: env.PSI_MIN_SAMPLES_PER_BIN,
          },
          // MODEL-SERVE-001-T17. Named on every basis, on both planes —
          // see InferenceWindowMonitoringService's own basisOf for the
          // window-plane counterpart.
          plane: 'predict' as const,
          epsilon: PSI_EPSILON,
        },
      },
    };
  }
}
