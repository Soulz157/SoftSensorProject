import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@softsensor/prisma';
import { AppException } from '@softsensor/common';
import { LOADER_SINK } from './loader.tokens';
import type { LoaderSink } from './loader-sink.interface';

/**
 * DS-LAKE-011: in-process runner for the loader seam — the asynchronous
 * hand-off from a committed DatasetVersion to a serving-layer sink.
 *
 * Mirrors `PreprocessingJobService`'s shape deliberately (T01/T04), reusing
 * the same reasoning for why no queue is introduced (CLAUDE.md §11: no
 * Redis/BullMQ/Celery in this repo, verified not assumed) and the same
 * single-replica boot-sweep assumption. Simpler than that runner in one
 * respect: a load is ONE sink call, not a chained multi-operation pipeline,
 * so there is no per-step progress, no tmp intermediates, and no cancel
 * surface — nothing in this feature's acceptance criteria or verification
 * asks for one, so none is built (smallest safe solution).
 *
 *   QUEUED --> RUNNING --> SUCCEEDED
 *                \-------> FAILED (error recorded)
 *
 * AC0 ("a loader failure never fails or rolls back Save") holds by
 * construction: `enqueue` is only ever called AFTER Save Dataset's own
 * `$transaction` has committed (see `saveDraftAsDatasetService`'s call
 * site), and `enqueue` itself never throws into that caller — job creation
 * and the fire-and-forget `run()` are both wrapped so a loader-side failure
 * surfaces as a FAILED job row, never as an exception out of Save.
 */
@Injectable()
export class LoaderJobService implements OnModuleInit {
  private readonly logger = new Logger(LoaderJobService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(LOADER_SINK) private readonly sink: LoaderSink,
  ) {}

  async onModuleInit() {
    const { count } = await this.prisma.loaderJob.updateMany({
      where: { status: 'RUNNING' },
      data: {
        status: 'FAILED',
        error: 'Interrupted — the server restarted while this job was running.',
        finishedAt: new Date(),
      },
    });
    if (count > 0) {
      this.logger.warn(`Swept ${count} interrupted loader job(s) to FAILED.`);
    }
  }

  /**
   * Creates the QUEUED row and starts the run WITHOUT awaiting it — the
   * caller (Save Dataset) must not block its own HTTP response on a
   * serving-layer sink, and a sink failure must never propagate back into
   * Save. Never throws for a sink-side failure; only a genuine inability to
   * write the job row itself would (Prisma/DB failure), which is the same
   * failure class Save's own transaction is already exposed to.
   */
  async enqueue(
    datasetId: string,
    versionId: string,
    createdById: string,
  ): Promise<string> {
    const job = await this.prisma.loaderJob.create({
      data: { datasetId, versionId, status: 'QUEUED', createdById },
    });
    this.start(job.id);
    return job.id;
  }

  start(jobId: string): void {
    void this.run(jobId).catch((err: unknown) => {
      this.logger.error(
        `Loader job ${jobId} failed outside its own handler`,
        err,
      );
    });
  }

  /**
   * DS-LAKE-011-T04: independent retry. Creates a NEW job row referencing
   * the SAME dataset/version — mirrors `retryJobService`'s exact pattern —
   * so the original FAILED row's history is left untouched (DS-LAKE-011-V02)
   * rather than being overwritten in place. `attempts` is carried forward
   * from the previous row; the runner increments it on start, same as
   * PreprocessingJobService.
   */
  async retry(jobId: string): Promise<{ jobId: string; retryOf: string }> {
    const previous = await this.prisma.loaderJob.findUnique({
      where: { id: jobId },
    });
    if (!previous) {
      throw new AppException({
        statusCode: 404,
        message: 'Loader job not found',
        type: 'ERROR',
      });
    }
    if (previous.status !== 'FAILED' && previous.status !== 'CANCELED') {
      throw new AppException({
        statusCode: 409,
        message: 'Only a failed or canceled loader job can be retried.',
        type: 'ERROR',
      });
    }

    const job = await this.prisma.loaderJob.create({
      data: {
        datasetId: previous.datasetId,
        versionId: previous.versionId,
        status: 'QUEUED',
        attempts: previous.attempts,
        createdById: previous.createdById,
      },
    });
    this.start(job.id);

    return { jobId: job.id, retryOf: previous.id };
  }

  private async run(jobId: string): Promise<void> {
    const job = await this.prisma.loaderJob.findUnique({
      where: { id: jobId },
    });
    if (!job) {
      this.logger.error(`Loader job ${jobId} not found; refusing to run.`);
      return;
    }

    await this.prisma.loaderJob.update({
      where: { id: jobId },
      data: {
        status: 'RUNNING',
        startedAt: new Date(),
        attempts: { increment: 1 },
      },
    });

    try {
      await this.sink.load({
        datasetId: job.datasetId,
        versionId: job.versionId,
      });
      await this.prisma.loaderJob.update({
        where: { id: jobId },
        data: { status: 'SUCCEEDED', finishedAt: new Date() },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Loader job ${jobId} failed: ${message}`);
      await this.prisma.loaderJob.update({
        where: { id: jobId },
        data: { status: 'FAILED', error: message, finishedAt: new Date() },
      });
    }
  }

  async getStatus(datasetId: string, jobId: string) {
    const job = await this.prisma.loaderJob.findFirst({
      where: { id: jobId, datasetId },
    });
    if (!job) {
      throw new AppException({
        statusCode: 404,
        message: 'Loader job not found',
        type: 'ERROR',
      });
    }
    return job;
  }
}
