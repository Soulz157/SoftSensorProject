import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '@softsensor/prisma';
import { joinInferenceWindowTruth } from '@/lib/python-preprocess-client';
import { formatDtHour } from '@/lib/inference-windows';
import { env } from '@/config/env.config';
import { InferenceWindowSchedulerService } from './inference-window-scheduler.service';

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * MODEL-SERVE-005-T03. Re-fetch the target tag for windows whose truth lag
 * has elapsed, and join it to the predictions those windows already wrote.
 *
 * A SEPARATE SWEEP, NOT PART OF THE SCHEDULER TICK. MODEL-SERVE-006-T02's
 * rule is that the tick inserts windows and reconciles and does nothing
 * else, for a reason that applies here twice over: a truth join is a real
 * fetch against a historian, and letting it share the tick would make a
 * slow lab source delay the inserts whose absence is a permanent gap in the
 * monitoring record.
 *
 * A JOIN IS NOT ONCE-AND-TERMINAL. Truth is late AND incremental — a window
 * joined at a 24h lag holding one lab sample may hold three at 72h — so
 * this sweep RE-joins, updating the same row, until the schedule's own
 * `truthHorizonHours` ends it. Two guards keep that from becoming a
 * re-fetch storm: `nextJoinAfter` backs off geometrically after any join
 * that added no new truth, and the batch size bounds one pass.
 */
