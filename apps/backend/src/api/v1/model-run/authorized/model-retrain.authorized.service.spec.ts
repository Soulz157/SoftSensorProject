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
    sourceDatasetId: 'dataset-base',
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
        // MODEL-FLOW-024. The trigger path's own reads and writes. `findUnique`
        // is the source job's recorded figures (null = the link was cleared).
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
            Promise.resolve({ ...JOB_BASE, ...data, status: 'QUEUED' }),
          ),
        update: jest
          .fn()
          .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
            Promise.resolve({ ...JOB_BASE, ...data }),
          ),
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
      // MODEL-SERVE-015-T01. getCurrentRetrainJobService's own base-dataset
      // resolution — irrelevant to every pre-015 test here, so a fixed
      // stand-in is enough.
      datasetVersion: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'version-base-1', versionNumber: 2 }),
      },
      dataset: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'dataset-base', name: 'Base Dataset' }),
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
      // MODEL-FLOW-024. Pass-through by default: the real one only adds the
      // artifact's feature count for pls, which its own spec covers.
      withFeatureCount: jest
        .fn()
        .mockImplementation(
          (_algorithm: string, _artifactId: string, size = {}) =>
            Promise.resolve(size),
        ),
    };
  }

  describe('getCurrentRetrainJobService', () => {
    it('resolves the incumbent even when the model has never been retrained', async () => {
      const prisma = makePrisma();
      const service = new ModelRetrainAuthorizedService(
        prisma as never,
        makeCandidateJobs(JOB_BASE) as never,
        {} as never,
      );

      const res = await service.getCurrentRetrainJobService('model-1', ADMIN);

      expect(res.data).toEqual({
        incumbent: {
          versionId: 'version-1',
          version: 3,
          algorithm: 'ridge',
          baseDataset: {
            datasetId: 'dataset-base',
            datasetName: 'Base Dataset',
            versionId: 'version-base-1',
            versionNumber: 2,
          },
        },
        job: null,
      });
    });

    it('reports a null incumbent when no PRODUCTION version exists — never invents one', async () => {
      const prisma = makePrisma({ productionVersion: null });
      const service = new ModelRetrainAuthorizedService(
        prisma as never,
        makeCandidateJobs(JOB_BASE) as never,
        {} as never,
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
        {} as never,
      );

      const res = await service.getCurrentRetrainJobService('model-1', ADMIN);

      // Only the live lookup ran — no fallback read was needed.
      expect(prisma.modelCandidateJob.findFirst).toHaveBeenCalledTimes(1);
      expect(
        (
          prisma.modelCandidateJob.findFirst.mock.calls[0] as [
            { where: { status?: unknown } },
          ]
        )[0].where.status,
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
        {} as never,
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
        {} as never,
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
        {} as never,
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
        {} as never,
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
        {} as never,
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

  describe('buildComparison — MODEL-SERVE-015 AUGMENT_DATA basis', () => {
    it('is comparable when the candidate is scored on the frozen incumbent test rows, even on a different artifact', async () => {
      const finished = {
        ...JOB_BASE,
        status: 'SUCCEEDED',
        resultVersionId: 'version-4',
        bestRunId: 'run-candidate',
        retrainStrategy: 'AUGMENT_DATA',
      };
      const prisma = makePrisma({
        liveJob: finished,
        resultVersion: { version: 4, stage: 'STAGING' },
        runsById: {
          'run-incumbent': RUN_BASE,
          'run-candidate': {
            ...RUN_BASE,
            id: 'run-candidate',
            // A DIFFERENT artifact/checksum — the whole point of the
            // amendment: this must not fail comparability on its own.
            goldArtifactId: 'combined-gold-1',
            artifactChecksum: 'combined-sha',
            evalSetKind: 'FROZEN_INCUMBENT_TEST',
            frozenEvalChecksum: 'frozen-sha',
            holdoutMetrics: { rmse: 0.9, r2: 0.85, mae: 0.4 },
            // The candidate's OWN test split, over the combined data —
            // must never feed rmseDelta.
            metrics: { rmse: 5.0, r2: -2.0, mae: 3.0 },
          },
        },
      });
      const service = new ModelRetrainAuthorizedService(
        prisma as never,
        makeCandidateJobs(finished) as never,
        {} as never,
      );

      const res = await service.getCurrentRetrainJobService('model-1', ADMIN);
      const comparison = res.data?.job?.comparison;

      expect(comparison?.basis.comparable).toBe(true);
      expect(comparison?.basis.strategy).toBe('AUGMENT_DATA');
      expect(comparison?.basis.evalSet).toEqual({
        kind: 'FROZEN_INCUMBENT_TEST',
        checksum: 'frozen-sha',
      });
      // Delta is incumbent.metrics (1.25) vs candidate.holdoutMetrics
      // (0.9) — NEVER candidate.metrics (5.0).
      expect(comparison?.rmseDelta).toBeCloseTo(0.9 - 1.25);
      expect(comparison?.candidate.metrics.rmse).toBe(0.9);
      expect(comparison?.candidate.newRegimeMetrics?.rmse).toBe(5.0);
    });

    it('refuses a delta when the candidate has not yet been scored on the frozen set', async () => {
      const live = {
        ...JOB_BASE,
        bestRunId: 'run-candidate',
        retrainStrategy: 'AUGMENT_DATA',
      };
      const prisma = makePrisma({
        liveJob: live,
        runsById: {
          'run-incumbent': RUN_BASE,
          'run-candidate': {
            ...RUN_BASE,
            id: 'run-candidate',
            goldArtifactId: 'combined-gold-1',
            evalSetKind: null,
            frozenEvalChecksum: null,
            holdoutMetrics: null,
            metrics: { rmse: 5.0, r2: -2.0, mae: 3.0 },
          },
        },
      });
      const service = new ModelRetrainAuthorizedService(
        prisma as never,
        makeCandidateJobs(live) as never,
        {} as never,
      );

      const res = await service.getCurrentRetrainJobService('model-1', ADMIN);
      const comparison = res.data?.job?.comparison;

      expect(comparison?.basis.comparable).toBe(false);
      expect(comparison?.basis.reason).toContain('frozen test rows');
      expect(comparison?.rmseDelta).toBeNull();
      // The new-regime number is still visible, never blanked.
      expect(comparison?.candidate.newRegimeMetrics?.rmse).toBe(5.0);
    });

    it('a plain (KEEP_EXISTING) retrain never carries newRegimeMetrics', async () => {
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
        {} as never,
      );

      const res = await service.getCurrentRetrainJobService('model-1', ADMIN);
      const comparison = res.data?.job?.comparison;

      expect(comparison?.basis.strategy).toBe('KEEP_EXISTING');
      expect(comparison?.basis.evalSet).toBeNull();
      expect(comparison?.candidate.newRegimeMetrics).toBeNull();
    });
  });

  /**
   * MODEL-FLOW-024. A retrain's curated search inherits the size figures the
   * incumbent's own job recorded, so it tunes in the same tier the wizard did.
   * The fixture is the measured pair (8,350 rows holding 32 distinct values):
   * a service that swapped the two would size capacity off the row count.
   */
  describe('triggerRetrainService — sized search (MODEL-FLOW-024)', () => {
    const SOURCE_RUN = { ...RUN_BASE, candidateJobId: 'job-src' };

    function setup(opts: { withSourceJob: boolean; sourceJob?: unknown }) {
      const prisma = makePrisma({
        runsById: {
          'run-incumbent': opts.withSourceJob ? SOURCE_RUN : RUN_BASE,
        },
      });
      prisma.modelCandidateJob.findUnique.mockResolvedValue(
        opts.sourceJob === undefined
          ? { sizedRowCount: 8350, sizedDistinctLabelled: 32 }
          : opts.sourceJob,
      );
      const candidateJobs = makeCandidateJobs(JOB_BASE);
      candidateJobs.expandSearchCandidates.mockReturnValue([
        { algorithm: 'ridge', hyperparameters: { alpha: 1 } },
        { algorithm: 'ridge', hyperparameters: { alpha: 3 } },
      ]);
      candidateJobs.launchForJob.mockResolvedValue({ id: 'run-new-1' });
      const service = new ModelRetrainAuthorizedService(
        prisma as never,
        candidateJobs as never,
        {} as never,
      );
      return { prisma, candidateJobs, service };
    }

    it('sizes the automatic search from the incumbent’s job figures and records them on the new job', async () => {
      const { prisma, candidateJobs, service } = setup({ withSourceJob: true });

      await service.triggerRetrainService('model-1', {} as never, ADMIN);

      expect(prisma.modelCandidateJob.findUnique).toHaveBeenCalledWith({
        where: { id: 'job-src' },
        select: { sizedRowCount: true, sizedDistinctLabelled: true },
      });
      expect(candidateJobs.expandSearchCandidates).toHaveBeenCalledWith(
        { algorithm: 'ridge', hyperparameters: { alpha: 1 } },
        { distinctLabelled: 32, rows: 8350 },
      );
      // Carried onto the row so the NEXT retrain can inherit in turn.
      const data = (
        prisma.modelCandidateJob.create.mock.calls[0] as [
          { data: Record<string, unknown> },
        ]
      )[0].data;
      expect(data.sizedRowCount).toBe(8350);
      expect(data.sizedDistinctLabelled).toBe(32);
    });

    it('asks for the feature count of the artifact the retrain actually trains on', async () => {
      const { candidateJobs, service } = setup({ withSourceJob: true });

      await service.triggerRetrainService('model-1', {} as never, ADMIN);

      expect(candidateJobs.withFeatureCount).toHaveBeenCalledWith(
        'ridge',
        'gold-1',
        { distinctLabelled: 32, rows: 8350 },
      );
    });

    it('falls back to the medium grid and records nothing when the run was not part of a job', async () => {
      const { prisma, candidateJobs, service } = setup({
        withSourceJob: false,
      });

      await service.triggerRetrainService('model-1', {} as never, ADMIN);

      expect(prisma.modelCandidateJob.findUnique).not.toHaveBeenCalled();
      expect(candidateJobs.expandSearchCandidates).toHaveBeenCalledWith(
        expect.anything(),
        {},
      );
      const data = (
        prisma.modelCandidateJob.create.mock.calls[0] as [
          { data: Record<string, unknown> },
        ]
      )[0].data;
      expect(data).not.toHaveProperty('sizedRowCount');
      expect(data).not.toHaveProperty('sizedDistinctLabelled');
    });

    it.each([
      ['its job row is gone (the link is SetNull)', null],
      [
        'its job recorded neither figure',
        { sizedRowCount: null, sizedDistinctLabelled: null },
      ],
    ])('inherits nothing when %s', async (_label, sourceJob) => {
      const { prisma, candidateJobs, service } = setup({
        withSourceJob: true,
        sourceJob,
      });

      await service.triggerRetrainService('model-1', {} as never, ADMIN);

      expect(candidateJobs.expandSearchCandidates).toHaveBeenCalledWith(
        expect.anything(),
        {},
      );
      const data = (
        prisma.modelCandidateJob.create.mock.calls[0] as [
          { data: Record<string, unknown> },
        ]
      )[0].data;
      expect(data).not.toHaveProperty('sizedRowCount');
    });

    it('still carries the figures forward for a CUSTOM candidate list, without expanding or looking up features', async () => {
      const { prisma, candidateJobs, service } = setup({ withSourceJob: true });

      await service.triggerRetrainService(
        'model-1',
        {
          candidates: [{ algorithm: 'ridge', hyperparameters: { alpha: 3 } }],
        } as never,
        ADMIN,
      );

      expect(candidateJobs.expandSearchCandidates).not.toHaveBeenCalled();
      expect(candidateJobs.withFeatureCount).not.toHaveBeenCalled();
      const data = (
        prisma.modelCandidateJob.create.mock.calls[0] as [
          { data: Record<string, unknown> },
        ]
      )[0].data;
      expect(data.sizedDistinctLabelled).toBe(32);
    });
  });

  describe('resolveTuningSizeService (MODEL-FLOW-024)', () => {
    it('returns the incumbent’s inherited figures plus the feature count for the algorithm asked about', async () => {
      const prisma = makePrisma({
        runsById: {
          'run-incumbent': { ...RUN_BASE, candidateJobId: 'job-src' },
        },
      });
      prisma.modelCandidateJob.findUnique.mockResolvedValue({
        sizedRowCount: 8350,
        sizedDistinctLabelled: 32,
      });
      const candidateJobs = makeCandidateJobs(JOB_BASE);
      candidateJobs.withFeatureCount.mockResolvedValue({
        distinctLabelled: 32,
        rows: 8350,
        features: 4,
      });
      const service = new ModelRetrainAuthorizedService(
        prisma as never,
        candidateJobs as never,
        {} as never,
      );

      const size = await service.resolveTuningSizeService(
        'model-1',
        'pls',
        ADMIN,
      );

      expect(candidateJobs.withFeatureCount).toHaveBeenCalledWith(
        'pls',
        'gold-1',
        { distinctLabelled: 32, rows: 8350 },
      );
      expect(size).toEqual({ distinctLabelled: 32, rows: 8350, features: 4 });
    });

    it('is the empty size (the medium grid) when the model has no PRODUCTION version, not an error', async () => {
      const prisma = makePrisma({ productionVersion: null });
      const service = new ModelRetrainAuthorizedService(
        prisma as never,
        makeCandidateJobs(JOB_BASE) as never,
        {} as never,
      );

      await expect(
        service.resolveTuningSizeService('model-1', 'ridge', ADMIN),
      ).resolves.toEqual({});
    });

    it('checks editor access before revealing anything', async () => {
      const prisma = makePrisma();
      prisma.model.findUnique.mockResolvedValue(null);
      const service = new ModelRetrainAuthorizedService(
        prisma as never,
        makeCandidateJobs(JOB_BASE) as never,
        {} as never,
      );

      await expect(
        service.resolveTuningSizeService('model-1', 'ridge', ADMIN),
      ).rejects.toThrow();
      expect(prisma.modelVersion.findFirst).not.toHaveBeenCalled();
    });
  });
});
