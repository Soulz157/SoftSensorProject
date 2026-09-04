import { NotFoundException } from '@nestjs/common';
import { AppException } from '@softsensor/common';
import { ModelCandidateJobAuthorizedService } from './model-candidate-job.authorized.service';
import { CreateCandidateJobSchema } from './dto/model-candidate-job.authorized.dto';
import * as pythonClient from '@/lib/python-preprocess-client';
import * as tuningGrid from '@/lib/tuning-grid';

jest.mock('@/lib/python-preprocess-client');
jest.mock('@/lib/tuning-grid');

const mockedGetRunLossHistory = pythonClient.getRunLossHistory as jest.Mock;
const mockedTuningCandidatesFor = tuningGrid.tuningCandidatesFor as jest.Mock;

/**
 * MODEL-FLOW-005, generalized by MODEL-FLOW-013-T03. The create/get/retry
 * HTTP round trips (including the real partial-unique-index 409 and the
 * real chained-run advance) were live-verified against the dev stack in the
 * original MODEL-FLOW-005 session — see the ledger's own verification note.
 * This file covers what that cannot: the idempotency guard under a
 * SIMULATED concurrent call (a live test can't reliably race two requests
 * against the same run), each branch of `advanceJobForRun` in isolation,
 * and (added by MODEL-FLOW-013-T06/T08) candidate shaping and selection.
 *
 * Every pre-existing `it(...)` below is unchanged in behavior from before
 * the MODEL-FLOW-013 rename — only field names moved (`hyperparameterSets`
 * -> `candidates` with `algorithm` folded into each element,
 * `modelFineTuningJob` -> `modelCandidateJob`). A test that needed its
 * assertion LOGIC edited to keep passing would have been the signal that
 * behavior moved — none did.
 */
