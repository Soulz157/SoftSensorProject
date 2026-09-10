import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@softsensor/prisma';
import { AppException } from '@softsensor/common';
import { mintRunToken } from '@/lib/mint-run-token';
import {
  presignInferenceWindowObject,
  presignInferenceWindowUpload,
} from '@/lib/python-preprocess-client';
import { inferenceWindowKey } from '@/lib/artifact-keys';
import {
  formatDtHour,
  windowEndFor,
  windowStartsBetween,
} from '@/lib/inference-windows';
import { classifyDeployStatus } from '@/lib/deploy-status';
import { env } from '@/config/env.config';
import { ModelServingAuthorizedService } from '../../model-serving/authorized/model-serving.authorized.service';
import type {
  BackfillInferenceWindowsDto,
  InferenceWindowCompleteDto,
  InferenceWindowLogDto,
  InferenceWindowUploadUrlsDto,
  PutInferenceScheduleDto,
} from './dto/inference-window.authorized.dto';

const METRICS_FILENAME = 'metrics.json';
const PREDICTIONS_FILENAME = 'predictions.parquet';

// Same TTL shape as PREDICTION_JOB_TOKEN_TTL_MS — bounded work.
const INFERENCE_WINDOW_TOKEN_TTL_MS = env.INFERENCE_WINDOW_TOKEN_TTL_MS;

/**
 * MODEL-SERVE-006. Its own module, matching the one-feature-per-module
 * convention `prediction-job`/`model-version` already follow — a different
 * caller for the container routes (InferenceWindowTokenGuard) than the
 * schedule/list/status/backfill/retry routes (JWT), the same split
 * PredictionJobAuthorizedService keeps.
 */
@Injectable()
export class InferenceWindowAuthorizedService {
  private readonly log = new Logger(InferenceWindowAuthorizedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly descriptor: ModelServingAuthorizedService,
  ) {}

  // ── access ───────────────────────────────────────────────────────────────

  /** Editor-level — same rule every other mutating Model route applies.
   *  Mirrors `PredictionJobAuthorizedService.assertModelAccess` — a fourth
   *  copy following the established convention rather than a new shared
   *  helper for four call sites. */
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

  // ── schedule ─────────────────────────────────────────────────────────────

  async getScheduleService(modelId: string, user: Auth.UserPayload) {
    await this.assertModelAccess(modelId, user);
    const schedule = await this.prisma.inferenceSchedule.findUnique({
      where: { modelId },
    });
    return {
      statusCode: 200,
      message: 'Schedule',
      type: 'SUCCESS' as const,
      data: schedule
        ? {
            enabled: schedule.enabled,
            cadenceMinutes: schedule.cadenceMinutes,
            lagMinutes: schedule.lagMinutes,
            sourceId: schedule.sourceId,
            autoRetrain: schedule.autoRetrain,
            warnSd: schedule.warnSd,
            criticalSd: schedule.criticalSd,
            driftMonitor: schedule.driftMonitor,
            driftThresholdPct: schedule.driftThresholdPct,
          }
        : {
            enabled: false,
            cadenceMinutes: null,
            lagMinutes: null,
            sourceId: null,
            // MODEL-SERVE-006-T09. Defaults mirror the wizard atoms' own
            // defaults (store/model-pipeline.ts) exactly, so a model with
            // no schedule row yet shows the SAME starting values the
            // wizard itself would — never a second, silently different
            // default.
            autoRetrain: false,
            warnSd: 1.5,
            criticalSd: 3.0,
            driftMonitor: false,
            driftThresholdPct: 10,
          },
    };
  }

