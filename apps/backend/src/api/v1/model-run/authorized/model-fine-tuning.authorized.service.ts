import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService, PrismaTypes } from '@softsensor/prisma';
import { AppException } from '@softsensor/common';
import { CreateFineTuningJobDto } from './dto/model-fine-tuning.authorized.dto';
import { CreateTrainingRunDto } from './dto/model-run.authorized.dto';
import { ModelRunLaunchAuthorizedService } from './model-run-launch.authorized.service';

/**
 * MODEL-FLOW-005. "Fine-tuning" = a hyperparameter search: one algorithm, one
 * artifact, one split, N hyperparameter sets tried in sequence, best kept
 * (decisions.fine_tuning_undefined, 2026-08-25). No new spawn/claim/complete
 * path exists — every hyperparameter set is an ordinary `ModelTrainingRun`,
 * tagged with `fineTuningJobId`, launched through the exact machinery
 * MODEL-FLOW-003 already built and live-verified
 * (`ModelRunLaunchAuthorizedService.launchDraftRun`). This service only
 * decides WHEN to launch the next one and WHICH run wins.
 *
 * Advancing a job is IDEMPOTENT and callable from two places, both handled
 * identically by `advanceJobForRun`: `ModelRunAuthorizedService.complete()`
 * calls it as a best-effort nudge the instant a child run's webhook lands
 * (the fast path), and `getJobService` calls it opportunistically on every
 * read (the reconciling path) — so a job whose nudge was lost (a crash
 * between the run's DB write and the nudge, the same class of gap
 * MODEL-FLOW-011-T04 already tracks for a single run) still advances the
 * next time anyone looks at it. Both paths funnel through one
 * compare-and-swap `updateMany` keyed on `(id, currentRunId, status)`, so
 * calling it twice for the same terminated run is a no-op the second time —
 * no separate locking, no queue.
 */
@Injectable()
export class ModelFineTuningAuthorizedService {
  private readonly log = new Logger(ModelFineTuningAuthorizedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly runLaunch: ModelRunLaunchAuthorizedService,
  ) {}

  private isUniqueViolation(err: unknown): boolean {
    return (
      err instanceof PrismaTypes.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    );
  }

  private extractRmse(metrics: unknown): number | null {
    if (!metrics || typeof metrics !== 'object') return null;
    const rmse = (metrics as Record<string, unknown>).rmse;
    return typeof rmse === 'number' && Number.isFinite(rmse) ? rmse : null;
  }

  private runDtoFor(
    job: {
      goldArtifactId: string;
      targetY: string;
      algorithm: string;
      trainTestSplit: number | null;
    },
    hyperparameters: Record<string, unknown>,
  ): CreateTrainingRunDto {
    return {
      goldArtifactId: job.goldArtifactId,
      targetY: job.targetY,
      algorithm: job.algorithm as CreateTrainingRunDto['algorithm'],
      hyperparameters,
      trainTestSplit: job.trainTestSplit ?? undefined,
    } as CreateTrainingRunDto;
  }

