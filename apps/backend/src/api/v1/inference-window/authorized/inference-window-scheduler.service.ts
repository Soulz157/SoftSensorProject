import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService, PrismaTypes } from '@softsensor/prisma';
import { decryptSecret } from '@/lib/crypto';
import { mintRunToken } from '@/lib/mint-run-token';
import {
  materializeInferenceWindow,
  type InferenceWindowMaterializeResult,
} from '@/lib/python-preprocess-client';
import { formatDtHour, windowStartsBetween } from '@/lib/inference-windows';
import { env } from '@/config/env.config';
import { nextTagObservation, type FetchOutcome } from '@/lib/tag-observation';
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
      // T11: a window is due once it has ELAPSED and its lag has passed —
      // windowEnd = now() - lag (schema.prisma's own documented contract
      // on InferenceSchedule.lagMinutes). Gating on windowStart alone (the
      // prior code) made a window due at windowStart + lag, one whole
      // cadence before windowEnd — so the fetch asked the historian for a
      // window whose end was still up to `cadenceMinutes` in the FUTURE.
      // Measured live: 20 fully-elapsed windows returned 60/60 rows at
      // 0% missing while 4 windows read this early returned 19-30 rows,
      // tracking elapsed minutes linearly. windowEnd = windowStart +
      // cadenceMinutes, so "due" becomes windowStart <= now - lag - cadence.
      const to = new Date(
        now.getTime() -
          (schedule.lagMinutes + schedule.cadenceMinutes) * 60_000,
      );
      const starts = windowStartsBetween(from, to, schedule.cadenceMinutes);
      if (starts.length === 0) continue;

      const tokenExpiresAt = new Date(
        Date.now() + env.INFERENCE_WINDOW_TOKEN_TTL_MS,
      );

      // MODEL-SERVE-001-T20, decided 2026-09-15: `skipDuplicates` keys on
      // (modelVersionId, windowStart), the same slot a CANCELED row already
      // occupies — so re-enabling a schedule does NOT resurrect a window a
      // Stop cancelled while it fell inside INFERENCE_BACKFILL_HORIZON_HOURS.
      // That windowStart is permanently skipped here, forever. Deliberate:
      // "cancelled means cancelled," not "cancelled means paused" — the
      // rejected alternative was flipping CANCELED back to PENDING on the
      // enable path instead.
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
   * windows, NEWEST FIRST. Out of band from the tick's own error handling —
   * a spawn failure marks its OWN row FAILED and must never abort sibling
   * windows in the same batch.
   *
   * NEWEST FIRST, NOT OLDEST. This claim is global across every model and
   * takes INFERENCE_MAX_CONCURRENCY rows (1 by default), so the ordering
   * decides what the whole system works on next. Oldest-first meant a
   * freshly enabled schedule spent its entire backfill — up to
   * INFERENCE_BACKFILL_HORIZON_HOURS of windows, 48 by default, one per
   * tick — replaying history before it ever scored the CURRENT hour. Two
   * things followed, both bad:
   *
   *   1. `deriveDeployStatuses` measures staleness from the most recent
   *      SUCCEEDED window. Replaying the oldest windows first leaves that
   *      maximum sitting in the past, so a perfectly healthy model reports
   *      STALE for the entire drain — hours of looking broken while
   *      working correctly.
   *   2. The claim is not scoped per model, so ONE model's backfill
   *      monopolised the single slot and every other model's live window
   *      queued behind it — the same batch-head starvation this ledger
   *      already had to fix once, in the ground-truth sweeper.
   *
   * Newest-first fixes both at once: current-hour windows are the newest
   * rows in the table for EVERY model, so live inference always wins the
   * slot and backfill fills in behind it. The trade is that a permanently
   * saturated queue would leave the oldest backfill windows unclaimed —
   * accepted deliberately, because in a monitoring system a fresh reading
   * is worth more than an old one, and a stale-looking healthy model is a
   * worse failure than a late backfill.
   */
  private async dispatchDue(): Promise<void> {
    if (this.dispatching) return; // one dispatch pass in flight at a time
    this.dispatching = true;
    try {
      // MODEL-SERVE-001-T19. `insertDueWindows` already filters on
      // `enabled: true` — this claim did not, so a Stop stopped FUTURE
      // rows and did nothing to whatever was already PENDING, which kept
      // draining one window per tick as if Stop had no effect. No
      // InferenceWindow → InferenceSchedule relation exists (they join on
      // modelId only, per schema.prisma), so this is the same two-step
      // shape `deriveDeployStatuses` already uses, not a nested `where`.
      //
      // T20: this scope is now belt-and-suspenders, not the only guard —
      // `putScheduleService`'s disable branch resolves every PENDING row to
      // CANCELED in the same transaction that flips `enabled: false`, so
      // there is nothing left here for a stopped schedule to claim. Kept
      // rather than removed: it still protects a schedule disabled between
      // this query and the CANCELED write actually landing.
      //
      // One race this does NOT close, accepted rather than guarded: if a
      // Stop lands after `dispatchOne`'s own `status !== 'PENDING'` check
      // (below) but before its container spawns, that container still
      // runs and `completeService` writes SUCCEEDED over the window —
      // real, self-consistent data, not corruption, under the same
      // single-replica assumption this file's own module doc already
      // documents.
      const enabledSchedules = await this.prisma.inferenceSchedule.findMany({
        where: { enabled: true },
        select: { modelId: true },
      });
      if (enabledSchedules.length === 0) return;

      const due = await this.prisma.inferenceWindow.findMany({
        where: {
          status: 'PENDING',
          modelId: { in: enabledSchedules.map((s) => s.modelId) },
        },
        orderBy: { windowStart: 'desc' },
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

    // MODEL-SERVE-009-T02. Per-tag current state, from the summary python
    // read BEFORE its own Bad-row drop. Deliberately NOT inside the window
    // update's transaction: a TagObservation write failing must not cost
    // the window its input pointer, which is the scored record. Best-effort
    // in the same spirit as MODEL-SERVE-005-T01's prediction-log ingest.
    await this.writeTagObservations(
      window.modelId,
      window.id,
      materialized.tag_observations,
      'SUCCEEDED',
    );

    await this.prisma.inferenceWindow.update({
      where: { id: window.id },
      data: {
        inputKey: materialized.object_key,
        inputChecksum: materialized.checksum,
        inputRows: materialized.scored_rows,
        missingPct: materialized.missing_pct,
        // MODEL-SERVE-001-T17. Written in this SAME statement, BEFORE the
        // SKIPPED branch below — a below-floor window still gets a real
        // histogram/stats row, per this task's own no-status-whitelist
        // rule. `PrismaTypes.DbNull`, not a bare JS `null`, for the null
        // case: a plain `null` is type-rejected on a nullable Json column
        // (the same trap `ingestPredictionLogService`'s own
        // featureHistograms write already documents).
        featureHistograms:
          materialized.feature_histograms === null
            ? PrismaTypes.DbNull
            : materialized.feature_histograms,
        featureStats:
          materialized.feature_stats === null
            ? PrismaTypes.DbNull
            : materialized.feature_stats,
      },
    });

    // T05/T01: too few usable rows is SKIPPED, a real terminal status, not
    // FAILED — a quiet plant is not an incident, and conflating the two
    // would make the staleness alarm cry wolf on it.
    //
    // MODEL-SERVE-001-T14: the floor is THIS schedule's own `minRows`, not
    // the global `env.INFERENCE_MIN_ROWS` — `putScheduleService` already
    // derived it from this schedule's real `cadenceMinutes`/`intervalTime`
    // (falling back to the global default when that is not derivable), so
    // reading it off the row here is what makes that derivation actually
    // take effect. A schedule fetching at a 5-minute interval no longer
    // reads SKIPPED against a floor sized for a 1-minute one.
    if (materialized.scored_rows < schedule.minRows) {
      await this.prisma.inferenceWindow.update({
        where: { id: window.id },
        data: {
          status: 'SKIPPED',
          failureReason: `Only ${materialized.scored_rows} usable row(s), below this schedule's minRows (${schedule.minRows}).`,
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

  /**
   * MODEL-SERVE-009-T02. Fold one fetch's per-tag readings into the stored
   * current state, one row per (model, tag), updated in place.
   *
   * WHY `updatedAt` ALONE IS NOT ENOUGH, and why a FAILED fetch calls this
   * too: if a source outage simply skipped the write, a multi-hour NXDOMAIN
   * would be indistinguishable from a multi-hour freeze — and PI is
   * measurably intermittent from this environment (MODEL-SERVE-001-V12's
   * blocker, and the same host observed succeeding and failing an hour
   * apart). An absent fetch is not a flat tag. On a failure there are no
   * readings at all, so only `lastFetchOutcome` moves and the two timestamps
   * stay exactly where they were: nothing arrived, so nothing arrived.
   *
   * BEST-EFFORT BY DESIGN: a write failure here is logged and dropped. The
   * window's own scored record is the thing that must not be lost, and this
   * is derived state that the next fetch will rewrite anyway.
   */
  private async writeTagObservations(
    modelId: string,
    windowId: string,
    readings: Record<
      string,
      { last_value: number; last_status: number; observed_at: string }
    >,
    outcome: FetchOutcome,
  ): Promise<void> {
    try {
      if (outcome !== 'SUCCEEDED') {
        // No readings to fold — record only that the fetch failed, on the
        // rows this model already has. `updateMany` so a model with no rows
        // yet is a no-op rather than an error.
        await this.prisma.tagObservation.updateMany({
          where: { modelId },
          data: { lastFetchOutcome: outcome, lastWindowId: windowId },
        });
        return;
      }

      // `readings` is guaranteed an object by the zod `.default({})` on the
      // materialize schema, but the guard stays: a caller that bypasses
      // that parse (a test mocking the client directly, a future internal
      // call site) would otherwise throw INSIDE the best-effort catch,
      // which turns a missing feature into a silent warning rather than a
      // visible one.
      const tags = Object.keys(readings ?? {});
      if (tags.length === 0) return;

      const existing = await this.prisma.tagObservation.findMany({
        where: { modelId, tag: { in: tags } },
        select: {
          tag: true,
          lastValue: true,
          lastChangedAt: true,
          lastSeenAt: true,
        },
      });
      const byTag = new Map(existing.map((r) => [r.tag, r]));
      const now = new Date();

      for (const tag of tags) {
        const reading = readings[tag]!;
        const prior = byTag.get(tag) ?? null;
        const next = nextTagObservation(
          {
            lastValue: reading.last_value,
            lastStatus: reading.last_status,
            observedAt: reading.observed_at,
          },
          prior
            ? {
                lastValue: prior.lastValue,
                lastChangedAt: prior.lastChangedAt,
                lastSeenAt: prior.lastSeenAt,
              }
            : null,
          now,
        );
        // Null means the reading is OLDER than what is stored — a retry or
        // a backfill replaying a past window. Current state must not walk
        // backwards, so this tag is skipped entirely: the window's own
        // record already holds that history.
        if (!next) continue;
        // Upsert on the (modelId, tag) unique key — the constraint is what
        // makes "updated in place" enforceable by the database rather than
        // by every caller remembering to.
        await this.prisma.tagObservation.upsert({
          where: { modelId_tag: { modelId, tag } },
          create: { modelId, tag, lastWindowId: windowId, ...next },
          update: { lastWindowId: windowId, ...next },
        });
      }
    } catch (err) {
      this.logger.warn(
        `TagObservation write failed for model ${modelId}: ${msg(err)}`,
      );
    }
  }

  private async fail(windowId: string, reason: string): Promise<void> {
    const failed = await this.prisma.inferenceWindow.update({
      where: { id: windowId },
      data: {
        status: 'FAILED',
        failureReason: reason.slice(0, 2000),
        finishedAt: new Date(),
        tokenExpiresAt: new Date(0),
      },
    });

    // MODEL-SERVE-009-T02. A failed fetch is its OWN outcome and must not
    // leave the per-tag rows untouched: MODEL-SERVE-009's findings[9] —
    // an absent fetch is not a flat tag, and this host is measurably
    // intermittent. Timestamps stay where they were (nothing arrived), only
    // the outcome moves, so a reader can tell "flat for six hours" from
    // "unreachable for six hours".
    await this.writeTagObservations(failed.modelId, windowId, {}, 'FAILED');
  }

  /** Public since MODEL-SERVE-005-T03: the truth sweeper resolves the same
   *  source from the same stored `fetchConfig`, and must not grow a second
   *  copy of this mapping to disagree with. */
  asFetchConfig(value: unknown): {
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
  async resolveSource(
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