describe('ModelCandidateJobAuthorizedService', () => {
  const JOB_BASE = {
    id: 'job-1',
    modelDraftId: 'draft-1' as string | null,
    targetY: 'TI-101',
    goldArtifactId: 'gold-1',
    trainTestSplit: null as number | null,
    kind: 'HYPERPARAMETER_SEARCH' as
      | 'HYPERPARAMETER_SEARCH'
      | 'ALGORITHM_SWEEP'
      | 'SWEEP_THEN_TUNE',
    candidates: [
      {
        algorithm: 'ols',
        hyperparameters: { fit_intercept: true } as Record<string, unknown>,
        phase: 1,
      },
      {
        algorithm: 'ols',
        hyperparameters: { fit_intercept: false } as Record<string, unknown>,
        phase: 1,
      },
    ],
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
    selectedRunId: null as string | null,
    createdById: 'user-1',
    createdAt: new Date(),
    startedAt: new Date(),
    finishedAt: null,
  };

  function makePrisma(
    overrides: {
      job?: Partial<typeof JOB_BASE> | null;
      run?: Record<string, unknown> | null;
      runs?: Record<string, unknown>[];
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

    const prismaObj = {
      modelCandidateJob: {
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
        findFirst: jest.fn().mockResolvedValue(run),
        findMany: jest.fn().mockResolvedValue(overrides.runs ?? []),
      },
      modelDraft: {
        update: jest.fn().mockResolvedValue({}),
      },
      // MODEL-FLOW-018-T02. selectCandidateService now wraps its write in
      // $transaction (to also clear ModelDraft.selectedRunId) — `tx` is
      // this same object, so `prisma.modelCandidateJob.update`/
      // `prisma.modelDraft.update` assertions below see the calls made
      // through it exactly as before.
      $transaction: jest
        .fn()
        .mockImplementation((fn: (tx: unknown) => Promise<unknown>) =>
          fn(prismaObj),
        ),
    };
    return prismaObj;
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

  /**
   * [fix]. `.refine()` guarding the loosened `.min(1)` array bound —
   * HYPERPARAMETER_SEARCH may send exactly 1 candidate (createJob expands
   * it); ALGORITHM_SWEEP/SWEEP_THEN_TUNE still need >=2 (one candidate
   * there is a normal training run, not a sweep).
   */
  describe('CreateCandidateJobSchema', () => {
    const BASE = {
      goldArtifactId: '123e4567-e89b-12d3-a456-426614174000',
      targetY: 'TI-101',
      candidates: [{ algorithm: 'ridge', hyperparameters: { alpha: 1 } }],
    };

    it('accepts a single candidate for HYPERPARAMETER_SEARCH', () => {
      const result = CreateCandidateJobSchema.safeParse({
        ...BASE,
        kind: 'HYPERPARAMETER_SEARCH',
      });
      expect(result.success).toBe(true);
    });

    it('refuses a single candidate for ALGORITHM_SWEEP', () => {
      const result = CreateCandidateJobSchema.safeParse({
        ...BASE,
        kind: 'ALGORITHM_SWEEP',
      });
      expect(result.success).toBe(false);
    });

    it('refuses a single candidate for SWEEP_THEN_TUNE', () => {
      const result = CreateCandidateJobSchema.safeParse({
        ...BASE,
        kind: 'SWEEP_THEN_TUNE',
      });
      expect(result.success).toBe(false);
    });
  });

  /**
   * [fix]. "allow find best parameter when select 1 algorithm" —
   * HYPERPARAMETER_SEARCH is a job kind that existed server-side already
   * (schema, this method, polling, selection) but had no client caller and
   * no test coverage of its own before this fix. `createJob` now expands a
   * single-candidate HYPERPARAMETER_SEARCH request via `tuningCandidatesFor`
   * (already mocked at file scope for the SWEEP_THEN_TUNE phase-2 tests
   * below) — the SAME curated grid, never a second copy.
   */
  describe('createJob — HYPERPARAMETER_SEARCH single-candidate expansion', () => {
    // Same local-reset convention as the SWEEP_THEN_TUNE phase-transition
    // block below — this mock is shared at file scope with no global
    // clearAllMocks, so a stale call from an earlier test in this describe
    // block would otherwise leak into `.not.toHaveBeenCalled()` assertions.
    beforeEach(() => {
      mockedTuningCandidatesFor.mockReset();
    });

    it('expands 1 candidate into base + curated variants, all phase 1', async () => {
      mockedTuningCandidatesFor.mockReturnValue([
        { alpha: 0.01 },
        { alpha: 10 },
      ]);
      const prisma = makePrisma();
      const runLaunch = makeRunLaunch();
      const service = new ModelCandidateJobAuthorizedService(
        prisma as never,
        runLaunch as never,
      );

      await service.createJob(
        'draft-1',
        {
          goldArtifactId: 'gold-1',
          targetY: 'TI-101',
          kind: 'HYPERPARAMETER_SEARCH',
          candidates: [{ algorithm: 'ridge', hyperparameters: { alpha: 1 } }],
        } as never,
        'user-1',
        'ADMIN',
      );

      expect(mockedTuningCandidatesFor).toHaveBeenCalledWith('ridge', {
        alpha: 1,
      });
      const createCall = prisma.modelCandidateJob.create.mock.calls[0][0];
      expect(createCall.data.totalRuns).toBe(3);
      expect(createCall.data.candidates).toEqual([
        { algorithm: 'ridge', hyperparameters: { alpha: 1 }, phase: 1 },
        { algorithm: 'ridge', hyperparameters: { alpha: 0.01 }, phase: 1 },
        { algorithm: 'ridge', hyperparameters: { alpha: 10 }, phase: 1 },
      ]);
    });

    it('refuses (400), naming the algorithm, when the grid has no distinct variants', async () => {
      mockedTuningCandidatesFor.mockReturnValue([]);
      const prisma = makePrisma();
      const runLaunch = makeRunLaunch();
      const service = new ModelCandidateJobAuthorizedService(
        prisma as never,
        runLaunch as never,
      );

      await expect(
        service.createJob(
          'draft-1',
          {
            goldArtifactId: 'gold-1',
            targetY: 'TI-101',
            kind: 'HYPERPARAMETER_SEARCH',
            candidates: [{ algorithm: 'lstm', hyperparameters: {} }],
          } as never,
          'user-1',
          'ADMIN',
        ),
      ).rejects.toMatchObject(
        expect.objectContaining({
          statusCode: 400,
          message: expect.stringContaining('lstm'),
        }),
      );
      expect(prisma.modelCandidateJob.create).not.toHaveBeenCalled();
    });

    it('does not expand an ALGORITHM_SWEEP request (2+ candidates, different algorithms) — regression', async () => {
      const prisma = makePrisma();
      const runLaunch = makeRunLaunch();
      const service = new ModelCandidateJobAuthorizedService(
        prisma as never,
        runLaunch as never,
      );

      await service.createJob(
        'draft-1',
        {
          goldArtifactId: 'gold-1',
          targetY: 'TI-101',
          kind: 'ALGORITHM_SWEEP',
          candidates: [
            { algorithm: 'ols', hyperparameters: {} },
            { algorithm: 'ridge', hyperparameters: { alpha: 1 } },
          ],
        } as never,
        'user-1',
        'ADMIN',
      );

      expect(mockedTuningCandidatesFor).not.toHaveBeenCalled();
      const createCall = prisma.modelCandidateJob.create.mock.calls[0][0];
      expect(createCall.data.totalRuns).toBe(2);
    });
  });

  describe('advanceJobForRun', () => {
    it('is a no-op once the job has already moved past this run (idempotency guard)', async () => {
      const prisma = makePrisma({ job: { currentRunId: 'run-99' } });
      const runLaunch = makeRunLaunch();
      const service = new ModelCandidateJobAuthorizedService(
        prisma as never,
        runLaunch as never,
      );

      await service.advanceJobForRun('run-1', 'job-1');

      expect(prisma.modelCandidateJob.updateMany).not.toHaveBeenCalled();
      expect(runLaunch.launchDraftRun).not.toHaveBeenCalled();
    });

    it('is a no-op once the job already reached a terminal status', async () => {
      const prisma = makePrisma({ job: { status: 'SUCCEEDED' } });
      const runLaunch = makeRunLaunch();
      const service = new ModelCandidateJobAuthorizedService(
        prisma as never,
        runLaunch as never,
      );

      await service.advanceJobForRun('run-1', 'job-1');

      expect(prisma.modelCandidateJob.updateMany).not.toHaveBeenCalled();
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
      const service = new ModelCandidateJobAuthorizedService(
        prisma as never,
        runLaunch as never,
      );

      await service.advanceJobForRun('run-1', 'job-1');

      expect(prisma.modelCandidateJob.updateMany).toHaveBeenCalledWith(
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

    it('launches the next candidate when the run SUCCEEDED and candidates remain', async () => {
      const prisma = makePrisma({
        job: { completedRuns: 0, totalRuns: 2 },
        run: { id: 'run-1', status: 'SUCCEEDED', metrics: { rmse: 0.5 } },
      });
      const launchDraftRun = jest.fn().mockResolvedValue({ id: 'run-2' });
      const runLaunch = makeRunLaunch({ launchDraftRun });
      const service = new ModelCandidateJobAuthorizedService(
        prisma as never,
        runLaunch as never,
      );

      await service.advanceJobForRun('run-1', 'job-1');

      // The SECOND candidate (index 1, "completedRuns after +1").
      expect(launchDraftRun).toHaveBeenCalledWith(
        'draft-1',
        expect.objectContaining({ hyperparameters: { fit_intercept: false } }),
        'job-1',
      );
      expect(prisma.modelCandidateJob.updateMany).toHaveBeenCalledWith(
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

    it('completes the job and points the draft at the best run once every candidate has run', async () => {
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
      const service = new ModelCandidateJobAuthorizedService(
        prisma as never,
        runLaunch as never,
      );

      await service.advanceJobForRun('run-1', 'job-1');

      expect(prisma.modelCandidateJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'SUCCEEDED',
            completedRuns: 2,
            // 0.7 is WORSE than the existing bestRmse (0.5) — the winner
            // from candidate 1 must survive, not be overwritten by the last run.
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
      const service = new ModelCandidateJobAuthorizedService(
        prisma as never,
        runLaunch as never,
      );

      await service.advanceJobForRun('run-1', 'job-1');

      expect(prisma.modelDraft.update).not.toHaveBeenCalled();
    });
  });

  describe('advanceJobForRun — SWEEP_THEN_TUNE phase transition (MODEL-FLOW-013-T11)', () => {
    beforeEach(() => {
      mockedTuningCandidatesFor.mockReset();
    });

    it('appends phase-2 candidates and launches the first when phase 1 exhausts', async () => {
      mockedTuningCandidatesFor.mockReturnValue([
        { alpha: 0.1 },
        { alpha: 10 },
      ]);
      const prisma = makePrisma({
        job: {
          kind: 'SWEEP_THEN_TUNE',
          completedRuns: 1,
          totalRuns: 2,
          candidates: [
            {
              algorithm: 'ols',
              hyperparameters: { fit_intercept: true },
              phase: 1,
            },
            { algorithm: 'ridge', hyperparameters: { alpha: 1.0 }, phase: 1 },
          ],
          bestRunId: 'run-0',
          bestRmse: 0.9,
        },
        run: {
          id: 'run-1',
          status: 'SUCCEEDED',
          metrics: { rmse: 0.5 }, // beats 0.9
          algorithm: 'ridge',
          hyperparameters: { alpha: 1.0 },
        },
      });
      const launchDraftRun = jest.fn().mockResolvedValue({ id: 'run-tune-1' });
      const runLaunch = makeRunLaunch({ launchDraftRun });
      const service = new ModelCandidateJobAuthorizedService(
        prisma as never,
        runLaunch as never,
      );

      await service.advanceJobForRun('run-1', 'job-1');

      expect(mockedTuningCandidatesFor).toHaveBeenCalledWith('ridge', {
        alpha: 1.0,
      });
      expect(launchDraftRun).toHaveBeenCalledWith(
        'draft-1',
        expect.objectContaining({
          algorithm: 'ridge',
          hyperparameters: { alpha: 0.1 },
        }),
        'job-1',
      );
      expect(prisma.modelCandidateJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'RUNNING',
            // Two phase-1 + two new phase-2 candidates.
            candidates: [
              {
                algorithm: 'ols',
                hyperparameters: { fit_intercept: true },
                phase: 1,
              },
              { algorithm: 'ridge', hyperparameters: { alpha: 1.0 }, phase: 1 },
              { algorithm: 'ridge', hyperparameters: { alpha: 0.1 }, phase: 2 },
              { algorithm: 'ridge', hyperparameters: { alpha: 10 }, phase: 2 },
            ],
            totalRuns: 4,
            // Stays the phase-1 finished count — the honest count of what
            // has actually run so far, not what is now planned.
            completedRuns: 2,
            currentRunId: 'run-tune-1',
            bestRunId: 'run-1',
            bestRmse: 0.5,
          }),
        }),
      );
      // Not the job-complete write — no finishedAt, no SUCCEEDED status.
      expect(prisma.modelDraft.update).not.toHaveBeenCalled();
    });

    it('completes normally when the winner has nothing left to tune', async () => {
      mockedTuningCandidatesFor.mockReturnValue([]);
      const prisma = makePrisma({
        job: {
          kind: 'SWEEP_THEN_TUNE',
          completedRuns: 1,
          totalRuns: 2,
          bestRunId: 'run-0',
          bestRmse: 0.9,
        },
        run: { id: 'run-1', status: 'SUCCEEDED', metrics: { rmse: 0.5 } },
      });
      const runLaunch = makeRunLaunch();
      const service = new ModelCandidateJobAuthorizedService(
        prisma as never,
        runLaunch as never,
      );

      await service.advanceJobForRun('run-1', 'job-1');

      expect(runLaunch.launchDraftRun).not.toHaveBeenCalled();
      expect(prisma.modelCandidateJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'SUCCEEDED',
            completedRuns: 2,
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

    it('never attempts a phase-2 append for an ALGORITHM_SWEEP job', async () => {
      const prisma = makePrisma({
        job: {
          kind: 'ALGORITHM_SWEEP',
          completedRuns: 1,
          totalRuns: 2,
          bestRunId: 'run-0',
          bestRmse: 0.9,
        },
        run: { id: 'run-1', status: 'SUCCEEDED', metrics: { rmse: 0.5 } },
      });
      const runLaunch = makeRunLaunch();
      const service = new ModelCandidateJobAuthorizedService(
        prisma as never,
        runLaunch as never,
      );

      await service.advanceJobForRun('run-1', 'job-1');

      expect(mockedTuningCandidatesFor).not.toHaveBeenCalled();
      expect(prisma.modelCandidateJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'SUCCEEDED' }),
        }),
      );
    });

    it('does not append a second phase-2 group once one already exists, and a worse phase-2 run leaves bestRunId alone', async () => {
      const prisma = makePrisma({
        job: {
          kind: 'SWEEP_THEN_TUNE',
          completedRuns: 3,
          totalRuns: 4,
          candidates: [
            { algorithm: 'ridge', hyperparameters: { alpha: 1.0 }, phase: 1 },
            {
              algorithm: 'ols',
              hyperparameters: { fit_intercept: true },
              phase: 1,
            },
            { algorithm: 'ridge', hyperparameters: { alpha: 0.1 }, phase: 2 },
            { algorithm: 'ridge', hyperparameters: { alpha: 10 }, phase: 2 },
          ],
          currentRunId: 'run-3',
          bestRunId: 'run-0',
          bestRmse: 0.5, // the phase-1 winner
        },
        run: { id: 'run-3', status: 'SUCCEEDED', metrics: { rmse: 0.8 } }, // worse than 0.5
      });
      const runLaunch = makeRunLaunch();
      const service = new ModelCandidateJobAuthorizedService(
        prisma as never,
        runLaunch as never,
      );

      await service.advanceJobForRun('run-3', 'job-1');

      expect(mockedTuningCandidatesFor).not.toHaveBeenCalled();
      expect(runLaunch.launchDraftRun).not.toHaveBeenCalled();
      expect(prisma.modelCandidateJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'SUCCEEDED',
            completedRuns: 4,
            // 0.8 lost to the phase-1 winner (0.5) — it must survive.
            bestRunId: 'run-0',
            bestRmse: 0.5,
          }),
        }),
      );
    });
  });

  describe('retryJobService', () => {
    it('refuses a job that is not FAILED', async () => {
      const prisma = makePrisma({ job: { status: 'SUCCEEDED' } });
      const runLaunch = makeRunLaunch();
      const service = new ModelCandidateJobAuthorizedService(
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
      const service = new ModelCandidateJobAuthorizedService(
        prisma as never,
        runLaunch as never,
      );

      await expect(
        service.retryJobService('draft-1', 'job-1', 'user-1', 'ADMIN'),
      ).rejects.toThrow(NotFoundException);
    });

    it('relaunches exactly the candidate that failed', async () => {
      const prisma = makePrisma({
        job: { status: 'FAILED', completedRuns: 1 }, // candidate at index 1 failed
      });
      const launchDraftRun = jest.fn().mockResolvedValue({ id: 'run-retry' });
      const runLaunch = makeRunLaunch({ launchDraftRun });
      const service = new ModelCandidateJobAuthorizedService(
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

  describe('getJobService (MODEL-FLOW-013-T06)', () => {
    it('shapes each candidate against its own run, in launch order', async () => {
      const prisma = makePrisma({
        job: { status: 'SUCCEEDED', completedRuns: 2 },
        runs: [
          {
            id: 'run-1',
            status: 'SUCCEEDED',
            failureReason: null,
            metrics: {
              r2: 0.9,
              rmse: 0.5,
              mae: 0.4,
              train_r2: 0.95,
              train_rmse: 0.3,
              train_mae: 0.2,
            },
            lossHistoryKey: null,
          },
          {
            id: 'run-2',
            status: 'FAILED',
            failureReason: 'bad fit',
            metrics: null,
            lossHistoryKey: null,
          },
        ],
      });
      const runLaunch = makeRunLaunch();
      const service = new ModelCandidateJobAuthorizedService(
        prisma as never,
        runLaunch as never,
      );

      const result = await service.getJobService(
        'draft-1',
        'job-1',
        'user-1',
        'ADMIN',
      );

      expect(result.data.candidates).toHaveLength(2);
      expect(result.data.candidates[0]).toMatchObject({
        runId: 'run-1',
        algorithm: 'ols',
        status: 'SUCCEEDED',
        metrics: { r2: 0.9, rmse: 0.5, mae: 0.4 },
        trainMetrics: { r2: 0.95, rmse: 0.3, mae: 0.2 },
      });
      expect(result.data.candidates[1]).toMatchObject({
        runId: 'run-2',
        algorithm: 'ols',
        status: 'FAILED',
        failureReason: 'bad fit',
      });
    });

    it('marks a candidate with no run yet as PENDING rather than dropping it', async () => {
      const prisma = makePrisma({
        job: { status: 'RUNNING', completedRuns: 0 },
        runs: [],
      });
      const runLaunch = makeRunLaunch();
      const service = new ModelCandidateJobAuthorizedService(
        prisma as never,
        runLaunch as never,
      );

      const result = await service.getJobService(
        'draft-1',
        'job-1',
        'user-1',
        'ADMIN',
      );

      expect(result.data.candidates).toHaveLength(2);
      expect(result.data.candidates[0]?.status).toBe('PENDING');
      expect(result.data.candidates[0]?.runId).toBeNull();
    });

    it('embeds the resolved loss history for a candidate that has one (MODEL-FLOW-013-T07)', async () => {
      mockedGetRunLossHistory.mockResolvedValue({
        algorithm: 'xgboost',
        metric: 'rmse',
        series: { train: [1.0, 0.5], validation: [1.1, 0.6] },
      });
      const prisma = makePrisma({
        job: { status: 'RUNNING', completedRuns: 1, totalRuns: 2 },
        runs: [
          {
            id: 'run-1',
            status: 'SUCCEEDED',
            failureReason: null,
            metrics: { r2: 0.9, rmse: 0.5, mae: 0.4 },
            lossHistoryKey: 'drafts/draft-1/runs/run-1/loss_history.json',
          },
        ],
      });
      const runLaunch = makeRunLaunch();
      const service = new ModelCandidateJobAuthorizedService(
        prisma as never,
        runLaunch as never,
      );

      const result = await service.getJobService(
        'draft-1',
        'job-1',
        'user-1',
        'ADMIN',
      );

      expect(mockedGetRunLossHistory).toHaveBeenCalledWith(
        'drafts/draft-1/runs/run-1/loss_history.json',
      );
      expect(result.data.candidates[0]?.lossHistory).toEqual({
        algorithm: 'xgboost',
        metric: 'rmse',
        series: { train: [1.0, 0.5], validation: [1.1, 0.6] },
      });
    });

    it('falls back to null when the loss-history read fails, rather than failing the whole job fetch', async () => {
      mockedGetRunLossHistory.mockRejectedValue(new Error('object not found'));
      const prisma = makePrisma({
        job: { status: 'RUNNING', completedRuns: 1, totalRuns: 2 },
        runs: [
          {
            id: 'run-1',
            status: 'SUCCEEDED',
            failureReason: null,
            metrics: { r2: 0.9, rmse: 0.5, mae: 0.4 },
            lossHistoryKey: 'drafts/draft-1/runs/run-1/loss_history.json',
          },
        ],
      });
      const runLaunch = makeRunLaunch();
      const service = new ModelCandidateJobAuthorizedService(
        prisma as never,
        runLaunch as never,
      );

      const result = await service.getJobService(
        'draft-1',
        'job-1',
        'user-1',
        'ADMIN',
      );

      expect(result.data.candidates[0]?.lossHistory).toBeNull();
      expect(result.data.candidates[0]?.status).toBe('SUCCEEDED');
    });
  });

  describe('selectCandidateService (MODEL-FLOW-013-T08)', () => {
    it('refuses while the job is not terminal', async () => {
      const prisma = makePrisma({ job: { status: 'RUNNING' } });
      const runLaunch = makeRunLaunch();
      const service = new ModelCandidateJobAuthorizedService(
        prisma as never,
        runLaunch as never,
      );

      await expect(
        service.selectCandidateService(
          'draft-1',
          'job-1',
          { runId: 'run-2' },
          'user-1',
          'ADMIN',
        ),
      ).rejects.toBeInstanceOf(AppException);
      expect(prisma.modelCandidateJob.update).not.toHaveBeenCalled();
    });

    it('refuses a runId that is not a candidate of this job', async () => {
      const prisma = makePrisma({ job: { status: 'SUCCEEDED' }, run: null });
      const runLaunch = makeRunLaunch();
      const service = new ModelCandidateJobAuthorizedService(
        prisma as never,
        runLaunch as never,
      );

      await expect(
        service.selectCandidateService(
          'draft-1',
          'job-1',
          { runId: 'run-from-elsewhere' },
          'user-1',
          'ADMIN',
        ),
      ).rejects.toBeInstanceOf(AppException);
      expect(prisma.modelCandidateJob.update).not.toHaveBeenCalled();
    });

    it('refuses a candidate that did not SUCCEED', async () => {
      const prisma = makePrisma({
        job: { status: 'SUCCEEDED' },
        run: { status: 'FAILED' },
      });
      const runLaunch = makeRunLaunch();
      const service = new ModelCandidateJobAuthorizedService(
        prisma as never,
        runLaunch as never,
      );

      await expect(
        service.selectCandidateService(
          'draft-1',
          'job-1',
          { runId: 'run-2' },
          'user-1',
          'ADMIN',
        ),
      ).rejects.toBeInstanceOf(AppException);
    });

    it('writes ONLY job.selectedRunId — never touches ModelDraft.currentRunId', async () => {
      const prisma = makePrisma({
        job: { status: 'SUCCEEDED' },
        run: { status: 'SUCCEEDED' },
      });
      const runLaunch = makeRunLaunch();
      const service = new ModelCandidateJobAuthorizedService(
        prisma as never,
        runLaunch as never,
      );

      await service.selectCandidateService(
        'draft-1',
        'job-1',
        { runId: 'run-2' },
        'user-1',
        'ADMIN',
      );

      expect(prisma.modelCandidateJob.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: { selectedRunId: 'run-2' },
      });
      expect(prisma.modelDraft.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ currentRunId: expect.anything() }),
        }),
      );
    });

    // MODEL-FLOW-018-T02. A job-level selection outranks a standalone one —
    // resolveActiveRunId's own precedence comment states this — so a stale
    // ModelDraft.selectedRunId must not survive it.
    it('clears ModelDraft.selectedRunId for a draft-owned job', async () => {
      const prisma = makePrisma({
        job: { status: 'SUCCEEDED', modelDraftId: 'draft-1' },
        run: { status: 'SUCCEEDED' },
      });
      const runLaunch = makeRunLaunch();
      const service = new ModelCandidateJobAuthorizedService(
        prisma as never,
        runLaunch as never,
      );

      await service.selectCandidateService(
        'draft-1',
        'job-1',
        { runId: 'run-2' },
        'user-1',
        'ADMIN',
      );

      expect(prisma.modelDraft.update).toHaveBeenCalledWith({
        where: { id: 'draft-1' },
        data: { selectedRunId: null },
      });
    });

    // Defensive path, not a reachable one: the lookup above filters on
    // `modelDraftId: draftId`, so a real call can never produce a job with
    // a null `modelDraftId` here (a retrain job can never be found by this
    // query at all). This exercises the `if (job2.modelDraftId)` guard
    // directly so it doesn't throw if that ever stops being true.
    it('the modelDraftId guard does not throw for a null modelDraftId', async () => {
      const prisma = makePrisma({
        job: { status: 'SUCCEEDED', modelDraftId: null },
        run: { status: 'SUCCEEDED' },
      });
      const runLaunch = makeRunLaunch();
      const service = new ModelCandidateJobAuthorizedService(
        prisma as never,
        runLaunch as never,
      );

      await service.selectCandidateService(
        'draft-1',
        'job-1',
        { runId: 'run-2' },
        'user-1',
        'ADMIN',
      );

      expect(prisma.modelDraft.update).not.toHaveBeenCalled();
    });
  });

  /**
   * MODEL-SERVE-004. The MODEL-owned (retrain) branches of the same
   * machinery. Live verification covers the real trigger, the real
   * containers and the real version row (V01/V02); this covers what a live
   * test cannot show cheaply — that the draft writes are NOT made, that a
   * winner with no artifact fails the job instead of minting a version, and
   * that the version is minted inside the SAME transaction as the
   * compare-and-swap.
   */
  describe('advanceJobForRun — model-owned (retrain) job', () => {
    const MODEL_JOB = {
      ...JOB_BASE,
      id: 'job-m1',
      modelDraftId: null as string | null,
      modelId: 'model-1',
      sourceVersionId: 'ver-1',
      resultVersionId: null as string | null,
      idempotencyKey: null as string | null,
      completedRuns: 1,
      totalRuns: 2,
      currentRunId: 'run-2',
    };

    const WINNER = {
      id: 'run-2',
      status: 'SUCCEEDED',
      metrics: { rmse: 0.4 },
      failureReason: null,
      datasetId: 'ds-1',
      goldArtifactId: 'gold-1',
      goldObjectKey: 'ds-1/artifacts/gold-1/data.parquet',
      artifactChecksum: 'sha-1',
      featureSpecKey: 'ds-1/artifacts/gold-1/feature_spec.json',
      algorithm: 'ridge',
      hyperparameters: { alpha: 0.5 },
      imageDigest: 'scgc/soft-sensor-trainer@sha256:abc',
      modelKey: 'models/model-1/runs/run-2/model.joblib',
      manifestKey: null as string | null,
    };

    function makeModelPrisma(
      overrides: {
        job?: Partial<typeof MODEL_JOB>;
        run?: Record<string, unknown> | null;
        updateManyCount?: number;
        existingVersion?: { id: string } | null;
      } = {},
    ) {
      const job = { ...MODEL_JOB, ...overrides.job };
      const run = overrides.run === undefined ? WINNER : overrides.run;
      const tx = {
        modelCandidateJob: {
          updateMany: jest
            .fn()
            .mockResolvedValue({ count: overrides.updateManyCount ?? 1 }),
          update: jest.fn().mockResolvedValue(job),
        },
        modelVersion: {
          findUnique: jest
            .fn()
            .mockResolvedValue(overrides.existingVersion ?? null),
          findFirst: jest.fn().mockResolvedValue({ version: 3 }),
          create: jest.fn().mockResolvedValue({ id: 'ver-2' }),
        },
      };
      return {
        tx,
        prisma: {
          modelCandidateJob: {
            findUnique: jest.fn().mockResolvedValue(job),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            update: jest.fn().mockResolvedValue(job),
          },
          modelTrainingRun: {
            findUnique: jest.fn().mockResolvedValue(run),
          },
          modelDraft: { update: jest.fn().mockResolvedValue({}) },
          $transaction: jest
            .fn()
            .mockImplementation((fn: (t: typeof tx) => Promise<unknown>) =>
              fn(tx),
            ),
        },
      };
    }

    it('mints a STAGING version at max+1 and never writes a draft', async () => {
      const { prisma, tx } = makeModelPrisma();
      const runLaunch = makeRunLaunch();
      const service = new ModelCandidateJobAuthorizedService(
        prisma as never,
        runLaunch as never,
      );

      await service.advanceJobForRun('run-2', 'job-m1');

      // The compare-and-swap still decides the winner of the race, and the
      // version create sits inside the SAME transaction.
      expect(tx.modelCandidateJob.updateMany).toHaveBeenCalledTimes(1);
      const createCalls = tx.modelVersion.create.mock.calls as Array<
        [{ data: Record<string, unknown> }]
      >;
      const created = createCalls[0][0];
      expect(created.data).toMatchObject({
        modelId: 'model-1',
        version: 4, // max(3) + 1
        sourceRunId: 'run-2',
        modelObjectKey: WINNER.modelKey,
        algorithm: 'ridge',
      });
      // STAGING is the schema default — never set explicitly, and never
      // PRODUCTION. That is the whole feature (V01).
      expect(created.data.stage).toBeUndefined();
      expect(tx.modelCandidateJob.update).toHaveBeenCalledWith({
        where: { id: 'job-m1' },
        data: { resultVersionId: 'ver-2' },
      });
      expect(prisma.modelDraft.update).not.toHaveBeenCalled();
    });

    it('adopts an existing version for the same run rather than racing the unique index', async () => {
      const { prisma, tx } = makeModelPrisma({
        existingVersion: { id: 'ver-existing' },
      });
      const service = new ModelCandidateJobAuthorizedService(
        prisma as never,
        makeRunLaunch() as never,
      );

      await service.advanceJobForRun('run-2', 'job-m1');

      expect(tx.modelVersion.create).not.toHaveBeenCalled();
      expect(tx.modelCandidateJob.update).toHaveBeenCalledWith({
        where: { id: 'job-m1' },
        data: { resultVersionId: 'ver-existing' },
      });
    });

    it('mints nothing when it loses the compare-and-swap race', async () => {
      const { prisma, tx } = makeModelPrisma({ updateManyCount: 0 });
      const service = new ModelCandidateJobAuthorizedService(
        prisma as never,
        makeRunLaunch() as never,
      );

      await service.advanceJobForRun('run-2', 'job-m1');

      expect(tx.modelVersion.create).not.toHaveBeenCalled();
      expect(tx.modelCandidateJob.update).not.toHaveBeenCalled();
    });

    it('fails the job instead of versioning a winner with no model artifact', async () => {
      const { prisma, tx } = makeModelPrisma({
        run: { ...WINNER, modelKey: null },
      });
      const service = new ModelCandidateJobAuthorizedService(
        prisma as never,
        makeRunLaunch() as never,
      );

      await service.advanceJobForRun('run-2', 'job-m1');

      expect(tx.modelVersion.create).not.toHaveBeenCalled();
      const failCalls = prisma.modelCandidateJob.updateMany.mock.calls as Array<
        [{ data: { status: string; failureReason: string } }]
      >;
      const failed = failCalls[0][0];
      expect(failed.data.status).toBe('FAILED');
      expect(failed.data.failureReason).toContain('no model artifact');
    });

    it('launches the next candidate through launchModelRun, not launchDraftRun', async () => {
      const { prisma } = makeModelPrisma({
        job: { completedRuns: 0, totalRuns: 2 },
      });
      const launchModelRun = jest.fn().mockResolvedValue({ id: 'run-3' });
      const runLaunch = { ...makeRunLaunch(), launchModelRun };
      const service = new ModelCandidateJobAuthorizedService(
        prisma as never,
        runLaunch as never,
      );

      await service.advanceJobForRun('run-2', 'job-m1');

      expect(launchModelRun).toHaveBeenCalledWith(
        'model-1',
        expect.objectContaining({ goldArtifactId: 'gold-1' }),
        'job-m1',
      );
      expect(runLaunch.launchDraftRun).not.toHaveBeenCalled();
    });
  });
});
