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
  deriveMinRows,
  formatDtHour,
  windowEndFor,
  windowStartsBetween,
} from '@/lib/inference-windows';
import { classifyDeployStatus, isStale } from '@/lib/deploy-status';
import { redactUrls } from '@/lib/redact-urls';
import { computeLiveError, poolTruthStats } from '@/lib/live-error';
import { inferenceWindowTruthSeries } from '@/lib/python-preprocess-client';
import { env } from '@/config/env.config';
import { ModelServingAuthorizedService } from '../../model-serving/authorized/model-serving.authorized.service';
import { InferenceTruthSweeperService } from './inference-truth-sweeper.service';
import { InferenceWindowMonitoringService } from './inference-window-monitoring.authorized.service';
import { ModelInputStatusAuthorizedService } from '../../model-version/authorized/model-input-status.authorized.service';
import type {
  BackfillInferenceWindowsDto,
  InferenceTruthRangeQueryDto,
  RejoinInferenceTruthDto,
  InferenceWindowCompleteDto,
  InferenceWindowLogDto,
  InferenceWindowUploadUrlsDto,
  PutInferenceScheduleDto,
} from './dto/inference-window.authorized.dto';

const METRICS_FILENAME = 'metrics.json';
const PREDICTIONS_FILENAME = 'predictions.parquet';

/**
 * MODEL-SERVE-001-T10. The same 500 the training-run read
 * (`model-run-launch.authorized.service.ts`) and `listWindowsService` both
 * cap at, but taken from the OPPOSITE end — see `listLogsService`.
 */
const WINDOW_LOG_LIMIT = 500;

/** The peek (`models/views`' Console) holds a Model, never a window id. */
const LATEST_WINDOW = 'latest';

/**
 * Never a bare `findFirst` here: `InferenceWindow.tokenHash` is the
 * container's own bearer credential, and an explicit field list is what
 * keeps it off a client-facing response by construction rather than by
 * review. Same reason `getRunService` reaches for `omit: { tokenHash }`.
 */
/** `ModelVersion.promotionOverride` is `Json?` shaped
 *  `{actorId, actorName, reason, at}` (T06). Narrow it rather than trusting
 *  the column, and redact: the reason is operator-authored free text on a
 *  read boundary. */
function overrideReasonOf(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const reason = (value as { reason?: unknown }).reason;
  return typeof reason === 'string' ? redactUrls(reason) : null;
}