  /**
   * MODEL-FLOW-005-T01/T02/T03/T04. Creates the job row and launches its
   * FIRST run in the same request — mirrors `createDraftRunService`'s own
   * synchronous validate-then-spawn shape, so a job that comes back 201
   * really has started, the same guarantee a single run already gives.
   */
  async createJob(
    draftId: string,
    dto: CreateFineTuningJobDto,
    userId: string,
    role: string,
  ) {
    await this.runLaunch.assertDraftWritable(draftId, userId, role);

    let job;
    try {
      job = await this.prisma.modelFineTuningJob.create({
        data: {
          modelDraftId: draftId,
          algorithm: dto.algorithm,
          targetY: dto.targetY,
          goldArtifactId: dto.goldArtifactId,
          trainTestSplit: dto.trainTestSplit ?? null,
          hyperparameterSets: dto.hyperparameterSets,
          totalRuns: dto.hyperparameterSets.length,
          createdById: userId,
          status: 'QUEUED',
        },
      });
    } catch (err) {
      // The partial unique index (one QUEUED/RUNNING job per draft,
      // migration 20260825030923) is the actual guarantee — this only turns
      // its generic P2002 into a message naming the real constraint, same
      // discipline MODEL-SERVE-001-T02's own note gives for its single-
      // PRODUCTION index. Unlike dataset-draft.authorized.service.ts's
      // recorded untranslated-P2002 precedent, this race is REACHABLE (a
      // double-click on Start Fine-Tuning), not provably-unreachable-today.
      if (this.isUniqueViolation(err)) {
        throw new AppException({
          statusCode: 409,
          message: `Draft ${draftId} already has a fine-tuning job in progress.`,
          type: 'ERROR',
        });
      }
      throw err;
    }

    try {
      const firstRun = await this.runLaunch.launchDraftRun(
        draftId,
        this.runDtoFor(job, dto.hyperparameterSets[0]),
        job.id,
      );
      const updated = await this.prisma.modelFineTuningJob.update({
        where: { id: job.id },
        data: {
          status: 'RUNNING',
          currentRunId: firstRun.id,
          startedAt: new Date(),
        },
      });
      return {
        statusCode: 201,
        message: 'Fine-tuning job created',
        type: 'SUCCESS' as const,
        data: updated,
      };
    } catch (err) {
      // The job row would otherwise be stranded QUEUED with no run and no
      // way to advance. Marking FAILED also frees the partial unique index
      // immediately, so a bad first hyperparameter set does not block the
      // user from starting over.
      await this.prisma.modelFineTuningJob.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          failureReason: `Could not launch the first run: ${(err as Error).message}`,
          finishedAt: new Date(),
        },
      });
      throw err;
    }
  }

  /**
   * Advance (or fail) a job given one of its runs just reached a terminal
   * status. See this class's own doc comment for the two call sites and why
   * calling this twice for the same run is safe.
   */
  async advanceJobForRun(runId: string, jobId: string): Promise<void> {
    const [job, run] = await Promise.all([
      this.prisma.modelFineTuningJob.findUnique({ where: { id: jobId } }),
      this.prisma.modelTrainingRun.findUnique({ where: { id: runId } }),
    ]);
    // Defensive only — the FK guarantees both exist once fineTuningJobId is
    // set on a real run.
    if (!job || !run) return;
    // Already advanced past this run (a concurrent caller won the race), or
    // the job already reached a terminal status.
    if (job.currentRunId !== runId) return;
    if (job.status !== 'QUEUED' && job.status !== 'RUNNING') return;

    if (run.status === 'FAILED' || run.status === 'CANCELED') {
      // MVP semantics: any child failure fails the WHOLE search. A
      // partial-tolerance mode (skip this set, try the next) is real future
      // scope, not built here — this ledger's own precedent is to record a
      // deferral rather than build speculative flexibility nobody asked for.
      await this.prisma.modelFineTuningJob.updateMany({
        where: {
          id: jobId,
          currentRunId: runId,
          status: { in: ['QUEUED', 'RUNNING'] },
        },
        data: {
          status: 'FAILED',
          failureReason:
            `Hyperparameter set ${job.completedRuns + 1} of ${job.totalRuns} ` +
            `${run.status.toLowerCase()}${run.failureReason ? `: ${run.failureReason}` : '.'}`,
          finishedAt: new Date(),
        },
      });
      return;
    }

    if (run.status !== 'SUCCEEDED') return; // still QUEUED/RUNNING — nothing to do yet.

    const rmse = this.extractRmse(run.metrics);
    const completedRuns = job.completedRuns + 1;
    // rmse, never r2: always present and well-behaved even for a degenerate
    // fit — an observed real run scored r2 = -1,110,858 while rmse stayed a
    // sane, comparable number (see MODEL-FLOW-004's own findings).
    const isBetter =
      rmse !== null && (job.bestRmse === null || rmse < job.bestRmse);
    const sets = job.hyperparameterSets as unknown as Record<string, unknown>[];

    if (completedRuns < sets.length) {
      let nextRun;
      try {
        nextRun = await this.runLaunch.launchDraftRun(
          job.modelDraftId,
          this.runDtoFor(job, sets[completedRuns]),
          job.id,
        );
      } catch (err) {
        this.log.error(
          `fine-tuning job ${job.id}: could not launch set ${completedRuns + 1} of ${sets.length}`,
          err,
        );
        await this.prisma.modelFineTuningJob.updateMany({
          where: {
            id: jobId,
            currentRunId: runId,
            status: { in: ['QUEUED', 'RUNNING'] },
          },
          data: {
            status: 'FAILED',
            failureReason: `Could not launch hyperparameter set ${completedRuns + 1} of ${sets.length}: ${(err as Error).message}`,
            finishedAt: new Date(),
            completedRuns,
            ...(isBetter ? { bestRunId: run.id, bestRmse: rmse } : {}),
          },
        });
        return;
      }
      await this.prisma.modelFineTuningJob.updateMany({
        where: {
          id: jobId,
          currentRunId: runId,
          status: { in: ['QUEUED', 'RUNNING'] },
        },
        data: {
          status: 'RUNNING',
          completedRuns,
          currentRunId: nextRun.id,
          ...(isBetter ? { bestRunId: run.id, bestRmse: rmse } : {}),
        },
      });
      return;
    }

    // Search complete.
    const finalBestRunId = isBetter ? run.id : job.bestRunId;
    const finalBestRmse = isBetter ? rmse : job.bestRmse;
    const result = await this.prisma.modelFineTuningJob.updateMany({
      where: {
        id: jobId,
        currentRunId: runId,
        status: { in: ['QUEUED', 'RUNNING'] },
      },
      data: {
        status: 'SUCCEEDED',
        completedRuns,
        bestRunId: finalBestRunId,
        bestRmse: finalBestRmse,
        finishedAt: new Date(),
      },
    });
    if (result.count > 0 && finalBestRunId) {
      // Point the draft at the winning run. Step 4 Evaluation
      // (MODEL-FLOW-004's useDraftRunEvaluation) already falls back to
      // ModelDraft.currentRunId when its own client-side atom hint is
      // empty, so the winner becomes visible there with no client change.
      await this.prisma.modelDraft.update({
        where: { id: job.modelDraftId },
        data: { currentRunId: finalBestRunId, status: 'TRAINED' },
      });
    }
  }

  /**
   * MODEL-FLOW-005-T06, V01, V04. Reconciles before returning — a job whose
   * fast-path nudge from `complete()` was lost (process restart between the
   * run's DB write and the nudge; MODEL-FLOW-011-T04 tracks the identical
   * gap for a single run) still shows live truth on read, not a stale write.
   */
  async getJobService(
    draftId: string,
    jobId: string,
    userId: string,
    role: string,
  ) {
    await this.runLaunch.assertDraftReadable(draftId, userId, role);
    let job = await this.prisma.modelFineTuningJob.findFirst({
      where: { id: jobId, modelDraftId: draftId },
    });
    if (!job) throw new NotFoundException('Fine-tuning job not found');

    if (
      (job.status === 'QUEUED' || job.status === 'RUNNING') &&
      job.currentRunId
    ) {
      const currentRun = await this.prisma.modelTrainingRun.findUnique({
        where: { id: job.currentRunId },
        select: { status: true },
      });
      if (
        currentRun &&
        (currentRun.status === 'SUCCEEDED' ||
          currentRun.status === 'FAILED' ||
          currentRun.status === 'CANCELED')
      ) {
        await this.advanceJobForRun(job.currentRunId, job.id);
        job = await this.prisma.modelFineTuningJob.findUniqueOrThrow({
          where: { id: job.id },
        });
      }
    }

    return {
      statusCode: 200,
      message: 'Fine-tuning job fetched',
      type: 'SUCCESS' as const,
      data: job,
    };
  }

  /**
   * MODEL-FLOW-005-T08. Only a FAILED job can be retried, and only by
   * relaunching the SAME hyperparameter set that failed — `completedRuns`
   * was deliberately NOT incremented on failure (see `advanceJobForRun`),
   * so `sets[completedRuns]` is exactly that set. Retry does not know or
   * care WHY it failed — a bad hyperparameter value and a transient
   * container spawn failure both look identical here, both get one more
   * attempt at the operator's request.
   *
   * NOT covered: a job stuck RUNNING because its current run itself is
   * orphaned (a nest --watch restart killed the in-memory container
   * tracker mid-flight — MODEL-FLOW-003-V01's own observed incident). This
   * retry path only fires on FAILED; recovering a genuinely stuck RUNNING
   * run needs the same boot-reconciliation MODEL-FLOW-011-T04 already
   * tracks, not a second copy of it here.
   */
  async retryJobService(
    draftId: string,
    jobId: string,
    userId: string,
    role: string,
  ) {
    await this.runLaunch.assertDraftWritable(draftId, userId, role);
    const job = await this.prisma.modelFineTuningJob.findFirst({
      where: { id: jobId, modelDraftId: draftId },
    });
    if (!job) throw new NotFoundException('Fine-tuning job not found');
    if (job.status !== 'FAILED') {
      throw new AppException({
        statusCode: 400,
        message: `Job is ${job.status}, not FAILED — nothing to retry.`,
        type: 'ERROR',
      });
    }

    const sets = job.hyperparameterSets as unknown as Record<string, unknown>[];
    const retryIndex = job.completedRuns;
    if (retryIndex >= sets.length) {
      throw new AppException({
        statusCode: 400,
        message: 'No hyperparameter set left to retry.',
        type: 'ERROR',
      });
    }

    let newRun;
    try {
      newRun = await this.runLaunch.launchDraftRun(
        draftId,
        this.runDtoFor(job, sets[retryIndex]),
        job.id,
      );
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        throw new AppException({
          statusCode: 409,
          message: `Draft ${draftId} already has a fine-tuning job in progress.`,
          type: 'ERROR',
        });
      }
      throw err;
    }

    const updated = await this.prisma.modelFineTuningJob.update({
      where: { id: job.id },
      data: {
        status: 'RUNNING',
        currentRunId: newRun.id,
        failureReason: null,
        finishedAt: null,
      },
    });
    return {
      statusCode: 200,
      message: 'Fine-tuning job retried',
      type: 'SUCCESS' as const,
      data: updated,
    };
  }
}
