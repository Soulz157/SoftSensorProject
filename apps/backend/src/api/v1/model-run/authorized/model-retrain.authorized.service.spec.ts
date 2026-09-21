import { ModelRetrainAuthorizedService } from './model-retrain.authorized.service';

/**
 * MODEL-SERVE-014. Covers the two reads this feature ADDED to
 * MODEL-SERVE-004's service — the model-keyed discovery route
 * (`getCurrentRetrainJobService`) and the result version's identity on the
 * comparison (`buildComparison`'s `candidate.version`/`candidate.stage`).
 *
 * The pre-existing trigger/get paths are not re-covered here: they shipped
 * with MODEL-SERVE-004 and were live-verified then (see that feature's own
 * verification notes), and back-filling their whole surface is a separate
 * piece of work from this client-integration pass.
 *
 * Constructed by hand rather than through a Nest testing module, matching
 * `model-candidate-job.authorized.service.spec.ts` next door.
 */
describe('ModelRetrainAuthorizedService — MODEL-SERVE-014 additions', () => {
  const MODEL = { id: 'model-1', workspaceId: 'ws-1' };
  const ADMIN = { id: 'user-1', role: 'ADMIN' } as never;

  const JOB_BASE = {
    id: 'job-1',
    modelId: 'model-1',
    modelDraftId: null,
    sourceVersionId: 'version-1',
    resultVersionId: null as string | null,
    targetY: 'TI-101',
    goldArtifactId: 'gold-1',
    trainTestSplit: 0.8,
    kind: 'HYPERPARAMETER_SEARCH',
    candidates: [],
    totalRuns: 4,
    completedRuns: 0,
    status: 'RUNNING',
    failureReason: null,
    currentRunId: 'run-1',
    bestRunId: null as string | null,
    selectedRunId: null as string | null,
    bestRmse: null as number | null,
    idempotencyKey: null,
    createdById: 'user-1',
    createdAt: new Date('2026-09-01T00:00:00Z'),
    startedAt: new Date('2026-09-01T00:00:01Z'),
    finishedAt: null,
  };

  const INCUMBENT_VERSION = {
    id: 'version-1',
    version: 3,
    stage: 'PRODUCTION',
    algorithm: 'ridge',
    sourceRunId: 'run-incumbent',
    goldArtifactId: 'gold-1',
    hyperparameters: { alpha: 1 },
    metrics: { rmse: 1.25, r2: 0.9, mae: 0.5 },
  };

  const RUN_BASE = {
    id: 'run-incumbent',
    goldArtifactId: 'gold-1',
    artifactChecksum: 'sha-1',
    targetY: 'TI-101',
    splitSpec: { method: 'chronological', ratio: 0.8 },
    algorithm: 'ridge',
    metrics: { rmse: 1.25, r2: 0.9, mae: 0.5 },
  };

  function makePrisma(
    overrides: {
      liveJob?: Record<string, unknown> | null;
      anyJob?: Record<string, unknown> | null;
      productionVersion?: Record<string, unknown> | null;
      versionById?: Record<string, unknown> | null;
      resultVersion?: Record<string, unknown> | null;
      runsById?: Record<string, Record<string, unknown> | null>;
    } = {},
  ) {
    const jobFindFirst = jest
      .fn()
      // 1st call: the live QUEUED/RUNNING lookup.
      .mockResolvedValueOnce(
        overrides.liveJob === undefined ? null : overrides.liveJob,
      )
      // 2nd call (only when the first found nothing): most recent ever.
      .mockResolvedValueOnce(
        overrides.anyJob === undefined ? null : overrides.anyJob,
      );

    return {
      model: {
        findUnique: jest.fn().mockResolvedValue(MODEL),
      },
      workspace: { findFirst: jest.fn().mockResolvedValue({ id: 'ws-1' }) },
      workspaceMember: { findFirst: jest.fn().mockResolvedValue(null) },
      modelCandidateJob: {
        findFirst: jobFindFirst,
      },
      modelVersion: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            overrides.productionVersion === undefined
              ? INCUMBENT_VERSION
              : overrides.productionVersion,
          ),
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.id === 'version-1') {
            return Promise.resolve(
              overrides.versionById === undefined
                ? INCUMBENT_VERSION
                : overrides.versionById,
            );
          }
          return Promise.resolve(overrides.resultVersion ?? null);
        }),
      },
      modelTrainingRun: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          const runs = overrides.runsById ?? { 'run-incumbent': RUN_BASE };
          return Promise.resolve(runs[where.id as string] ?? null);
        }),
      },
    };
  }

  function makeCandidateJobs(job: Record<string, unknown>) {
    return {
      reconcileAndShape: jest
        .fn()
        .mockResolvedValue({ job, candidates: [{ runId: 'run-1' }] }),
      expandSearchCandidates: jest.fn(),
      launchForJob: jest.fn(),
    };
  }

  describe('getCurrentRetrainJobService', () => {
    it('resolves the incumbent even when the model has never been retrained', async () => {
      const prisma = makePrisma();
      const service = new ModelRetrainAuthorizedService(
        prisma as never,
        makeCandidateJobs(JOB_BASE) as never,
      );

      const res = await service.getCurrentRetrainJobService('model-1', ADMIN);

      expect(res.data).toEqual({
        incumbent: { versionId: 'version-1', version: 3, algorithm: 'ridge' },
        job: null,
      });
    });

    it('reports a null incumbent when no PRODUCTION version exists — never invents one', async () => {
      const prisma = makePrisma({ productionVersion: null });
      const service = new ModelRetrainAuthorizedService(
        prisma as never,
        makeCandidateJobs(JOB_BASE) as never,
      );

      const res = await service.getCurrentRetrainJobService('model-1', ADMIN);

      expect(res.data).toEqual({ incumbent: null, job: null });
    });

    it('prefers the LIVE job over the most recent one', async () => {
      const live = { ...JOB_BASE, id: 'live-job', status: 'RUNNING' };
      const prisma = makePrisma({ liveJob: live });
      const candidateJobs = makeCandidateJobs(live);
      const service = new ModelRetrainAuthorizedService(
        prisma as never,
        candidateJobs as never,
      );

      const res = await service.getCurrentRetrainJobService('model-1', ADMIN);

      // Only the live lookup ran — no fallback read was needed.
      expect(prisma.modelCandidateJob.findFirst).toHaveBeenCalledTimes(1);
      expect(
        (prisma.modelCandidateJob.findFirst.mock.calls[0] as [
          { where: { status?: unknown } },
        ])[0].where.status,
      ).toEqual({ in: ['QUEUED', 'RUNNING'] });
      expect(res.data?.job?.id).toBe('live-job');
    });

    it('falls back to the most recent finished job so a completed result stays visible', async () => {
      const finished = {
        ...JOB_BASE,
        id: 'finished-job',
        status: 'SUCCEEDED',
        resultVersionId: 'version-4',
        bestRunId: 'run-2',
        finishedAt: new Date('2026-09-01T00:30:00Z'),
      };
      const prisma = makePrisma({ liveJob: null, anyJob: finished });
      const service = new ModelRetrainAuthorizedService(
        prisma as never,
        makeCandidateJobs(finished) as never,
      );

      const res = await service.getCurrentRetrainJobService('model-1', ADMIN);

      expect(prisma.modelCandidateJob.findFirst).toHaveBeenCalledTimes(2);
      expect(res.data?.job?.id).toBe('finished-job');
    });

    it('reconciles the job on read, exactly as the by-id route does', async () => {
      const live = { ...JOB_BASE, id: 'live-job' };
      const candidateJobs = makeCandidateJobs(live);
      const service = new ModelRetrainAuthorizedService(
        makePrisma({ liveJob: live }) as never,
        candidateJobs as never,
      );

      await service.getCurrentRetrainJobService('model-1', ADMIN);

      expect(candidateJobs.reconcileAndShape).toHaveBeenCalledWith(live);
    });
  });

  describe('buildComparison — the minted version’s identity (T06)', () => {
    it('names the STAGING version once the job has minted one', async () => {
      const finished = {
        ...JOB_BASE,
        status: 'SUCCEEDED',
        resultVersionId: 'version-4',
        bestRunId: 'run-candidate',
      };
      const prisma = makePrisma({
        liveJob: finished,
        resultVersion: { version: 4, stage: 'STAGING' },
        runsById: {
          'run-incumbent': RUN_BASE,
          'run-candidate': {
            ...RUN_BASE,
            id: 'run-candidate',
            metrics: { rmse: 0.75, r2: 0.95, mae: 0.3 },
          },
        },
      });
      const service = new ModelRetrainAuthorizedService(
        prisma as never,
        makeCandidateJobs(finished) as never,
      );

      const res = await service.getCurrentRetrainJobService('model-1', ADMIN);
      const comparison = res.data?.job?.comparison;

      expect(comparison?.candidate.version).toBe(4);
      expect(comparison?.candidate.stage).toBe('STAGING');
      expect(comparison?.candidate.versionId).toBe('version-4');
      // The incumbent is untouched — a retrain promotes nothing.
      expect(comparison?.incumbent.stage).toBe('PRODUCTION');
      expect(comparison?.incumbent.version).toBe(3);
      // Same artifact/target/split on both sides, so the delta is real.
      expect(comparison?.basis.comparable).toBe(true);
      expect(comparison?.rmseDelta).toBeCloseTo(-0.5);
    });

    it('leaves version/stage null while the job has not minted one yet', async () => {
      const live = { ...JOB_BASE, bestRunId: 'run-candidate' };
      const prisma = makePrisma({
        liveJob: live,
        runsById: {
          'run-incumbent': RUN_BASE,
          'run-candidate': { ...RUN_BASE, id: 'run-candidate' },
        },
      });
      const service = new ModelRetrainAuthorizedService(
        prisma as never,
        makeCandidateJobs(live) as never,
      );

      const res = await service.getCurrentRetrainJobService('model-1', ADMIN);
      const comparison = res.data?.job?.comparison;

      expect(comparison?.candidate.versionId).toBeNull();
      expect(comparison?.candidate.version).toBeNull();
      expect(comparison?.candidate.stage).toBeNull();
      // Not a read for a version that does not exist.
      expect(prisma.modelVersion.findUnique).not.toHaveBeenCalledWith(
        expect.objectContaining({ select: { version: true, stage: true } }),
      );
    });

    it('refuses a delta and states the reason when the bases differ', async () => {
      const finished = {
        ...JOB_BASE,
        status: 'SUCCEEDED',
        resultVersionId: 'version-4',
        bestRunId: 'run-candidate',
      };
      const prisma = makePrisma({
        liveJob: finished,
        resultVersion: { version: 4, stage: 'STAGING' },
        runsById: {
          'run-incumbent': RUN_BASE,
          'run-candidate': {
            ...RUN_BASE,
            id: 'run-candidate',
            goldArtifactId: 'gold-OTHER',
            metrics: { rmse: 0.75, r2: 0.95, mae: 0.3 },
          },
        },
      });
      const service = new ModelRetrainAuthorizedService(
        prisma as never,
        makeCandidateJobs(finished) as never,
      );

      const res = await service.getCurrentRetrainJobService('model-1', ADMIN);
      const comparison = res.data?.job?.comparison;

      expect(comparison?.basis.comparable).toBe(false);
      expect(comparison?.basis.reason).toContain('different training artifact');
      expect(comparison?.rmseDelta).toBeNull();
      // Both raw numbers survive — an incomparable basis is not a blank.
      expect(comparison?.incumbent.metrics.rmse).toBe(1.25);
      expect(comparison?.candidate.metrics.rmse).toBe(0.75);
    });
  });
});
