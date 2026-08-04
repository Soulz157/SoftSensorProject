import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService, PrismaTypes } from '@softsensor/prisma';
import { AppException } from '@softsensor/common';
import { postToPython, PYTHON_TIMEOUT } from '@/lib/python-client';
import {
  ArtifactStatsSchema,
  PythonCleanupSchema,
  type ArtifactStats,
  type CleaningOperation,
} from './dto/dataset-version.authorized.dto';

/**
 * In-process runner for preprocessing jobs.
 *
 * No queue is introduced (CLAUDE.md §11): there is no Redis, BullMQ or Celery
 * in this repo to reuse — verified, not assumed — and adding one for a single
 * job type would be new infrastructure for a workload that a Postgres row plus
 * an in-memory token already covers.
 *
 * Shape of a run
 * --------------
 * One `postToPython` call PER OPERATION, chaining object keys through
 * `{datasetId}/tmp/{jobId}/`. That buys real per-operation progress, natural
 * cancellation points, and keeps every individual call far inside its timeout
 * instead of one five-minute request. The cost is extra round trips to storage;
 * the intermediates are deleted on success.
 *
 *   QUEUED --> RUNNING --> SUCCEEDED
 *                |   \---> FAILED    (error recorded, tmp KEPT for debugging)
 *                \-------> CANCELED  (tmp deleted)
 *
 * The commit
 * ----------
 * The LAST operation writes straight to the committed version key, then the
 * DatasetVersion row and the job's SUCCEEDED status are written in one
 * `$transaction`. There is no promote/copy step — it would double the I/O for a
 * window that cannot be closed anyway. Two consequences worth knowing:
 *
 *   * a crash between the artifact write and the transaction leaves an ORPHAN
 *     object at the version key. It is unreferenced, not corrupt.
 *   * because that key may already exist and committed keys are immutable, a
 *     RETRY must mint a NEW versionId rather than reuse the failed one. That
 *     falls out of retry creating a new job row, since the id is minted here.
 *
 * SINGLE REPLICA ONLY
 * -------------------
 * `onModuleInit` sweeps every RUNNING row to FAILED, on the assumption that
 * such a row can only be this process's own leftover from a hard kill. With two
 * replicas, a boot would kill the other replica's live jobs. The escape hatch is
 * `SELECT ... FOR UPDATE SKIP LOCKED` plus an owner column — still no Redis.
 */

/**
 * How long to wait before re-clearing a cancelled job's tmp prefix. Sized to
 * outlast one connector step on a large artifact, not to be a guarantee.
 */
const STRAGGLER_SWEEP_MS = 30_000;

/** Progress for a step about to start, not one that finished. */
interface StepProgress {
  completedSteps: number;
  totalSteps: number;
  currentStep: string;
  startedAt: number;
}