  /**
   * MODEL-SERVE-006-T09 (partial). D5: a schedule whose model needs the
   * target to build its own features cannot be scheduled at all — refused
   * HERE, at enable time, rather than per window, or a demoted model would
   * mint one SKIPPED row per cadence forever and the staleness alarm would
   * have to reason about a permanently-quiet schedule as if it were a
   * legitimate one.
   */
  async putScheduleService(
    modelId: string,
    dto: PutInferenceScheduleDto,
    user: Auth.UserPayload,
  ) {
    await this.assertModelAccess(modelId, user);

    if (!dto.enabled) {
      await this.prisma.inferenceSchedule.updateMany({
        where: { modelId },
        data: { enabled: false },
      });
      return {
        statusCode: 200,
        message: 'Schedule disabled',
        type: 'SUCCESS' as const,
      };
    }

    const version = await this.prisma.modelVersion.findFirst({
      where: { modelId, stage: 'PRODUCTION' },
      select: { id: true, sourceDatasetId: true },
    });
    if (!version) {
      throw new AppException({
        statusCode: 422,
        message: `Model ${modelId} has no PRODUCTION version. Cannot enable a schedule.`,
        type: 'ERROR',
      });
    }

    const descriptorResult =
      await this.descriptor.getDescriptorByVersionIdService(version.id);
    const d = descriptorResult.data;
    if (d.derivedFromTarget.length > 0) {
      throw new AppException({
        statusCode: 422,
        message:
          'This model derives feature(s) from the target, which arrives ' +
          'far later than a scheduled window — every window would be ' +
          'refused. Cannot schedule.',
        type: 'ERROR',
      });
    }
    if (d.targetScaled) {
      throw new AppException({
        statusCode: 422,
        message:
          'The target is scaled with no recorded inverse transform — ' +
          'cannot schedule.',
        type: 'ERROR',
      });
    }
    if (!d.featureColumns || d.featureColumns.length === 0) {
      throw new AppException({
        statusCode: 422,
        message: 'No recorded feature_columns — cannot schedule.',
        type: 'ERROR',
      });
    }

    const dataset = await this.prisma.dataset.findUnique({
      where: { id: version.sourceDatasetId },
      select: { sourceIds: true, pipelineConfig: true },
    });
    if (!dataset) {
      throw new AppException({
        statusCode: 404,
        message: `Source dataset ${version.sourceDatasetId} not found.`,
        type: 'ERROR',
      });
    }

    // D8: resolved off the PINNED version's own source dataset, never
    // Model.datasetId — live-verified those two can differ.
    let sourceId = dto.sourceId;
    if (!sourceId) {
      if (dataset.sourceIds.length !== 1) {
        throw new AppException({
          statusCode: 422,
          message: `This dataset has ${dataset.sourceIds.length} source(s) — sourceId is required.`,
          type: 'ERROR',
        });
      }
      sourceId = dataset.sourceIds[0];
    } else if (!dataset.sourceIds.includes(sourceId)) {
      throw new AppException({
        statusCode: 422,
        message: `sourceId ${sourceId} is not one of this dataset's sources.`,
        type: 'ERROR',
      });
    }

    const pipelineConfig = this.asRecord(dataset.pipelineConfig);
    const sourceFetchConfigs = this.asRecord(pipelineConfig.sourceFetchConfigs);
    const rawFetchConfig = sourceFetchConfigs[sourceId];
    if (!rawFetchConfig) {
      throw new AppException({
        statusCode: 422,
        message: `No fetch config recorded for source ${sourceId} on this dataset.`,
        type: 'ERROR',
      });
    }
    const fetchConfig = {
      ...this.asRecord(rawFetchConfig),
      baseTags: Array.isArray(pipelineConfig.baseTags)
        ? pipelineConfig.baseTags
        : [],
    };

    const cadenceMinutes =
      dto.cadenceMinutes ?? env.INFERENCE_DEFAULT_CADENCE_MINUTES;
    const lagMinutes = dto.lagMinutes ?? env.INFERENCE_DEFAULT_LAG_MINUTES;

    // MODEL-SERVE-006-T09. The wizard's five deploy fields, under their own
    // names — merged against the EXISTING row (not the request alone), so
    // a partial update (e.g. only flipping driftMonitor) does not silently
    // reset the other four to their defaults.
    const existing = await this.prisma.inferenceSchedule.findUnique({
      where: { modelId },
      select: {
        enabled: true,
        autoRetrain: true,
        warnSd: true,
        criticalSd: true,
        driftMonitor: true,
        driftThresholdPct: true,
      },
    });
    const autoRetrain = dto.autoRetrain ?? existing?.autoRetrain ?? false;
    const warnSd = dto.warnSd ?? existing?.warnSd ?? 1.5;
    const criticalSd = dto.criticalSd ?? existing?.criticalSd ?? 3.0;
    const driftMonitor = dto.driftMonitor ?? existing?.driftMonitor ?? false;
    const driftThresholdPct =
      dto.driftThresholdPct ?? existing?.driftThresholdPct ?? 10;
    // The DTO's own refine only catches both-in-one-request; a partial
    // update naming just one of the pair against an existing row that
    // would put them out of order must be caught here, against the FINAL
    // merged state.
    if (warnSd >= criticalSd) {
      throw new AppException({
        statusCode: 422,
        message: `warnSd (${warnSd}) must be less than criticalSd (${criticalSd}).`,
        type: 'ERROR',
      });
    }

    const wasEnabled = existing?.enabled ?? false;

    await this.prisma.inferenceSchedule.upsert({
      where: { modelId },
      create: {
        modelId,
        enabled: true,
        cadenceMinutes,
        lagMinutes,
        sourceId,
        fetchConfig,
        autoRetrain,
        warnSd,
        criticalSd,
        driftMonitor,
        driftThresholdPct,
        createdById: user.id,
      },
      update: {
        enabled: true,
        ...(dto.cadenceMinutes !== undefined && { cadenceMinutes }),
        ...(dto.lagMinutes !== undefined && { lagMinutes }),
        sourceId,
        fetchConfig,
        autoRetrain,
        warnSd,
        criticalSd,
        driftMonitor,
        driftThresholdPct,
      },
    });

    // MODEL-SERVE-006-T12. Provenance only — WHO turned this on and WHEN,
    // displayed on the model detail page and the models table
    // (deployedBy/deployedAt). Stamped only on the OFF -> ON transition,
    // not on every settings tweak, matching what "deployedAt" means on
    // every existing read site: when deploy STARTED, not when a threshold
    // was last edited.
    if (!wasEnabled) {
      await this.stampDeployed(modelId, user.id);
    }

    return {
      statusCode: 200,
      message: 'Schedule enabled',
      type: 'SUCCESS' as const,
      data: {
        cadenceMinutes,
        lagMinutes,
        sourceId,
        autoRetrain,
        warnSd,
        criticalSd,
        driftMonitor,
        driftThresholdPct,
      },
    };
  }

