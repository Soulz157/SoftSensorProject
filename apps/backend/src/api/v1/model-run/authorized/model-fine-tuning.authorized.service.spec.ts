import { NotFoundException } from '@nestjs/common';
import { AppException } from '@softsensor/common';
import { ModelFineTuningAuthorizedService } from './model-fine-tuning.authorized.service';

/**
 * MODEL-FLOW-005. The create/get/retry HTTP round trips (including the real
 * partial-unique-index 409 and the real chained-run advance) were
 * live-verified against the dev stack this session — see the ledger's own
 * verification note. This file covers what that cannot: the idempotency
 * guard under a SIMULATED concurrent call (a live test can't reliably race
 * two requests against the same run), and each branch of `advanceJobForRun`
 * in isolation.
 */
describe('ModelFineTuningAuthorizedService', () => {
  const JOB_BASE = {
    id: 'job-1',
    modelDraftId: 'draft-1',
    algorithm: 'ols',
    targetY: 'TI-101',
    goldArtifactId: 'gold-1',
    trainTestSplit: null as number | null,
    hyperparameterSets: [{ fit_intercept: true }, { fit_intercept: false }],
    totalRuns: 2,
    completedRuns: 0,
    status: 'RUNNING' as
      | 'QUEUED'
      | 'RUNNING'
      | 'SUCCEEDED'
      | 'FAILED'
      | 'CANCELED',
    failureReason: null,
    currentRunId: 'run-1',
    bestRunId: null as string | null,
    bestRmse: null as number | null,
    createdById: 'user-1',
    createdAt: new Date(),
    startedAt: new Date(),
    finishedAt: null,
  };

  function makePrisma(
    overrides: {
      job?: Partial<typeof JOB_BASE> | null;
      run?: Record<string, unknown> | null;
      updateManyCount?: number;
    } = {},
  ) {
    const job =
      overrides.job === null ? null : { ...JOB_BASE, ...overrides.job };
    const run =
      overrides.run === undefined
        ? {
            id: 'run-1',
            status: 'SUCCEEDED',
            metrics: { rmse: 0.5 },
            failureReason: null,
          }
        : overrides.run;

    return {
      modelFineTuningJob: {
        findUnique: jest.fn().mockResolvedValue(job),
        findFirst: jest.fn().mockResolvedValue(job),
        findUniqueOrThrow: jest.fn().mockResolvedValue(job),
        create: jest.fn().mockResolvedValue(job),
        update: jest
          .fn()
          .mockImplementation(({ data }) => ({ ...job, ...data })),
        updateMany: jest
          .fn()
          .mockResolvedValue({ count: overrides.updateManyCount ?? 1 }),
      },
      modelTrainingRun: {
        findUnique: jest.fn().mockResolvedValue(run),
      },
      modelDraft: {
        update: jest.fn().mockResolvedValue({}),
      },
    };
  }

  function makeRunLaunch(overrides: { launchDraftRun?: jest.Mock } = {}) {
    return {
      assertDraftWritable: jest.fn().mockResolvedValue({ id: 'draft-1' }),
      assertDraftReadable: jest.fn().mockResolvedValue({ id: 'draft-1' }),
      launchDraftRun:
        overrides.launchDraftRun ??
        jest.fn().mockResolvedValue({ id: 'run-2' }),
    };
  }

  describe('advanceJobForRun', () => {
    it('is a no-op once the job has already moved past this run (idempotency guard)', async () => {
      const prisma = makePrisma({ job: { currentRunId: 'run-99' } });
      const runLaunch = makeRunLaunch();
      const service = new ModelFineTuningAuthorizedService(
        prisma as never,
        runLaunch as never,
      );

      await service.advanceJobForRun('run-1', 'job-1');

      expect(prisma.modelFineTuningJob.updateMany).not.toHaveBeenCalled();
      expect(runLaunch.launchDraftRun).not.toHaveBeenCalled();
    });

    it('is a no-op once the job already reached a terminal status', async () => {
      const prisma = makePrisma({ job: { status: 'SUCCEEDED' } });
      const runLaunch = makeRunLaunch();
      const service = new ModelFineTuningAuthorizedService(
        prisma as never,
        runLaunch as never,
      );

      await service.advanceJobForRun('run-1', 'job-1');

      expect(prisma.modelFineTuningJob.updateMany).not.toHaveBeenCalled();
    });

    it('fails the whole job when the current run FAILED', async () => {
      const prisma = makePrisma({
        run: {
          id: 'run-1',
          status: 'FAILED',
          metrics: null,
          failureReason: 'bad hyperparameter',
        },
      });
      const runLaunch = makeRunLaunch();
      const service = new ModelFineTuningAuthorizedService(
        prisma as never,
        runLaunch as never,
      );

      await service.advanceJobForRun('run-1', 'job-1');

      expect(prisma.modelFineTuningJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'job-1',
            currentRunId: 'run-1',
            status: { in: ['QUEUED', 'RUNNING'] },
          },
          data: expect.objectContaining({
            status: 'FAILED',
            failureReason: expect.stringContaining('bad hyperparameter'),
          }),
        }),
      );
      expect(runLaunch.launchDraftRun).not.toHaveBeenCalled();
    });

    it('launches the next hyperparameter set when the run SUCCEEDED and sets remain', async () => {
      const prisma = makePrisma({
        job: { completedRuns: 0, totalRuns: 2 },
        run: { id: 'run-1', status: 'SUCCEEDED', metrics: { rmse: 0.5 } },
      });
      const launchDraftRun = jest.fn().mockResolvedValue({ id: 'run-2' });
      const runLaunch = makeRunLaunch({ launchDraftRun });
      const service = new ModelFineTuningAuthorizedService(
        prisma as never,
        runLaunch as never,
      );

      await service.advanceJobForRun('run-1', 'job-1');

      // The SECOND hyperparameter set (index 1, "completedRuns after +1").
      expect(launchDraftRun).toHaveBeenCalledWith(
        'draft-1',
        expect.objectContaining({ hyperparameters: { fit_intercept: false } }),
        'job-1',
      );
      expect(prisma.modelFineTuningJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'RUNNING',
            completedRuns: 1,
            currentRunId: 'run-2',
            bestRunId: 'run-1',
            bestRmse: 0.5,
          }),
        }),
      );
    });

    it('completes the job and points the draft at the best run once every set has run', async () => {
      const prisma = makePrisma({
        job: {
          completedRuns: 1,
          totalRuns: 2,
          bestRunId: 'run-1',
          bestRmse: 0.5,
        },
        run: { id: 'run-2', status: 'SUCCEEDED', metrics: { rmse: 0.7 } }, // worse than 0.5
      });
      const runLaunch = makeRunLaunch();
      const service = new ModelFineTuningAuthorizedService(
        prisma as never,
        runLaunch as never,
      );

      await service.advanceJobForRun('run-1', 'job-1');

      expect(prisma.modelFineTuningJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'SUCCEEDED',
            completedRuns: 2,
            // 0.7 is WORSE than the existing bestRmse (0.5) — the winner
            // from set 1 must survive, not be overwritten by the last run.
            bestRunId: 'run-1',
            bestRmse: 0.5,
          }),
        }),
      );
      expect(prisma.modelDraft.update).toHaveBeenCalledWith({
        where: { id: 'draft-1' },
        data: { currentRunId: 'run-1', status: 'TRAINED' },
      });
    });

    it('does not point the draft at anything when the compare-and-swap lost the race', async () => {
      const prisma = makePrisma({
        job: { completedRuns: 1, totalRuns: 2 },
        run: { id: 'run-2', status: 'SUCCEEDED', metrics: { rmse: 0.5 } },
        updateManyCount: 0, // another caller already advanced this job first
      });
      const runLaunch = makeRunLaunch();
      const service = new ModelFineTuningAuthorizedService(
        prisma as never,
        runLaunch as never,
      );

      await service.advanceJobForRun('run-1', 'job-1');

      expect(prisma.modelDraft.update).not.toHaveBeenCalled();
    });
  });

  describe('retryJobService', () => {
    it('refuses a job that is not FAILED', async () => {
      const prisma = makePrisma({ job: { status: 'SUCCEEDED' } });
      const runLaunch = makeRunLaunch();
      const service = new ModelFineTuningAuthorizedService(
        prisma as never,
        runLaunch as never,
      );

      await expect(
        service.retryJobService('draft-1', 'job-1', 'user-1', 'ADMIN'),
      ).rejects.toBeInstanceOf(AppException);
      expect(runLaunch.launchDraftRun).not.toHaveBeenCalled();
    });

    it('refuses when the job does not exist under that draft', async () => {
      const prisma = makePrisma({ job: null });
      const runLaunch = makeRunLaunch();
      const service = new ModelFineTuningAuthorizedService(
        prisma as never,
        runLaunch as never,
      );

      await expect(
        service.retryJobService('draft-1', 'job-1', 'user-1', 'ADMIN'),
      ).rejects.toThrow(NotFoundException);
    });

    it('relaunches exactly the hyperparameter set that failed', async () => {
      const prisma = makePrisma({
        job: { status: 'FAILED', completedRuns: 1 }, // set at index 1 failed
      });
      const launchDraftRun = jest.fn().mockResolvedValue({ id: 'run-retry' });
      const runLaunch = makeRunLaunch({ launchDraftRun });
      const service = new ModelFineTuningAuthorizedService(
        prisma as never,
        runLaunch as never,
      );

      const result = await service.retryJobService(
        'draft-1',
        'job-1',
        'user-1',
        'ADMIN',
      );

      expect(launchDraftRun).toHaveBeenCalledWith(
        'draft-1',
        expect.objectContaining({ hyperparameters: { fit_intercept: false } }),
        'job-1',
      );
      expect(result.data).toMatchObject({
        status: 'RUNNING',
        currentRunId: 'run-retry',
        failureReason: null,
      });
    });
  });
});