@Injectable()
export class PreprocessingJobService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(PreprocessingJobService.name);

  /** Live cancellation tokens, keyed by job id. Necessarily empty at boot. */
  private readonly running = new Map<string, AbortController>();

  /**
   * Set once shutdown begins.
   *
   * Without it, a shutdown is indistinguishable from a user cancel: both abort
   * the same token, so `recordFailure` would see `signal.aborted` and write
   * "Canceled by the user" — and because it runs AFTER
   * `onApplicationShutdown`'s sweep, that wrong message wins. A restarted
   * server would then blame a user who never clicked anything.
   */
  private shuttingDown = false;

  constructor(private readonly prisma: PrismaService) {}

  // ── lifecycle ────────────────────────────────────────────────────────────

  /**
   * Any RUNNING row at boot is a lie: this process just started, so nothing can
   * be running. Left alone, the job sits at RUNNING forever and the UI polls
   * something that will never move.
   */
  async onModuleInit() {
    const { count } = await this.prisma.preprocessingJob.updateMany({
      where: { status: 'RUNNING' },
      data: {
        status: 'FAILED',
        error: 'Interrupted — the server restarted while this job was running.',
        finishedAt: new Date(),
      },
    });
    if (count > 0) {
      this.logger.warn(
        `Swept ${count} interrupted preprocessing job(s) to FAILED.`,
      );
    }
  }

  /**
   * Graceful shutdown: abort in-flight work and say so, keeping a job killed by
   * a deploy distinguishable from one that failed on its own.
   */
  async onApplicationShutdown() {
    this.shuttingDown = true;
    const ids = [...this.running.keys()];
    for (const controller of this.running.values()) controller.abort();
    this.running.clear();

    if (ids.length === 0) return;
    await this.prisma.preprocessingJob.updateMany({
      where: { id: { in: ids }, status: 'RUNNING' },
      data: {
        status: 'FAILED',
        error: 'Interrupted by server shutdown.',
        finishedAt: new Date(),
      },
    });
  }

  // ── control ──────────────────────────────────────────────────────────────

  /**
   * Fire and forget. The caller has already returned 202, so a rejection here
   * has nowhere to propagate — it must be caught or it becomes an unhandled
   * rejection and the job row is left stuck at RUNNING.
   */
  start(jobId: string): void {
    void this.run(jobId).catch((err: unknown) => {
      this.logger.error(`Job ${jobId} failed outside its own handler`, err);
    });
  }

  /**
   * Cancellation is cooperative. The token is checked between operations AND
   * handed to `postToPython`, so an abort interrupts the in-flight HTTP call
   * instead of waiting up to `PYTHON_TIMEOUT.preprocess` (5 min) for it to
   * finish. Without that, "cancel" would mean "cancel eventually".
   */
  cancel(jobId: string): boolean {
    const controller = this.running.get(jobId);
    if (!controller) return false;
    controller.abort();
    this.running.delete(jobId);
    return true;
  }

  isRunning(jobId: string): boolean {
    return this.running.has(jobId);
  }

  // ── the run ──────────────────────────────────────────────────────────────

  private async run(jobId: string): Promise<void> {
    const job = await this.prisma.preprocessingJob.findUnique({
      where: { id: jobId },
      include: { sourceVersion: true },
    });
    if (!job?.sourceVersion) {
      this.logger.error(`Job ${jobId} has no source version; refusing to run.`);
      return;
    }

    const operations = this.readOperations(job.operations);
    const precision = this.readPrecision(job.operations);
    const controller = new AbortController();
    this.running.set(jobId, controller);

    const startedAt = Date.now();
    // Minted up front so the final step can write directly to its key.
    const versionId = randomUUID();
    const versionKey = `${job.datasetId}/${versionId}.parquet`;
    const tmpPrefix = `${job.datasetId}/tmp/${jobId}/`;

    await this.prisma.preprocessingJob.update({
      where: { id: jobId },
      data: {
        status: 'RUNNING',
        startedAt: new Date(),
        totalSteps: operations.length,
        completedSteps: 0,
        progress: 0,
        attempts: { increment: 1 },
      },
    });

    try {
      let sourceKey = job.sourceVersion.objectKey;
      let stats: ArtifactStats | null = null;

      for (const [index, operation] of operations.entries()) {
        this.assertNotCanceled(controller);

        const isLast = index === operations.length - 1;
        // Only the final step writes the committed key; earlier ones go to tmp
        // so a failure leaves each stage intact and inspectable.
        const targetKey = isLast
          ? versionKey
          : `${tmpPrefix}${index + 1}.parquet`;

        await this.reportStep(jobId, {
          completedSteps: index,
          totalSteps: operations.length,
          currentStep: this.describe(operation),
          startedAt,
        });

        stats = ArtifactStatsSchema.parse(
          await postToPython(
            '/v1/preprocess/clean',
            {
              source_key: sourceKey,
              target_key: targetKey,
              operations: [operation],
              precision,
              // tmp steps may be rewritten by a retry; a committed key never.
              overwrite: !isLast,
            },
            PYTHON_TIMEOUT.preprocess,
            controller.signal,
          ),
        );

        sourceKey = targetKey;
      }

      this.assertNotCanceled(controller);
      if (!stats) {
        throw new AppException({
          statusCode: 400,
          message: 'A cleaning job needs at least one operation.',
          type: 'ERROR',
        });
      }

      await this.commit(job, versionId, stats, operations, startedAt);
      await this.clearTmp(tmpPrefix);
    } catch (err) {
      await this.recordFailure(jobId, tmpPrefix, controller, err);
    } finally {
      this.running.delete(jobId);
    }
  }

  /**
   * The version row and the job's terminal status must land together: a
   * committed version whose job still reads RUNNING, and a SUCCEEDED job with
   * no version, are both states the UI cannot recover from (CLAUDE.md §5).
   */
  private async commit(
    job: {
      id: string;
      datasetId: string;
      createdById: string;
      sourceVersionId: string | null;
    },
    versionId: string,
    stats: ArtifactStats,
    operations: CleaningOperation[],
    startedAt: number,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Numbered INSIDE the transaction so two concurrent jobs on one dataset
      // cannot read the same max and collide on
      // @@unique([datasetId, versionNumber]).
      const previous = await tx.datasetVersion.findFirst({
        where: { datasetId: job.datasetId },
        orderBy: { versionNumber: 'desc' },
        select: { versionNumber: true },
      });

      const version = await tx.datasetVersion.create({
        data: {
          id: versionId,
          datasetId: job.datasetId,
          parentVersionId: job.sourceVersionId,
          versionNumber: (previous?.versionNumber ?? 0) + 1,
          stage: 'CLEAN',
          objectKey: stats.object_key,
          rowCount: stats.row_count,
          columnCount: stats.column_count,
          missingPct: stats.missing_pct,
          sizeBytes: stats.size_bytes,
          operations,
          durationMs: Date.now() - startedAt,
          createdById: job.createdById,
        },
      });

      await tx.preprocessingJob.update({
        where: { id: job.id },
        data: {
          status: 'SUCCEEDED',
          progress: 100,
          completedSteps: operations.length,
          currentStep: null,
          estimatedRemainingMs: 0,
          resultVersionId: version.id,
          finishedAt: new Date(),
        },
      });

      await tx.dataset.update({
        where: { id: job.datasetId },
        data: { currentVersionId: version.id },
      });
    });
  }

  private async recordFailure(
    jobId: string,
    tmpPrefix: string,
    controller: AbortController,
    err: unknown,
  ): Promise<void> {
    // A shutdown aborts the same token a user cancel does, so `aborted` alone
    // cannot tell them apart — and this write lands AFTER the shutdown sweep,
    // so getting it wrong here is what the user ends up reading.
    const interrupted = this.shuttingDown;
    const canceled = controller.signal.aborted && !interrupted;

    if (canceled) {
      // Nothing was committed, so the intermediates are pure waste.
      await this.clearTmp(tmpPrefix);
      // Aborting the HTTP call does NOT stop the connector: it already has the
      // request and finishes that step server-side, writing its output AFTER
      // the sweep above. Observed live — a cancel left one straggler behind.
      this.scheduleStragglerSweep(tmpPrefix);
    } else if (interrupted) {
      // No cleanup call during shutdown: the process is going away, the
      // request would likely fail anyway, and the intermediates are useful for
      // working out how far the job got before it was killed.
      this.logger.warn(`Job ${jobId} interrupted by shutdown; keeping tmp.`);
    } else {
      // Deliberately KEPT on failure: the partial artifacts are the only
      // evidence of which step went wrong and what it produced.
      this.logger.warn(
        `Job ${jobId} failed; leaving ${tmpPrefix} in place for inspection.`,
      );
    }

    await this.prisma.preprocessingJob.update({
      where: { id: jobId },
      data: {
        status: canceled ? 'CANCELED' : 'FAILED',
        error: canceled
          ? 'Canceled by the user.'
          : interrupted
            ? 'Interrupted by server shutdown.'
            : this.readMessage(err),
        currentStep: null,
        finishedAt: new Date(),
      },
    });
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private assertNotCanceled(controller: AbortController): void {
    if (controller.signal.aborted) {
      throw new AppException({
        statusCode: 499,
        message: 'Job canceled.',
        type: 'ERROR',
      });
    }
  }

  private async reportStep(jobId: string, step: StepProgress): Promise<void> {
    // Progress is per OPERATION, not per row: one operation over millions of
    // rows shows no movement until it finishes. Recorded as a known limitation
    // rather than faked with a timer, which would be worse — a bar that moves
    // while nothing happens is a lie the user cannot detect.
    const elapsed = Date.now() - step.startedAt;
    const remaining = step.totalSteps - step.completedSteps;
    const perStep =
      step.completedSteps > 0 ? elapsed / step.completedSteps : null;

    await this.prisma.preprocessingJob.update({
      where: { id: jobId },
      data: {
        progress: Math.round((step.completedSteps / step.totalSteps) * 100),
        completedSteps: step.completedSteps,
        currentStep: step.currentStep,
        estimatedRemainingMs: perStep ? Math.round(perStep * remaining) : null,
      },
    });
  }

  /**
   * Re-clear a cancelled job's tmp prefix once, after the connector has had
   * time to finish the step that was in flight when the abort landed.
   *
   * Deliberately fire-and-forget and `unref`ed: it must not hold the process
   * open at shutdown, and a straggler that outlives the window is an
   * unreferenced object under `tmp/` — wasted storage, never wrong data. The
   * alternative, blocking the cancel until the connector responds, would make
   * "cancel" wait on the very work the user asked to stop.
   */
  private scheduleStragglerSweep(prefix: string): void {
    const timer = setTimeout(() => {
      void this.clearTmp(prefix);
    }, STRAGGLER_SWEEP_MS);
    timer.unref();
  }

  private async clearTmp(prefix: string): Promise<void> {
    try {
      PythonCleanupSchema.parse(
        await postToPython(
          '/v1/preprocess/cleanup',
          { prefix },
          PYTHON_TIMEOUT.metadata,
        ),
      );
    } catch (err) {
      // Best effort. Orphaned intermediates cost storage, not correctness, and
      // failing over them would turn a successful run into a failed one.
      this.logger.warn(`Could not clear ${prefix}: ${this.readMessage(err)}`);
    }
  }

  private describe(operation: CleaningOperation): string {
    return operation.method
      ? `${operation.type}/${operation.method}`
      : operation.type;
  }

  /**
   * `PreprocessingJob.operations` stores `{ operations, precision }` together,
   * because precision is part of the recipe that produced a version and has to
   * replay with it. Older rows may hold a bare array.
   */
  private readOperations(raw: PrismaTypes.JsonValue): CleaningOperation[] {
    const list = Array.isArray(raw)
      ? raw
      : (raw as { operations?: unknown } | null)?.operations;
    // Shape is not re-validated here: the same array was zod-parsed by
    // `StartCleanJobSchema` on the way in, and Python rejects an unknown
    // operation with an actionable 422 regardless.
    return Array.isArray(list) ? (list as CleaningOperation[]) : [];
  }

  private readPrecision(raw: PrismaTypes.JsonValue): Record<string, number> {
    if (Array.isArray(raw) || raw === null) return {};
    const payload = raw as { precision?: Record<string, number> };
    return payload?.precision ?? {};
  }

  /**
   * Never surface a raw error. `AppException` messages are ours and safe; an
   * arbitrary throw can carry connector detail, and this string is persisted on
   * the job row and shown to the user.
   */
  private readMessage(err: unknown): string {
    if (err instanceof AppException) return err.message;
    return 'Preprocessing failed. See the server logs for details.';
  }
}