  /**
   * MODEL-SERVE-006-T12. `Model.data.deployedAt`/`deployedBy` provenance,
   * moved here from the old `updateModel(modelId, {deployStatus:'running'})`
   * write phase-6-deploy.tsx used to make (model.authorized.service.ts's
   * own `deployFields` branch, now removed) — the ENABLING of a schedule is
   * the new "deploy" action, so this is where that provenance belongs.
   * Merges into whatever `Model.data` already holds rather than
   * overwriting it, the same discipline `normalizeData`/`updateModelService`
   * apply to every other field on this JSON blob.
   */
  private async stampDeployed(modelId: string, userId: string): Promise<void> {
    const [model, actor] = await Promise.all([
      this.prisma.model.findUnique({
        where: { id: modelId },
        select: { data: true },
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { firstName: true, lastName: true },
      }),
    ]);
    const current =
      model?.data &&
      typeof model.data === 'object' &&
      !Array.isArray(model.data)
        ? (model.data as Record<string, unknown>)
        : {};
    const editorName = [actor?.firstName, actor?.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();
    await this.prisma.model.update({
      where: { id: modelId },
      data: {
        data: {
          ...current,
          deployedAt: new Date().toISOString(),
          ...(editorName && { deployedBy: editorName }),
        },
      },
    });
  }

  // ── windows / status / backfill / retry ─────────────────────────────────

  /** T01's own acceptance criterion: "every window is queryable by its own
   *  boundaries, and windows that did not succeed are listable as gaps." */
  async listWindowsService(
    modelId: string,
    query: { status?: string; from?: string; to?: string },
    user: Auth.UserPayload,
  ) {
    await this.assertModelAccess(modelId, user);
    const windows = await this.prisma.inferenceWindow.findMany({
      where: {
        modelId,
        ...(query.status && { status: query.status as never }),
        ...((query.from || query.to) && {
          windowStart: {
            ...(query.from && { gte: new Date(query.from) }),
            ...(query.to && { lt: new Date(query.to) }),
          },
        }),
      },
      orderBy: { windowStart: 'desc' },
      take: 500,
    });
    return {
      statusCode: 200,
      message: 'Inference windows',
      type: 'SUCCESS' as const,
      data: windows,
    };
  }

  /**
   * T10. Derived, no column. STALE when no window has reached SUCCEEDED or
   * SKIPPED within INFERENCE_STALE_AFTER_CADENCES cadences — SKIPPED
   * proves the record is still being written (a quiet plant, not an
   * incident) without ever counting as a live prediction.
   */
  async getStatusService(modelId: string, user: Auth.UserPayload) {
    await this.assertModelAccess(modelId, user);
    const schedule = await this.prisma.inferenceSchedule.findUnique({
      where: { modelId },
    });
    if (!schedule) {
      return {
        statusCode: 200,
        message: 'No schedule',
        type: 'SUCCESS' as const,
        data: {
          enabled: false,
          cadenceMinutes: null,
          lastSucceededAt: null,
          lastTerminalAt: null,
          gapCount: 0,
          staleness: 'OK' as const,
          failing: false,
          deployStatus: classifyDeployStatus({
            enabled: false,
            hasEverSucceeded: false,
            staleness: 'OK',
            failing: false,
          }),
        },
      };
    }

    const lastSucceeded = await this.prisma.inferenceWindow.findFirst({
      where: { modelId, status: { in: ['SUCCEEDED', 'SKIPPED'] } },
      orderBy: { windowStart: 'desc' },
      select: { windowStart: true },
    });
    const lastTerminal = await this.prisma.inferenceWindow.findFirst({
      where: { modelId, status: { in: ['SUCCEEDED', 'SKIPPED', 'FAILED'] } },
      orderBy: { windowStart: 'desc' },
      select: { windowStart: true, status: true },
    });
    const gapCount = await this.prisma.inferenceWindow.count({
      where: { modelId, status: { notIn: ['SUCCEEDED', 'SKIPPED'] } },
    });

    const staleAfterMs =
      env.INFERENCE_STALE_AFTER_CADENCES * schedule.cadenceMinutes * 60_000;
    const staleness: 'OK' | 'STALE' =
      !lastSucceeded ||
      Date.now() - lastSucceeded.windowStart.getTime() > staleAfterMs
        ? 'STALE'
        : 'OK';

    // `failing`: reported separately so a failing schedule is never
    // laundered as merely stale — the last few terminal windows are ALL
    // FAILED, not merely absent.
    const recentTerminal = await this.prisma.inferenceWindow.findMany({
      where: { modelId, status: { in: ['SUCCEEDED', 'SKIPPED', 'FAILED'] } },
      orderBy: { windowStart: 'desc' },
      take: 3,
      select: { status: true },
    });
    const failing =
      recentTerminal.length >= 3 &&
      recentTerminal.every((w) => w.status === 'FAILED');

    return {
      statusCode: 200,
      message: 'Inference status',
      type: 'SUCCESS' as const,
      data: {
        enabled: schedule.enabled,
        cadenceMinutes: schedule.cadenceMinutes,
        lastSucceededAt: lastSucceeded?.windowStart ?? null,
        lastTerminalAt: lastTerminal?.windowStart ?? null,
        gapCount,
        staleness,
        failing,
        // MODEL-SERVE-006-T12. Same classifyDeployStatus every model list/
        // get response now uses (lib/deploy-status.ts) — one state machine,
        // not a second one that could disagree with what the models list
        // shows for this same model.
        deployStatus: classifyDeployStatus({
          enabled: schedule.enabled,
          hasEverSucceeded: lastSucceeded !== null,
          staleness,
          failing,
        }),
      },
    };
  }

  /**
   * T11. A range request inserts PENDING rows for windows that have none —
   * the SAME `createMany({ skipDuplicates: true })` the tick itself uses,
   * through the SAME `windowStartsBetween` helper, so the worker cannot
   * distinguish backfill from live. Over-requesting a range is harmless.
   */
  async backfillService(
    modelId: string,
    dto: BackfillInferenceWindowsDto,
    user: Auth.UserPayload,
  ) {
    await this.assertModelAccess(modelId, user);
    const schedule = await this.prisma.inferenceSchedule.findUnique({
      where: { modelId },
    });
    if (!schedule) {
      throw new AppException({
        statusCode: 404,
        message: `Model ${modelId} has no inference schedule.`,
        type: 'ERROR',
      });
    }
    const version = await this.prisma.modelVersion.findFirst({
      where: { modelId, stage: 'PRODUCTION' },
      select: { id: true },
    });
    if (!version) {
      throw new AppException({
        statusCode: 422,
        message: `Model ${modelId} has no PRODUCTION version.`,
        type: 'ERROR',
      });
    }

    const from = new Date(dto.from);
    const to = new Date(dto.to);
    const starts = windowStartsBetween(from, to, schedule.cadenceMinutes);
    const tokenExpiresAt = new Date(Date.now() + INFERENCE_WINDOW_TOKEN_TTL_MS);

    const result = await this.prisma.inferenceWindow.createMany({
      data: starts.map((windowStart) => ({
        modelId,
        modelVersionId: version.id,
        windowStart,
        windowEnd: windowEndFor(windowStart, schedule.cadenceMinutes),
        status: 'PENDING' as const,
        tokenHash: mintRunToken().tokenHash,
        tokenExpiresAt,
      })),
      skipDuplicates: true,
    });

    return {
      statusCode: 201,
      message: `Requested ${starts.length} window(s); ${result.count} newly inserted.`,
      type: 'SUCCESS' as const,
      data: { requested: starts.length, inserted: result.count },
    };
  }

  /** D9: FAILED is terminal; a retry is explicit and carries `attempts`
   *  forward — the same carry-forward `LoaderJobService.retry` uses. */
  async retryService(
    modelId: string,
    windowId: string,
    user: Auth.UserPayload,
  ) {
    await this.assertModelAccess(modelId, user);
    const window = await this.prisma.inferenceWindow.findFirst({
      where: { id: windowId, modelId },
    });
    if (!window) {
      throw new AppException({
        statusCode: 404,
        message: 'Inference window not found',
        type: 'ERROR',
      });
    }
    if (window.status !== 'FAILED') {
      throw new AppException({
        statusCode: 409,
        message: 'Only a FAILED window can be retried.',
        type: 'ERROR',
      });
    }

    const { tokenHash } = mintRunToken();
    await this.prisma.inferenceWindow.update({
      where: { id: windowId },
      data: {
        status: 'PENDING',
        failureReason: null,
        containerId: null,
        startedAt: null,
        finishedAt: null,
        tokenHash,
        tokenExpiresAt: new Date(Date.now() + INFERENCE_WINDOW_TOKEN_TTL_MS),
      },
    });
    return {
      statusCode: 200,
      message: 'Window queued for retry',
      type: 'SUCCESS' as const,
    };
  }

  async listLogsService(
    modelId: string,
    windowId: string,
    user: Auth.UserPayload,
  ) {
    await this.assertModelAccess(modelId, user);
    const window = await this.prisma.inferenceWindow.findFirst({
      where: { id: windowId, modelId },
      select: { id: true },
    });
    if (!window) {
      throw new AppException({
        statusCode: 404,
        message: 'Inference window not found',
        type: 'ERROR',
      });
    }
    const logs = await this.prisma.inferenceWindowLog.findMany({
      where: { windowId },
      orderBy: { createdAt: 'asc' },
    });
    return {
      statusCode: 200,
      message: 'Window logs',
      type: 'SUCCESS' as const,
      data: logs,
    };
  }

  // ── container-facing (InferenceWindowTokenGuard) ────────────────────────

  /** Mirrors `claimJobService`'s shape one entity over: everything the
   *  infer-mode container needs to load its PINNED model version and score
   *  its already-materialized input, in one round trip. */
  async claimService(windowId: string) {
    const window = await this.prisma.inferenceWindow.findUniqueOrThrow({
      where: { id: windowId },
    });
    if (!window.inputKey || !window.inputChecksum) {
      throw new AppException({
        statusCode: 409,
        message: 'Window has no materialized input yet.',
        type: 'ERROR',
      });
    }

    const descriptorResult =
      await this.descriptor.getDescriptorByVersionIdService(
        window.modelVersionId,
      );
    const d = descriptorResult.data;

    const inputPresigned = await presignInferenceWindowObject({
      source_key: window.inputKey,
    });

    return {
      modelId: d.modelId,
      modelVersionId: d.versionId,
      modelUrl: d.modelUrl,
      modelChecksum: d.modelChecksum,
      inputUrl: inputPresigned.data_url,
      inputChecksum: window.inputChecksum,
      featureColumns: d.featureColumns,
      scalers: d.scalers,
      scalingParams: d.scalingParams,
      windowStart: window.windowStart.toISOString(),
      windowEnd: window.windowEnd.toISOString(),
    };
  }

  /**
   * Persisted, unlike PredictionJob's console-only echo — this feature's
   * own acceptance criteria require per-window logs readable AFTER the
   * container exits, matching ModelTrainingRunLog's role for training.
   */
  async logService(
    windowId: string,
    dto: InferenceWindowLogDto,
  ): Promise<void> {
    await this.prisma.inferenceWindowLog.create({
      data: {
        windowId,
        level: dto.level,
        message: dto.message.slice(0, 4000),
      },
    });
  }

  async uploadUrlsService(windowId: string, dto: InferenceWindowUploadUrlsDto) {
    const window = await this.prisma.inferenceWindow.findUniqueOrThrow({
      where: { id: windowId },
    });
    const { dt, hour } = formatDtHour(window.windowStart);
    return presignInferenceWindowUpload({
      model_id: window.modelId,
      model_version_id: window.modelVersionId,
      dt,
      hour,
      filenames: dto.filenames,
    });
  }

  /** `predictionsKey` is built HERE, server-side, from the window's own
   *  ids — never trusted from the container's request body, matching
   *  `completeJobService`'s `predictionJobKey(...)` discipline one entity
   *  over. */
  async completeService(windowId: string, dto: InferenceWindowCompleteDto) {
    const window = await this.prisma.inferenceWindow.findUniqueOrThrow({
      where: { id: windowId },
    });

    if (dto.status === 'FAILED') {
      await this.prisma.inferenceWindow.update({
        where: { id: windowId },
        data: {
          status: 'FAILED',
          failureReason: dto.failureReason,
          finishedAt: new Date(),
          tokenExpiresAt: new Date(0),
        },
      });
      return { statusCode: 200, message: 'Recorded', type: 'SUCCESS' as const };
    }

    const { dt, hour } = formatDtHour(window.windowStart);
    const predictionsKey = inferenceWindowKey(
      window.modelId,
      window.modelVersionId,
      dt,
      hour,
      PREDICTIONS_FILENAME,
    );
    const metricsKey = dto.uploaded?.includes(METRICS_FILENAME)
      ? inferenceWindowKey(
          window.modelId,
          window.modelVersionId,
          dt,
          hour,
          METRICS_FILENAME,
        )
      : null;

    await this.prisma.inferenceWindow.update({
      where: { id: windowId },
      data: {
        status: 'SUCCEEDED',
        predictionsKey,
        metricsKey,
        finishedAt: new Date(),
        tokenExpiresAt: new Date(0),
      },
    });
    return { statusCode: 200, message: 'Recorded', type: 'SUCCESS' as const };
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }
}
