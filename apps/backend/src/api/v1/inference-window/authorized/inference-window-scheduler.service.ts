import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '@softsensor/prisma';
import { decryptSecret } from '@/lib/crypto';
import { mintRunToken } from '@/lib/mint-run-token';
import {
  materializeInferenceWindow,
  type InferenceWindowMaterializeResult,
} from '@/lib/python-preprocess-client';
import { formatDtHour, windowStartsBetween } from '@/lib/inference-windows';
import { env } from '@/config/env.config';
import { TrainningContainerAuthorizedService } from '../../trainning-container/authorized/trainning-container.authorized.service';
import { ModelServingAuthorizedService } from '../../model-serving/authorized/model-serving.authorized.service';

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * MODEL-SERVE-006-T02. THE TICK INSERTS WINDOWS AND RECONCILES — IT NEVER
 * SCORES.
 *
 * Same `setInterval(...).unref()` shape ModelDraftCleanupAdminService's own
 * MODEL_DRAFT_SWEEP_INTERVAL_MS sweep uses: `<= 0` disables (and says so),
 * errors are logged and swallowed so a bad tick never crashes the process,
 * and the single-replica assumption is documented rather than guarded —
 * overlap between two replicas is wasteful, not corrupting, because every
 * insert is idempotent under InferenceWindow's own unique constraint.
 *
 * Scoring is a SEPARATE, non-awaited path (`dispatchDue`). This split is
 * load-bearing, not stylistic: a missed tick costs nothing (next tick
 * inserts what was missed, per the unique constraint), but if the tick
 * itself scored, a slow window would delay the NEXT tick's own inserts —
 * the interval would become load-bearing, and a missed insert IS a
 * permanent gap in the monitoring record (T01's own finding). Dispatch is
 * bounded by INFERENCE_MAX_CONCURRENCY so a first boot with a long backfill
 * horizon cannot spawn dozens of containers from one tick.
 */
@Injectable()
export class InferenceWindowSchedulerService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(InferenceWindowSchedulerService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private dispatching = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: TrainningContainerAuthorizedService,
    private readonly descriptor: ModelServingAuthorizedService,
  ) {}

  onModuleInit(): void {
    const intervalMs = env.INFERENCE_TICK_INTERVAL_MS;
    if (intervalMs <= 0) {
      this.logger.log(
        'Inference scheduler tick disabled (INFERENCE_TICK_INTERVAL_MS <= 0).',
      );
      return;
    }
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    this.timer.unref();
    this.logger.log(
      `Inference scheduler tick scheduled every ${intervalMs}ms.`,
    );
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    try {
      await this.insertDueWindows();
    } catch (err) {
      this.logger.warn(`Inference window insert sweep failed: ${msg(err)}`);
    }
    try {
      await this.reconcileStuckWindows();
    } catch (err) {
      this.logger.warn(`Inference window reconcile sweep failed: ${msg(err)}`);
    }
    // Not awaited by the tick's own error handling above on purpose — a
    // dispatch failure is per-window (caught inside dispatchDue itself) and
    // must never be conflated with an insert/reconcile sweep failure.
    void this.dispatchDue();
  }

  /**
   * T01/T02/T11. For every enabled schedule, insert PENDING rows for every
   * due window that has none — `createMany({ skipDuplicates: true })`
   * against the `(modelVersionId, windowStart)` unique index makes a
   * repeated insert a no-op, so there is no idempotency key of the kind
   * PredictionJob needs.
   */
  private async insertDueWindows(): Promise<void> {
    const schedules = await this.prisma.inferenceSchedule.findMany({
      where: { enabled: true },
    });
    if (schedules.length === 0) return;

    const now = new Date();
    for (const schedule of schedules) {
      const version = await this.prisma.modelVersion.findFirst({
        where: { modelId: schedule.modelId, stage: 'PRODUCTION' },
        select: { id: true },
      });
      // No PRODUCTION version — nothing to pin a window to. Not an error:
      // a demote-then-no-promote leaves a schedule enabled with nothing to
      // run, and T10's staleness alarm is exactly what surfaces this to a
      // human, not a background exception.
      if (!version) continue;

      const from = new Date(
        now.getTime() - env.INFERENCE_BACKFILL_HORIZON_HOURS * 3_600_000,
      );
      const to = new Date(now.getTime() - schedule.lagMinutes * 60_000);
      const starts = windowStartsBetween(from, to, schedule.cadenceMinutes);
      if (starts.length === 0) continue;

      const tokenExpiresAt = new Date(
        Date.now() + env.INFERENCE_WINDOW_TOKEN_TTL_MS,
      );

      await this.prisma.inferenceWindow.createMany({
        data: starts.map((windowStart) => {
          const { tokenHash } = mintRunToken();
          return {
            modelId: schedule.modelId,
            modelVersionId: version.id,
            windowStart,
            windowEnd: new Date(
              windowStart.getTime() + schedule.cadenceMinutes * 60_000,
            ),
            status: 'PENDING' as const,
            tokenHash,
            tokenExpiresAt,
          };
        }),
        skipDuplicates: true,
      });
    }
  }

  /**
   * T02. The first timeout-based reconcile in this codebase —
   * `TrainningContainerAuthorizedService.reconcileOrphanedRuns` is a pure
   * existence check with no clock, because training/batch's create→spawn
   * gap is sub-second. A PENDING→RUNNING window has a whole tick interval
   * between insert and spawn, so an existence check alone is not enough:
   * a container that legitimately never started (a spawn that silently
   * hung) would stay RUNNING forever with nothing to reconcile it.
   */
  private async reconcileStuckWindows(): Promise<void> {
    const cutoff = new Date(Date.now() - env.INFERENCE_WINDOW_STUCK_MS);
    const stuck = await this.prisma.inferenceWindow.findMany({
      where: { status: 'RUNNING', startedAt: { lt: cutoff } },
      select: { id: true, containerId: true },
    });
    for (const window of stuck) {
      if (window.containerId) {
        // Container-existence check, same discipline reconcileOrphanedRuns
        // already applies — a real report having already landed always
        // wins, so this only fires for a row STILL RUNNING past the
        // timeout, never one a real /infer-complete has already resolved.
        const alive = await this.runner.containerExists(window.containerId);
        if (alive) continue;
      }
      await this.prisma.inferenceWindow.update({
        where: { id: window.id },
        data: {
          status: 'FAILED',
          failureReason: `Window exceeded ${env.INFERENCE_WINDOW_STUCK_MS}ms without completing — reconciled at the next tick.`,
          finishedAt: new Date(),
          tokenExpiresAt: new Date(0),
        },
      });
    }
  }

  /**
   * Materializes and spawns up to INFERENCE_MAX_CONCURRENCY PENDING
   * windows, oldest first. Out of band from the tick's own error handling —
   * a spawn failure marks its OWN row FAILED and must never abort sibling
   * windows in the same batch.
   */
  private async dispatchDue(): Promise<void> {
    if (this.dispatching) return; // one dispatch pass in flight at a time
    this.dispatching = true;
    try {
      const due = await this.prisma.inferenceWindow.findMany({
        where: { status: 'PENDING' },
        orderBy: { windowStart: 'asc' },
        take: env.INFERENCE_MAX_CONCURRENCY,
      });
      for (const window of due) {
        await this.dispatchOne(window.id).catch((err) => {
          this.logger.error(
            `Dispatch failed for inference window ${window.id}`,
            err,
          );
        });
      }
    } finally {
      this.dispatching = false;
    }
  }

  private async dispatchOne(windowId: string): Promise<void> {
    const window = await this.prisma.inferenceWindow.findUnique({
      where: { id: windowId },
    });
    // Already picked up by a concurrent pass, or reconciled away since the
    // batch was read — nothing to do.
    if (!window || window.status !== 'PENDING') return;

    const schedule = await this.prisma.inferenceSchedule.findUnique({
      where: { modelId: window.modelId },
    });
    if (!schedule) {
      await this.fail(window.id, 'No InferenceSchedule found for this model.');
      return;
    }

    let materialized: InferenceWindowMaterializeResult;
    try {
      const descriptorResult =
        await this.descriptor.getDescriptorByVersionIdService(
          window.modelVersionId,
        );
      const d = descriptorResult.data;
      // The descriptor's own response shape has no featureSpecKey field
      // (apps/serving reads scalers/scalingParams already flattened, not
      // the raw key) — read straight off the pinned ModelVersion row
      // instead of widening a response contract shared with the serving
      // process for one field.
      const version = await this.prisma.modelVersion.findUniqueOrThrow({
        where: { id: window.modelVersionId },
        select: { featureSpecKey: true },
      });
      if (!version.featureSpecKey) {
        throw new Error(
          `ModelVersion ${window.modelVersionId} has no featureSpecKey — cannot resolve its feature recipe.`,
        );
      }
      const { dt, hour } = formatDtHour(window.windowStart);
      const fetchConfig = this.asFetchConfig(schedule.fetchConfig);
      const source = await this.resolveSource(schedule.sourceId, fetchConfig);

      materialized = await materializeInferenceWindow({
        feature_spec_key: version.featureSpecKey,
        feature_columns: d.featureColumns,
        model_id: window.modelId,
        model_version_id: window.modelVersionId,
        dt,
        hour,
        window_start: window.windowStart.toISOString(),
        window_end: window.windowEnd.toISOString(),
        interval: fetchConfig.intervalTime,
        ...source,
      });
    } catch (err) {
      await this.fail(window.id, `Materialize failed: ${msg(err)}`);
      return;
    }

    await this.prisma.inferenceWindow.update({
      where: { id: window.id },
      data: {
        inputKey: materialized.object_key,
        inputChecksum: materialized.checksum,
        inputRows: materialized.scored_rows,
        missingPct: materialized.missing_pct,
      },
    });

    // T05/T01: too few usable rows is SKIPPED, a real terminal status, not
    // FAILED — a quiet plant is not an incident, and conflating the two
    // would make the staleness alarm cry wolf on it.
    if (materialized.scored_rows < env.INFERENCE_MIN_ROWS) {
      await this.prisma.inferenceWindow.update({
        where: { id: window.id },
        data: {
          status: 'SKIPPED',
          failureReason: `Only ${materialized.scored_rows} usable row(s), below INFERENCE_MIN_ROWS (${env.INFERENCE_MIN_ROWS}).`,
          finishedAt: new Date(),
          tokenExpiresAt: new Date(0),
        },
      });
      return;
    }

    // Re-mint: the row's stored tokenHash was set at INSERT time; the
    // container needs the PLAINTEXT, which was never persisted. Re-hashing
    // onto the row here keeps the plaintext-never-touches-a-row discipline
    // every other token in this codebase follows.
    const { token } = mintRunToken();
    const tokenHash = createHash('sha256').update(token).digest('hex');
    await this.prisma.inferenceWindow.update({
      where: { id: window.id },
      data: { tokenHash },
    });

    try {
      await this.runner.spawn(window.id, token, 'infer');
    } catch (err) {
      await this.fail(window.id, `Could not start container: ${msg(err)}`);
    }
  }

  private async fail(windowId: string, reason: string): Promise<void> {
    await this.prisma.inferenceWindow.update({
      where: { id: windowId },
      data: {
        status: 'FAILED',
        failureReason: reason.slice(0, 2000),
        finishedAt: new Date(),
        tokenExpiresAt: new Date(0),
      },
    });
  }

  private asFetchConfig(value: unknown): {
    intervalTime: string;
    calcType?: string;
    calcBasis?: string;
    table?: string;
    timeColumn?: string;
    tags?: string[];
  } {
    const raw = (value ?? {}) as Record<string, unknown>;
    return {
      intervalTime:
        typeof raw.intervalTime === 'string' ? raw.intervalTime : '1m',
      calcType: typeof raw.calcType === 'string' ? raw.calcType : undefined,
      calcBasis: typeof raw.calcBasis === 'string' ? raw.calcBasis : undefined,
      table: typeof raw.table === 'string' ? raw.table : undefined,
      timeColumn:
        typeof raw.timeColumn === 'string' ? raw.timeColumn : undefined,
      tags: Array.isArray(raw.baseTags)
        ? raw.baseTags.filter((t): t is string => typeof t === 'string')
        : undefined,
    };
  }

  /**
   * Resolves ONE DataSource's decrypted credentials into the `pi`/`sql`
   * shape `materializeInferenceWindow` forwards to python — the same
   * mapping `DataSourceConnectService`'s private `buildPiCredentials`/
   * `buildSqlCredentials` already apply, duplicated here rather than
   * reused because that service's own `resolveById` enforces a per-USER
   * ownership check this background tick has no user session to satisfy.
   * Ownership is verified ONCE, when a human enables the schedule
   * (`putScheduleService`'s own `assertModelAccess` + DataSource read); the
   * tick trusts the stored `sourceId` the same way any other background
   * job trusts a foreign key a request handler already validated.
   */
  private async resolveSource(
    sourceId: string,
    fetchConfig: ReturnType<InferenceWindowSchedulerService['asFetchConfig']>,
  ): Promise<{ pi?: Record<string, unknown>; sql?: Record<string, unknown> }> {
    const row = await this.prisma.dataSource.findUnique({
      where: { id: sourceId },
    });
    if (!row) {
      throw new Error(`DataSource ${sourceId} not found.`);
    }
    const secret = decryptSecret(row.secretCiphertext);
    const config = (row.config ?? {}) as Record<string, unknown>;

    if (row.type === 'aveva') {
      return {
        pi: {
          credentials: {
            api_server: row.host,
            pi_server:
              (typeof config.piServer === 'string' && config.piServer) ||
              row.dbName,
            user: row.username,
            password: secret,
          },
          tag_list: fetchConfig.tags ?? [],
          // Placeholders — materialize_window overrides start_time/end_time
          // with its own widened fetch range before calling out to PI.
          start_time: '1970-01-01 00:00:00.000000',
          end_time: '1970-01-01 00:00:00.000000',
          cal_basis: fetchConfig.calcBasis ?? 'TimeWeighted',
          summary_type: [fetchConfig.calcType ?? 'Average'],
          summary_duration: fetchConfig.intervalTime,
        },
      };
    }
    if (row.type === 'sql') {
      return {
        sql: {
          query: {
            credentials: {
              driver: (config.driver as string) ?? '',
              host: row.host,
              port: config.port,
              database: row.dbName,
              user: row.username,
              password: secret,
              ...(typeof config.schema === 'string'
                ? { schema: config.schema }
                : {}),
            },
            table: fetchConfig.table ?? '',
            time_column: fetchConfig.timeColumn,
            limit: 50_000,
          },
          timestamp_column: fetchConfig.timeColumn ?? 'timestamp',
          tags: fetchConfig.tags,
        },
      };
    }
    throw new Error(
      `DataSource ${sourceId} has unsupported type '${row.type}' for scheduled inference.`,
    );
  }
}