const WINDOW_LOG_CONTEXT_SELECT = {
  id: true,
  status: true,
  windowStart: true,
  windowEnd: true,
  inputRows: true,
  missingPct: true,
  imageDigest: true,
  // VERIFIED LIVE 2026-09-14 against TM2: 20 of its 50 FAILED windows have a
  // `containerId` and a `startedAt` while `imageDigest` is STILL NULL. So
  // imageDigest is not the "did a container run" discriminator the schema
  // comment reads like — containerId is. Using the wrong one tells an
  // operator "no container" about 20 windows that had one.
  containerId: true,
  failureReason: true,
  attempts: true,
  startedAt: true,
  finishedAt: true,
} as const;

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
    private readonly truthSweeper: InferenceTruthSweeperService,
    // MODEL-SERVE-001-T21. Same module, no cycle: InferenceWindowMonitoring
    // Service's own constructor only takes PrismaService, so this is a
    // plain one-directional DI edge, not the cross-module kind this
    // module's own export comment already reasons about.
    private readonly monitoring: InferenceWindowMonitoringService,
    // MODEL-SERVE-001-T25. T15's live probe, reused for the enable-time
    // preflight. Cross-module (ModelVersionModule exports it) and acyclic —
    // see this module's own import comment.
    private readonly inputStatus: ModelInputStatusAuthorizedService,
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
            // MODEL-SERVE-001-T28. Echoed so a settings surface can read
            // back what it wrote. API-settable today with no editor yet —
            // see this task's own ledger note.
            missingPctWarn: schedule.missingPctWarn,
            missingPctAlert: schedule.missingPctAlert,
            skipStreakAlert: schedule.skipStreakAlert,
            frozenWindows: schedule.frozenWindows,
            frozenTolerancePct: schedule.frozenTolerancePct,
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
            // T28, the SAME defaults the schema and the merge above use —
            // never a second, silently different set.
            missingPctWarn: 5,
            missingPctAlert: 20,
            skipStreakAlert: 3,
            frozenWindows: 3,
            frozenTolerancePct: 0,
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
      // MODEL-SERVE-001-T20. Disabling only stopped FUTURE dispatch (T19's
      // own fix scopes dispatchDue's claim to enabled schedules) — it left
      // whatever was already PENDING sitting there forever, permanently
      // inflating gapCount and, on re-enable, dispatching newest-first
      // ahead of nothing since the token is re-minted at spawn time, not
      // checked for staleness. CANCELED only, never RUNNING: a spawned
      // container is already in flight and stays owned by the reconcile
      // sweep. One transaction so a disable can never record as having
      // happened while its queued rows are left stranded PENDING.
      const [, canceled] = await this.prisma.$transaction([
        this.prisma.inferenceSchedule.updateMany({
          where: { modelId },
          data: { enabled: false },
        }),
        this.prisma.inferenceWindow.updateMany({
          where: { modelId, status: 'PENDING' },
          data: {
            status: 'CANCELED',
            failureReason:
              'Schedule stopped before this window was dispatched.',
            finishedAt: new Date(),
            tokenExpiresAt: new Date(0),
          },
        }),
      ]);
      return {
        statusCode: 200,
        message: `Schedule disabled (${canceled.count} queued window(s) canceled)`,
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
    const rawFetchConfigRecord = this.asRecord(rawFetchConfig);
    const fetchConfig = {
      ...rawFetchConfigRecord,
      baseTags: Array.isArray(pipelineConfig.baseTags)
        ? pipelineConfig.baseTags
        : [],
    };

    const cadenceMinutes =
      dto.cadenceMinutes ?? env.INFERENCE_DEFAULT_CADENCE_MINUTES;
    const lagMinutes = dto.lagMinutes ?? env.INFERENCE_DEFAULT_LAG_MINUTES;

    // MODEL-SERVE-001-T14. Per-schedule "too few usable rows -> SKIPPED"
    // floor, replacing the GLOBAL env.INFERENCE_MIN_ROWS every schedule was
    // evaluated against before this task — that constant assumes a
    // 1-minute sampling interval, which is wrong for any schedule fetching
    // at a different one. Recomputed on EVERY enable/update, unconditionally
    // (never merged against `existing`, unlike autoRetrain/warnSd/etc.
    // above): `fetchConfig`/`sourceId` are themselves always freshly
    // resolved from the dataset's CURRENT pipelineConfig on every call, so
    // a derived-from-fetchConfig value must track that same freshness, not
    // freeze at whatever interval happened to be recorded the first time
    // the schedule was enabled. `deriveMinRows` returns null — never a
    // wrong guess — for a non-PI source (no `intervalTime` concept at all)
    // or an unparseable one, in which case this falls back to the exact
    // same global default every schedule already used, never a fabricated
    // per-schedule number.
    const intervalTime =
      typeof rawFetchConfigRecord.intervalTime === 'string'
        ? rawFetchConfigRecord.intervalTime
        : undefined;
    const minRows =
      deriveMinRows(cadenceMinutes, intervalTime) ?? env.INFERENCE_MIN_ROWS;

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
        truthLagMinutes: true,
        truthToleranceMinutes: true,
        truthHorizonHours: true,
        missingPctWarn: true,
        missingPctAlert: true,
        skipStreakAlert: true,
        frozenWindows: true,
        frozenTolerancePct: true,
      },
    });
    const autoRetrain = dto.autoRetrain ?? existing?.autoRetrain ?? false;
    const warnSd = dto.warnSd ?? existing?.warnSd ?? 1.5;
    const criticalSd = dto.criticalSd ?? existing?.criticalSd ?? 3.0;
    const driftMonitor = dto.driftMonitor ?? existing?.driftMonitor ?? false;
    const driftThresholdPct =
      dto.driftThresholdPct ?? existing?.driftThresholdPct ?? 10;
    // MODEL-SERVE-005-T03, merged the same way and for the same reason: a
    // partial update flipping one field must not reset the ground-truth
    // settings to their defaults behind the caller's back.
    const truthLagMinutes =
      dto.truthLagMinutes ?? existing?.truthLagMinutes ?? 1440;
    const truthToleranceMinutes =
      dto.truthToleranceMinutes ?? existing?.truthToleranceMinutes ?? 30;
    const truthHorizonHours =
      dto.truthHorizonHours ?? existing?.truthHorizonHours ?? 168;
    // MODEL-SERVE-001-T28, merged the same way and for the same reason: a
    // partial update flipping one band must not reset the other four behind
    // the caller's back.
    const missingPctWarn = dto.missingPctWarn ?? existing?.missingPctWarn ?? 5;
    const missingPctAlert =
      dto.missingPctAlert ?? existing?.missingPctAlert ?? 20;
    const skipStreakAlert =
      dto.skipStreakAlert ?? existing?.skipStreakAlert ?? 3;
    const frozenWindows = dto.frozenWindows ?? existing?.frozenWindows ?? 3;
    const frozenTolerancePct =
      dto.frozenTolerancePct ?? existing?.frozenTolerancePct ?? 0;
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
    // T28, the same check against the same MERGED state, for the same reason.
    if (missingPctWarn >= missingPctAlert) {
      throw new AppException({
        statusCode: 422,
        message: `missingPctWarn (${missingPctWarn}) must be less than missingPctAlert (${missingPctAlert}).`,
        type: 'ERROR',
      });
    }

    const wasEnabled = existing?.enabled ?? false;

    // MODEL-SERVE-001-T25. THE NINTH ENABLE-TIME REFUSAL, and the first that
    // asks the outside world a question instead of reading recorded state.
    //
    // THE MEASURED SYMPTOM: T19 read TM2's live rows and found 70 FAILED
    // windows, every one reading "Materialize failed: Could not read the
    // source...", and NOT ONE of them ever spawned a container — the raise
    // happens before runner.spawn. The source was unreachable when someone
    // pressed Start and nothing asked.
    //
    // WHY A REFUSAL AND NOT AN AUTO-HALT: this does NOT reverse T19's
    // "status only, no backoff, no circuit breaker" decision. That decision
    // refused to auto-PAUSE a schedule already running; this refuses the
    // press that starts one. Different boundary, and the failure class
    // behind T19's decision (PI resolving NXDOMAIN for a period) is exactly
    // why a refusal the operator can retry is safe where an auto-disable was
    // not. Rejected alternatives, both recorded on T25: enable-then-auto-halt
    // (needs halt semantics and a re-enable path nobody asked for), and
    // insert-but-do-not-dispatch (leaves PENDING rows whose policy T20 has
    // not settled).
    //
    // ORDER MATTERS AND IS NOT INCIDENTAL: the evidence write happens FIRST
    // and the throw second, so a failed probe never reaches the `upsert`
    // below. There is therefore no window in which a schedule is enabled
    // while its own preflight says it should not be — and no transaction
    // spanning a throw. The evidence row is written with `update`, not
    // `upsert`: a first enable that fails preflight must leave NO schedule
    // row at all, or T20's sweep and `deriveDeployStatuses` both inherit a
    // disabled ghost that no operator created.
    // SCOPED TO THE OFF -> ON TRANSITION, exactly like stampDeployed below,
    // and this is load-bearing rather than tidy. This same method serves a
    // PARTIAL SETTINGS UPDATE on an already-running schedule (that is what
    // T09's merge logic above exists for). Probing on those calls would mean:
    // operator nudges driftThresholdPct, PI blips for thirty seconds, the
    // update is refused AND `preflightOk: false` is written to a row that
    // stays `enabled: true` and whose windows keep succeeding — pinning a
    // demonstrably working model to Failed forever, since only a later
    // successful enable would clear it.
    //
    // That is the "deployStatus asserts something untrue" defect T12's module
    // was built to remove, re-introduced through a new field. It also crosses
    // the line T25's own openDecision drew: refusing the press that STARTS a
    // schedule is in scope, condemning one that is already RUNNING is the
    // auto-pause T19 decided against.
    const preflight = wasEnabled
      ? { ok: null, reason: null }
      : await this.inputStatus.preflightSourceService(modelId, user, sourceId);
    if (preflight.ok === false) {
      // No `if (existing)` guard needed: this branch is unreachable when
      // `wasEnabled`, and a first enable's refusal must leave NO row behind
      // for T20's sweep or deriveDeployStatuses to inherit.
      if (existing) {
        await this.prisma.inferenceSchedule.update({
          where: { modelId },
          data: {
            preflightAt: new Date(),
            preflightOk: false,
            preflightReason: preflight.reason,
          },
        });
      }
      this.log.warn(
        `preflight refused enable for model ${modelId} via source ${sourceId}: ${preflight.reason}`,
      );
      throw new AppException({
        statusCode: 422,
        // The connector's OWN TEXT, verbatim. V09 exists precisely because a
        // guessed category sent a reader to audit a config that was already
        // correct. Redaction is the READ boundary's job (see getStatusService)
        // — never here, or the server log loses the evidence too.
        message: `Cannot start: ${preflight.reason}`,
        type: 'ERROR',
      });
    }

    await this.prisma.inferenceSchedule.upsert({
      where: { modelId },
      create: {
        modelId,
        enabled: true,
        cadenceMinutes,
        lagMinutes,
        minRows,
        sourceId,
        fetchConfig,
        autoRetrain,
        warnSd,
        criticalSd,
        driftMonitor,
        driftThresholdPct,
        truthLagMinutes,
        truthToleranceMinutes,
        truthHorizonHours,
        missingPctWarn,
        missingPctAlert,
        skipStreakAlert,
        frozenWindows,
        frozenTolerancePct,
        // T25. Recorded on every enable, never merged from `existing` like
        // the settings fields above: this is an OBSERVATION with a time on
        // it, not a preference. Carrying a previous enable's verdict forward
        // would be asserting a probe that this press did not run. `ok: null`
        // (a non-PI source) is stored as null, which the deploy classifier
        // reads as not-probed rather than as a pass.
        preflightAt: new Date(),
        preflightOk: preflight.ok,
        preflightReason: preflight.reason,
        createdById: user.id,
      },
      update: {
        enabled: true,
        ...(dto.cadenceMinutes !== undefined && { cadenceMinutes }),
        ...(dto.lagMinutes !== undefined && { lagMinutes }),
        // T14: unconditional, unlike cadenceMinutes/lagMinutes above — see
        // this value's own doc comment for why it must always track the
        // current fetchConfig rather than survive as a stale partial-update
        // holdover.
        minRows,
        sourceId,
        fetchConfig,
        autoRetrain,
        warnSd,
        criticalSd,
        driftMonitor,
        driftThresholdPct,
        truthLagMinutes,
        truthToleranceMinutes,
        truthHorizonHours,
        missingPctWarn,
        missingPctAlert,
        skipStreakAlert,
        frozenWindows,
        frozenTolerancePct,
        // T25. Written ONLY on a real OFF -> ON enable, which is the only
        // call that actually probed. A settings-only update omits all three
        // and keeps the row's existing observation — overwriting them with a
        // probe that never ran would fabricate evidence, and overwriting them
        // with `null` would drop a live schedule back to "not probed" and
        // read as initializing.
        ...(wasEnabled
          ? {}
          : {
              preflightAt: new Date(),
              preflightOk: preflight.ok,
              preflightReason: preflight.reason,
            }),
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
        minRows,
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
          lastFailure: null,
          lastSkipped: null,
          deployStatus: classifyDeployStatus({
            enabled: false,
            hasEverSucceeded: false,
            // No schedule row, so nothing was ever probed. Moot while
            // `enabled: false` short-circuits to 'stopped', but passed
            // honestly rather than as a `false` that would read as a
            // failed probe if that guard ever moved.
            preflightOk: null,
          }),
          // MODEL-SERVE-001-T21. No schedule row at all — nothing to
          // evaluate, same OFF this axis reads for driftMonitor: false.
          // T26: `reason` null, because OFF here is "not watching", not a
          // fault — the distinction that axis now has to carry.
          // T29: `frozenColumns` is present-and-empty, never omitted. The
          // client's `health` type requires it, and this no-schedule branch is
          // the most common shape on a fresh workspace — an omission here is a
          // runtime mismatch tsc cannot see through the inferred return type.
          health: {
            status: 'OFF' as const,
            reason: null,
            frozenColumns: [] as string[],
            thresholds: null,
          },
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
    // MODEL-SERVE-001-T20: CANCELED excluded, deliberately, even though a
    // cancelled window's windowStart is PERMANENTLY unfillable (by decision:
    // insertDueWindows's own `skipDuplicates` never re-creates it on
    // re-enable — see the enum's own doc comment on schema.prisma). This is
    // "do not count it," not "there is no hole" — a Stop is an operator
    // action, not evidence the schedule failed to produce a reading, so it
    // stays out of the number that drives the staleness/gap story rather
    // than silently reporting a hole that will never be filled.
    const gapCount = await this.prisma.inferenceWindow.count({
      where: {
        modelId,
        status: { notIn: ['SUCCEEDED', 'SKIPPED', 'CANCELED'] },
      },
    });

    const staleness = isStale(
      lastSucceeded?.windowStart ?? null,
      schedule.cadenceMinutes,
      schedule.lagMinutes,
    );

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
    // MODEL-SERVE-001-T26. `hasFailedWindows` was REMOVED here, not merely
    // left unread. It existed only to separate "warming up" from "already
    // broken" for a never-succeeded schedule — an inference from window
    // history that T25's recorded preflight evidence now answers directly.
    // Keeping it computed but unused would leave a reader guessing which
    // axis it still belonged to.

    // MODEL-SERVE-001-T09. TWO separate fields, not "latest window with a
    // non-null reason" — `failureReason` is set on FAILED *and* SKIPPED,
    // and a SKIPPED reason (the INFERENCE_MIN_ROWS threshold message) is
    // NOT an error. Collapsing them would print a threshold message on a
    // `running` card as though it were a fault — the very "two sources of
    // truth for one fact" this feature exists to close, recreated here.
    // `redactUrls` because completeService (this file) stores the infer
    // container's `str(err)` VERBATIM — the one failureReason writer that
    // is never sanitized on the way in (see redact-urls.ts's own doc).
    const [lastFailedWindow, lastSkippedWindow, health] = await Promise.all([
      this.prisma.inferenceWindow.findFirst({
        where: { modelId, status: 'FAILED' },
        orderBy: { windowStart: 'desc' },
        select: { windowStart: true, failureReason: true },
      }),
      this.prisma.inferenceWindow.findFirst({
        where: { modelId, status: 'SKIPPED' },
        orderBy: { windowStart: 'desc' },
        select: { windowStart: true, failureReason: true },
      }),
      // MODEL-SERVE-001-T21. A SEPARATE axis from deployStatus below, never
      // collapsed into it — see lib/model-health.ts's own doc comment.
      this.monitoring.getHealthStatus(modelId),
    ]);

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
        lastFailure: lastFailedWindow
          ? {
              windowStart: lastFailedWindow.windowStart,
              reason: lastFailedWindow.failureReason
                ? redactUrls(lastFailedWindow.failureReason)
                : null,
            }
          : null,
        lastSkipped: lastSkippedWindow
          ? {
              windowStart: lastSkippedWindow.windowStart,
              reason: lastSkippedWindow.failureReason
                ? redactUrls(lastSkippedWindow.failureReason)
                : null,
            }
          : null,
        // MODEL-SERVE-006-T12. Same classifyDeployStatus every model list/
        // get response now uses (lib/deploy-status.ts) — one state machine,
        // not a second one that could disagree with what the models list
        // shows for this same model.
        // MODEL-SERVE-001-T26. `staleness` and `failing` are still REPORTED
        // above — existing readers use them, and they are true facts about
        // the windows — but they no longer decide this value. They are the
        // monitoring axis's inputs now, and `health` below carries their
        // verdict with a reason code attached.
        deployStatus: classifyDeployStatus({
          enabled: schedule.enabled,
          hasEverSucceeded: lastSucceeded !== null,
          preflightOk: schedule.preflightOk,
        }),
        health,
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

  /**
   * MODEL-SERVE-001-T10. One window's container stdout, plus the window's
   * own facts. Three things here are deliberate and each has cost something
   * already:
   *
   * REDACTED PER LINE, AT THE READ BOUNDARY. `images/trainer/app/train.py`'s
   * top-level handler passes ONE `str(err)` to two sinks —
   * `_api.log(str(err), 'error')` and `_api.report_failure(str(err))`.
   * MODEL-SERVE-001-T09 found that string leaks a presigned URL's
   * `X-Amz-Signature` (infer.py downloads both the model and the input by
   * presigned URL, and `requests`' HTTPError embeds the full URL) and
   * redacted the `failureReason` sink in `getStatusService`. The log sink
   * was left open, and this endpoint returned `message` raw — against this
   * ledger's own definition of done: "no result bytes and no presigned URLs
   * pass through a log." Read-side only, so the stored row keeps full
   * evidence for server-side logs.
   *
   * NEWEST-FIRST, THEN REVERSED — NOT the training read's `asc` + `take`.
   * `orderBy: 'asc', take: 500` keeps the FIRST 500 lines, which is startup
   * noise, and drops the tail, which is where a FAILED window's failure
   * actually is. It also cannot serve the list's peek ("its last lines") at
   * all. Taking the newest 500 and reversing for display gets both.
   *
   * `latest` RESOLVES SERVER-SIDE. `models/views`' Console holds a Model,
   * not a window id. Resolving it here keeps the peek and the detail tab on
   * one handler and one shape — the divergence T09 had to close for
   * deployStatus one screen over, not repeated here.
   */
  async listLogsService(
    modelId: string,
    windowId: string,
    user: Auth.UserPayload,
  ) {
    await this.assertModelAccess(modelId, user);
    const window = await this.prisma.inferenceWindow.findFirst({
      where:
        windowId === LATEST_WINDOW ? { modelId } : { id: windowId, modelId },
      orderBy: { windowStart: 'desc' },
      select: WINDOW_LOG_CONTEXT_SELECT,
    });
    if (!window) {
      throw new AppException({
        statusCode: 404,
        message:
          windowId === LATEST_WINDOW
            ? 'This model has no inference windows yet'
            : 'Inference window not found',
        type: 'ERROR',
      });
    }

    // One row past the cap is the truncation signal — cheaper than counting
    // on every read, and the count below only runs when it actually bites.
    const newestFirst = await this.prisma.inferenceWindowLog.findMany({
      where: { windowId: window.id },
      orderBy: { createdAt: 'desc' },
      take: WINDOW_LOG_LIMIT + 1,
      select: { id: true, level: true, message: true, createdAt: true },
    });
    const truncated = newestFirst.length > WINDOW_LOG_LIMIT;
    const omittedCount = truncated
      ? (await this.prisma.inferenceWindowLog.count({
          where: { windowId: window.id },
        })) - WINDOW_LOG_LIMIT
      : 0;

    const lines = newestFirst
      .slice(0, WINDOW_LOG_LIMIT)
      .reverse()
      .map((line) => ({ ...line, message: redactUrls(line.message) }));

    return {
      statusCode: 200,
      message: 'Window logs',
      type: 'SUCCESS' as const,
      data: {
        window: {
          ...window,
          failureReason: window.failureReason
            ? redactUrls(window.failureReason)
            : null,
        },
        provenance: await this.windowProvenance(modelId, window.id),
        lines,
        truncated,
        omittedCount,
      },
    };
  }

  /**
   * MODEL-SERVE-001-T10, the other half of the span the user asked for:
   * "from the moment Deploy is pressed through to the console output of the
   * container that scored a window". A container log alone cannot answer
   * that. Two records precede it and neither is interchangeable with the
   * window row:
   *
   *   1. The schedule's own enable transition — Model.data.deployedAt /
   *      deployedBy, stamped by `stampDeployed` on the OFF->ON edge ONLY,
   *      so it is the moment Deploy was pressed and not the last edit.
   *   2. The promote that preceded it — which version this window is
   *      pinned to, who promoted it, and the override reason if the r2
   *      floor was crossed (T06: "an override that left no trace would be
   *      the same as no floor").
   *
   * Read best-effort: a missing schedule stamp or a deleted promoter must
   * never fail the log read, which is the caller's actual question. Same
   * soft-read discipline `getDraftRunService` applies to cvFolds.
   */
  private async windowProvenance(modelId: string, windowId: string) {
    const [model, window] = await Promise.all([
      this.prisma.model.findUnique({
        where: { id: modelId },
        select: { data: true },
      }),
      this.prisma.inferenceWindow.findUnique({
        where: { id: windowId },
        select: {
          modelVersion: {
            select: {
              version: true,
              stage: true,
              promotedAt: true,
              promotionOverride: true,
              promotedBy: { select: { firstName: true, lastName: true } },
            },
          },
        },
      }),
    ]);

    const data = (model?.data ?? {}) as {
      deployedAt?: unknown;
      deployedBy?: unknown;
    };
    const promoter = window?.modelVersion?.promotedBy;

    return {
      deployedAt: typeof data.deployedAt === 'string' ? data.deployedAt : null,
      deployedBy: typeof data.deployedBy === 'string' ? data.deployedBy : null,
      version: window?.modelVersion?.version ?? null,
      stage: window?.modelVersion?.stage ?? null,
      promotedAt: window?.modelVersion?.promotedAt ?? null,
      promotedBy: promoter
        ? `${promoter.firstName} ${promoter.lastName}`.trim()
        : null,
      // Present only when the promote crossed the r2 floor. Redacted for the
      // same reason every other free-text field on this response is: the
      // reason is operator-authored and this is a read boundary.
      promotionOverrideReason: overrideReasonOf(
        window?.modelVersion?.promotionOverride,
      ),
    };
  }

  // ── ground truth (MODEL-SERVE-005-T03) ───────────────────────────────────

  /**
   * Live error for a range, from the joined pairs — plus the coverage that
   * makes the number readable.
   *
   * GROUPED BY VERSION, NEVER POOLED BLIND ACROSS THEM. MODEL-SERVE-006-T07
   * deliberately allows two windows at one windowStart under two versions
   * (shadow evaluation), and each version's target comes from its OWN
   * source run — so two versions in one range can predict DIFFERENT things.
   * One RMSE over that mixture is a number about nothing. Each group states
   * its own `targetColumn`, and the top-level `metrics` is filled only when
   * every joined window in range agrees on one version.
   *
   * `metrics` is `null`, never zeros, when nothing has joined — the whole
   * point of this feature is that "no ground truth yet" and "an error of
   * zero" must never render the same way.
   */
  async getTruthService(
    modelId: string,
    query: InferenceTruthRangeQueryDto,
    user: Auth.UserPayload,
  ) {
    await this.assertModelAccess(modelId, user);

    const from = new Date(query.from);
    const to = new Date(query.to);

    const rows = await this.prisma.inferenceWindowTruth.findMany({
      where: { modelId, windowStart: { gte: from, lte: to } },
      orderBy: { windowStart: 'asc' },
      select: {
        windowStart: true,
        modelVersionId: true,
        targetColumn: true,
        pairsKey: true,
        truthRows: true,
        pairedRows: true,
        // MODEL-SERVE-008-T04. How many predictions the window actually
        // produced, as distinct from how many of them found a partner.
        // Without it the strip can only report the paired count, and a
        // reader counting sparse actual points concludes the model ran
        // that few times — which at a 24h lab cadence understates the
        // scoring rate by a factor of about 24.
        predictionRows: true,
        joinedThrough: true,
        failureReason: true,
        n: true,
        sumSe: true,
        sumAe: true,
        sumSigned: true,
        sumActual: true,
        sumActualSq: true,
        window: { select: { missingPct: true } },
      },
    });

    // Every SUCCEEDED window in range, joined or not — the denominator that
    // turns "3 joined windows" into a statement about coverage rather than
    // an unanchored count.
    const windowsInRange = await this.prisma.inferenceWindow.count({
      where: {
        modelId,
        status: 'SUCCEEDED',
        windowStart: { gte: from, lte: to },
      },
    });
    // T11: a FOURTH empty cause `EmptyTruth` could not previously name.
    // `windowsInRange` counts only SUCCEEDED, so a range where every window
    // was SKIPPED (too few usable rows — T01's real terminal status, not a
    // failure) reads identically to "the scheduler never ran here" even
    // though it ran, fetched, and deliberately declined to score. A SKIPPED
    // window also writes no predictions.parquet, so there is nothing else
    // in range to distinguish the two.
    const windowsSkipped = await this.prisma.inferenceWindow.count({
      where: {
        modelId,
        status: 'SKIPPED',
        windowStart: { gte: from, lte: to },
      },
    });

    // MODEL-SERVE-001-T18. A correctly-empty coverage reads identically at
    // minute 1 and hour 23 of the wait unless the reader can see WHEN the
    // next check happens. `earliestEligibleAt` names it: the earliest
    // SUCCEEDED window in range that has not yet joined — no truth row at
    // all, or one with n = 0 and no failureReason (a real attempt that
    // found nothing YET, still eligible for a retry) — plus this
    // schedule's own truthLagMinutes. A SEPARATE, small query rather than
    // folding into `windowsInRange` above: that count is proven and
    // untouched; this one exists purely to read the `truth` relation the
    // count never needed.
    const schedule = await this.prisma.inferenceSchedule.findUnique({
      where: { modelId },
      // MODEL-SERVE-008-T04. `cadenceMinutes` rides along on the query the
      // lag already needed: the strip must state the two RATES, not only
      // the two counts, and how often this model scores is the half a
      // reader cannot infer from the points in front of them.
      select: { truthLagMinutes: true, cadenceMinutes: true },
    });
    const awaitingWindows = schedule
      ? await this.prisma.inferenceWindow.findMany({
          where: {
            modelId,
            status: 'SUCCEEDED',
            windowStart: { gte: from, lte: to },
          },
          select: {
            windowEnd: true,
            truth: { select: { n: true, failureReason: true } },
          },
        })
      : [];
    const stillAwaiting = awaitingWindows.filter(
      (w) => !w.truth || (w.truth.n === 0 && w.truth.failureReason === null),
    );
    // MODEL-SERVE-008-T01. A window whose lag has ALREADY EXPIRED is not
    // waiting on anything — the lab had its full window and reported
    // nothing. Before this split, `stillAwaiting` kept such a window
    // forever (it joins honestly with n = 0 and no failureReason, which is
    // the same shape as a window that has not been asked yet), so
    // `earliestEligibleAt` named a deadline in the PAST and the panel told
    // a reader to keep waiting for a check that had already happened.
    // Measured live on 2026-09-17: three windows sat 42h past a 24h lag,
    // joined, empty, still rendering "becomes eligible at Sep 15, 08:00".
    // The two states are counted separately and only the genuinely-pending
    // one may produce a time.
    const lagMs = (schedule?.truthLagMinutes ?? 0) * 60_000;
    const nowMs = Date.now();
    const pendingLag = stillAwaiting.filter(
      (w) => w.windowEnd.getTime() + lagMs > nowMs,
    );
    // Lag expired, join attempted or due, no measurement. Disjoint from
    // `windowsFailed`: the sweeper DID reach the source here — the lab
    // simply never reported in this window. At a 24h lab cadence against an
    // hourly schedule this is the common case, not an error.
    const windowsLapsedTruth = stillAwaiting.length - pendingLag.length;
    // Null when nothing in range is still inside its lag — never a guess at
    // a wait that does not exist (no schedule row, every SUCCEEDED window
    // already joined or failed) and never a time that has already passed.
    const earliestEligibleAt =
      schedule && pendingLag.length > 0
        ? new Date(
            Math.min(...pendingLag.map((w) => w.windowEnd.getTime())) + lagMs,
          ).toISOString()
        : null;

    const joined = rows.filter((r) => r.n > 0);
    // A row the sweeper wrote because the join FAILED, never because the lab
    // was quiet. `poolTruthStats` skips these anyway (n = 0); the count
    // exists so the panel can say which of the two zero states it is in.
    const failedWindows = rows.filter((r) => r.failureReason !== null).length;
    const byVersion = new Map<string, typeof rows>();
    for (const row of joined) {
      const bucket = byVersion.get(row.modelVersionId) ?? [];
      bucket.push(row);
      byVersion.set(row.modelVersionId, bucket);
    }

    const versions = [...byVersion.entries()].map(
      ([modelVersionId, group]) => ({
        modelVersionId,
        // Non-empty by construction: a bucket is only stored after a push.
        targetColumn: group[0].targetColumn,
        metrics: computeLiveError(poolTruthStats(group)),
        pairedRows: group.reduce((sum, r) => sum + r.pairedRows, 0),
        windows: group.length,
      }),
    );

    // Per-window, NOT a mean. MODEL-SERVE-006-T05's stated reason for
    // missingPct is telling real drift apart from a sensor that stopped
    // reporting, and a single averaged number hides the one catastrophic
    // window that is exactly that signal.
    const windows = rows.map((row) => ({
      windowStart: row.windowStart,
      modelVersionId: row.modelVersionId,
      targetColumn: row.targetColumn,
      truthRows: row.truthRows,
      pairedRows: row.pairedRows,
      n: row.n,
      missingPct: row.window?.missingPct ?? null,
      joinedThrough: row.joinedThrough,
      // Set only on a row the sweeper wrote because the join FAILED. This is
      // what separates "the lab has reported nothing yet" (n = 0, no reason)
      // from "we could not ask" (n = 0, reason) — two states a single zero
      // would otherwise flatten into one.
      failureReason: row.failureReason,
    }));
    const missingPcts = windows
      .map((w) => w.missingPct)
      .filter((v): v is number => typeof v === 'number');

    const keys = joined
      .map((r) => r.pairsKey)
      .filter((k): k is string => typeof k === 'string' && k.length > 0);

    let points: Array<{
      timestamp: string;
      predicted: number;
      actual: number;
      residual: number;
    }> = [];
    let truncated = false;
    if (keys.length > 0) {
      // A failed object read must not take down the whole panel: the
      // metrics and coverage above come from Postgres and are still true
      // and still worth showing without the chart's own points.
      try {
        const series = await inferenceWindowTruthSeries({ keys });
        points = series.points;
        truncated = series.truncated;
      } catch (err) {
        this.log.warn(
          `Truth series read failed for model ${modelId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    return {
      statusCode: 200,
      message: 'Live error',
      type: 'SUCCESS' as const,
      data: {
        points,
        truncated,
        // Filled only when the range speaks with ONE voice; otherwise the
        // caller must read `versions` and say which is which.
        metrics: versions.length === 1 ? versions[0].metrics : null,
        mixedVersions: versions.length > 1,
        versions,
        // The target any row in range knows about, including rows that
        // joined NOTHING. `versions` only holds groups with pairs, so a
        // model still awaiting its first lab sample would otherwise lose the
        // target label entirely — a fact that is knowable and worth showing
        // before any truth arrives.
        targetColumn: rows.find((r) => r.targetColumn)?.targetColumn ?? null,
        coverage: {
          windowsInRange,
          windowsSkipped,
          windowsJoined: joined.length,
          // DISJOINT from windowsFailed, deliberately: a window whose join
          // failed is not a window waiting on the lab, and counting it in
          // both would make the two chips contradict each other. Floored at
          // zero because a failure row can outlive the SUCCEEDED window
          // count it is subtracted from.
          windowsAwaitingTruth: Math.max(
            0,
            windowsInRange - joined.length - failedWindows,
          ),
          // Windows the sweeper could not ask about at all, as distinct from
          // windows the lab simply has not reported on yet.
          windowsFailed: failedWindows,
          truthRows: rows.reduce((sum, r) => sum + r.truthRows, 0),
          pairedRows: rows.reduce((sum, r) => sum + r.pairedRows, 0),
          // MODEL-SERVE-008-T04. The scored side's own count. Summed over
          // the SAME rows as truthRows and pairedRows so all three describe
          // one range and cannot disagree about which windows they cover.
          predictionRows: rows.reduce((sum, r) => sum + r.predictionRows, 0),
          // Max, not mean — see the per-window comment above.
          maxMissingPct:
            missingPcts.length > 0 ? Math.max(...missingPcts) : null,
          // MODEL-SERVE-001-T18. Null when the model has no InferenceSchedule
          // row — the wait has no meaning without one.
          truthLagMinutes: schedule?.truthLagMinutes ?? null,
          // MODEL-SERVE-008-T04. How often this model scores — null with no
          // schedule, where the question has no answer rather than a
          // default one.
          cadenceMinutes: schedule?.cadenceMinutes ?? null,
          earliestEligibleAt,
          // MODEL-SERVE-008-T01. Windows past their lag that the lab never
          // reported on. A subset of `windowsAwaitingTruth`, not a second
          // count of the same thing: awaiting = still inside the lag PLUS
          // lapsed, and only the lapsed half is a fact rather than a wait.
          windowsLapsedTruth,
        },
        windows,
      },
    };
  }

  /**
   * Force a re-join over a range, through the SAME sweeper path a scheduled
   * join uses — no second implementation, the rule MODEL-SERVE-006-T11
   * applies to backfill.
   *
   * Bounded by the same batch size the sweep uses, so a wide range cannot
   * turn one request into hundreds of historian fetches.
   */
  async rejoinTruthService(
    modelId: string,
    dto: RejoinInferenceTruthDto,
    user: Auth.UserPayload,
  ) {
    await this.assertModelAccess(modelId, user);

    const windows = await this.prisma.inferenceWindow.findMany({
      where: {
        modelId,
        status: 'SUCCEEDED',
        predictionsKey: { not: null },
        windowStart: { gte: new Date(dto.from), lte: new Date(dto.to) },
      },
      select: { id: true },
      orderBy: { windowStart: 'asc' },
      take: env.INFERENCE_TRUTH_BATCH_SIZE,
    });

    let rejoined = 0;
    const failures: string[] = [];
    for (const window of windows) {
      try {
        await this.truthSweeper.joinWindow(window.id);
        rejoined += 1;
      } catch (err) {
        // Reported, not thrown: a caller asking for a range wants to know
        // what DID join as well as what did not.
        failures.push(
          `${window.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return {
      statusCode: 200,
      message: 'Ground-truth re-join complete',
      type: 'SUCCESS' as const,
      data: {
        requested: windows.length,
        rejoined,
        failed: failures.length,
        failures,
      },
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