@Injectable()
export class InferenceTruthSweeperService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(InferenceTruthSweeperService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private sweeping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduler: InferenceWindowSchedulerService,
  ) {}

  onModuleInit(): void {
    const intervalMs = env.INFERENCE_TRUTH_SWEEP_INTERVAL_MS;
    if (intervalMs <= 0) {
      this.logger.log(
        'Ground-truth join sweep disabled (INFERENCE_TRUTH_SWEEP_INTERVAL_MS <= 0).',
      );
      return;
    }
    this.timer = setInterval(() => {
      void this.sweep();
    }, intervalMs);
    this.timer.unref();
    this.logger.log(`Ground-truth join sweep scheduled every ${intervalMs}ms.`);
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * One pass. Overlap is skipped rather than queued: a sweep that outruns
   * its own interval (a slow historian) must not stack passes fetching the
   * same windows — the next tick picks up whatever this one did not reach,
   * since eligibility is recomputed from the rows every time.
   */
  async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const candidates = await this.findDueWindows();
      for (const windowId of candidates) {
        try {
          await this.joinWindow(windowId);
        } catch (err) {
          // Per window, logged and swallowed. Scheduled work has no caller
          // watching, so one unreachable source must not end the batch for
          // every other model.
          this.logger.warn(
            `Truth join failed for window ${windowId}: ${msg(err)}`,
          );
          await this.backOff(windowId, msg(err));
        }
      }
    } catch (err) {
      this.logger.warn(`Ground-truth join sweep failed: ${msg(err)}`);
    } finally {
      this.sweeping = false;
    }
  }

  /**
   * SUCCEEDED windows carrying predictions, whose schedule is enabled,
   * whose truth lag has elapsed, which are still inside their re-join
   * horizon and are not currently backed off.
   *
   * Selected in SQL per schedule rather than filtered in memory: this table
   * grows by one row per model per cadence forever, and a sweep that read
   * them all to pick a handful would get slower every day it ran.
   */
  private async findDueWindows(): Promise<string[]> {
    const schedules = await this.prisma.inferenceSchedule.findMany({
      where: { enabled: true },
      select: {
        modelId: true,
        truthLagMinutes: true,
        truthHorizonHours: true,
      },
    });
    if (schedules.length === 0) return [];

    const now = new Date();
    const due: string[] = [];

    for (const schedule of schedules) {
      const remaining = env.INFERENCE_TRUTH_BATCH_SIZE - due.length;
      if (remaining <= 0) break;

      // The lab has had time to report on anything ending before this.
      const truthReadyBefore = new Date(
        now.getTime() - schedule.truthLagMinutes * 60_000,
      );
      // Past the horizon a window's numbers are final; stop re-asking.
      const horizonAfter = new Date(
        now.getTime() - schedule.truthHorizonHours * 3_600_000,
      );

      const rows = await this.prisma.inferenceWindow.findMany({
        where: {
          modelId: schedule.modelId,
          status: 'SUCCEEDED',
          predictionsKey: { not: null },
          windowEnd: { lte: truthReadyBefore, gte: horizonAfter },
          OR: [
            { truth: { is: null } },
            { truth: { nextJoinAfter: null } },
            { truth: { nextJoinAfter: { lte: now } } },
          ],
        },
        select: { id: true },
        orderBy: { windowStart: 'asc' },
        take: remaining,
      });
      due.push(...rows.map((r) => r.id));
    }

    return due;
  }

  /**
   * Join ONE window. Also the manual re-join route's implementation — there
   * is no second code path for a human-triggered join, the same rule
   * MODEL-SERVE-006-T11 applies to backfill.
   */
  async joinWindow(windowId: string): Promise<void> {
    const window = await this.prisma.inferenceWindow.findUnique({
      where: { id: windowId },
      select: {
        id: true,
        modelId: true,
        modelVersionId: true,
        windowStart: true,
        windowEnd: true,
        predictionsKey: true,
        truth: { select: { truthRows: true, joinAttempts: true } },
      },
    });
    if (!window?.predictionsKey) {
      throw new Error(`Window ${windowId} has no predictions to join against.`);
    }

    const schedule = await this.prisma.inferenceSchedule.findUnique({
      where: { modelId: window.modelId },
    });
    if (!schedule) {
      throw new Error(`Model ${window.modelId} has no inference schedule.`);
    }

    // The target of the window's OWN pinned version, never the model's
    // current one — MODEL-SERVE-006-T07 allows two versions to score one
    // windowStart, and two versions can carry different targets.
    const version = await this.prisma.modelVersion.findUnique({
      where: { id: window.modelVersionId },
      select: { sourceRun: { select: { targetY: true } } },
    });
    const targetColumn = version?.sourceRun?.targetY;
    if (!targetColumn) {
      throw new Error(
        `ModelVersion ${window.modelVersionId} has no target column on its source run.`,
      );
    }

    const fetchConfig = this.scheduler.asFetchConfig(schedule.fetchConfig);
    const source = await this.scheduler.resolveSource(
      schedule.sourceId,
      fetchConfig,
    );
    const { dt, hour } = formatDtHour(window.windowStart);
    const toleranceSeconds = schedule.truthToleranceMinutes * 60;

    const result = await joinInferenceWindowTruth({
      predictions_key: window.predictionsKey,
      target_column: targetColumn,
      model_id: window.modelId,
      model_version_id: window.modelVersionId,
      dt,
      hour,
      // `Z`-suffixed, via toISOString() — the format every timestamp in
      // this system uses, and the one this feature's own `+00:00` bug
      // (apps/serving's requestedAt) was fixed to emit.
      window_start: window.windowStart.toISOString(),
      window_end: window.windowEnd.toISOString(),
      tolerance_seconds: toleranceSeconds,
      ...source,
    });

    const previousTruthRows = window.truth?.truthRows ?? 0;
    const attempts = (window.truth?.joinAttempts ?? 0) + 1;
    // "Idle" means the source returned no MORE truth than last time. A join
    // that found new samples resets the backoff to its base, because a lab
    // that has started reporting is likely to report again.
    const gainedTruth = result.truth_rows > previousTruthRows;
    const nextJoinAfter = gainedTruth
      ? new Date(
          Date.now() + env.INFERENCE_TRUTH_RETRY_BACKOFF_MINUTES * 60_000,
        )
      : this.backoffFrom(attempts);

    const payload = {
      modelId: window.modelId,
      modelVersionId: window.modelVersionId,
      windowStart: window.windowStart,
      targetColumn,
      pairsKey: result.object_key,
      pairsChecksum: result.checksum,
      truthRows: result.truth_rows,
      pairedRows: result.paired_rows,
      predictionRows: result.prediction_rows,
      n: result.n,
      sumSe: result.sum_se,
      sumAe: result.sum_ae,
      sumSigned: result.sum_signed,
      sumActual: result.sum_actual,
      sumActualSq: result.sum_actual_sq,
      toleranceSeconds,
      // What this row's numbers actually reflect — the end of the range the
      // join just read, not "now".
      joinedThrough: window.windowEnd,
      nextJoinAfter,
      joinAttempts: attempts,
      lastJoinedAt: new Date(),
      // This join succeeded, so any recorded failure is now history. Cleared
      // rather than left behind, so `failureReason` always describes the
      // CURRENT state of the row and not an outage that has since ended.
      failureReason: null,
    };

    // UPSERT on the window's own unique key, so a re-join REPLACES this
    // row's statistics rather than inserting a second row beside it. No
    // P2002 handling is needed or attempted here: `windowId` is unique and
    // upsert is precisely the operation that means "one row per window".
    await this.prisma.inferenceWindowTruth.upsert({
      where: { windowId: window.id },
      create: { windowId: window.id, ...payload },
      update: payload,
    });
  }

  /** Geometric, capped at a day — an idle window is asked less and less
   *  often, but never stops being asked before its horizon, which is what
   *  actually ends re-joining. */
  private backoffFrom(attempts: number): Date {
    const base = env.INFERENCE_TRUTH_RETRY_BACKOFF_MINUTES;
    const minutes = Math.min(base * 2 ** Math.max(0, attempts - 1), 24 * 60);
    return new Date(Date.now() + minutes * 60_000);
  }

  /**
   * A FAILED join backs off too, and a window that has NEVER joined gets a
   * row written for it here.
   *
   * That row is load-bearing, not diagnostic. `findDueWindows` treats
   * `truth: { is: null }` as eligible and orders `windowStart` ASC, so a
   * window that can never join — a version whose `sourceRun.targetY` is
   * null, a deleted `DataSource`, an unsupported source type, each of which
   * throws before any upsert — would otherwise sit at the head of EVERY
   * subsequent sweep. At the default 168h horizon and an hourly cadence
   * that is up to 168 permanently-failing windows against a batch of 25:
   * newer, joinable windows are never reached, and the only symptom is a
   * log line.
   *
   * Writing zeros publishes nothing: `poolTruthStats` skips `n <= 0` and
   * `getTruthService` filters the same rows out before any metric is
   * computed, so a failure row can never be mistaken for a real empty join
   * — `failureReason` is the difference, and it is only ever set here.
   */
  private async backOff(windowId: string, reason: string): Promise<void> {
    try {
      const existing = await this.prisma.inferenceWindowTruth.findUnique({
        where: { windowId },
        select: { joinAttempts: true },
      });
      const attempts = (existing?.joinAttempts ?? 0) + 1;
      const nextJoinAfter = this.backoffFrom(attempts);

      if (existing) {
        // An established row keeps every statistic it earned. A source that
        // goes down after a successful join must not erase the pairs that
        // join already produced.
        await this.prisma.inferenceWindowTruth.update({
          where: { windowId },
          data: {
            joinAttempts: attempts,
            nextJoinAfter,
            failureReason: reason,
          },
        });
        return;
      }

      const window = await this.prisma.inferenceWindow.findUnique({
        where: { id: windowId },
        select: {
          modelId: true,
          modelVersionId: true,
          windowStart: true,
          windowEnd: true,
        },
      });
      // Deleted mid-sweep. Nothing to anchor a row to, and the cascade would
      // have removed it anyway.
      if (!window) return;

      await this.prisma.inferenceWindowTruth.create({
        data: {
          windowId,
          modelId: window.modelId,
          modelVersionId: window.modelVersionId,
          windowStart: window.windowStart,
          // Unknown by construction: resolving the target is one of the
          // things that can fail here.
          targetColumn: null,
          truthRows: 0,
          pairedRows: 0,
          predictionRows: 0,
          n: 0,
          sumSe: 0,
          sumAe: 0,
          sumSigned: 0,
          sumActual: 0,
          sumActualSq: 0,
          toleranceSeconds: 0,
          joinedThrough: window.windowEnd,
          nextJoinAfter,
          joinAttempts: attempts,
          lastJoinedAt: new Date(),
          failureReason: reason,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Could not record truth-join backoff for window ${windowId}: ${msg(err)}`,
      );
    }
  }
}
