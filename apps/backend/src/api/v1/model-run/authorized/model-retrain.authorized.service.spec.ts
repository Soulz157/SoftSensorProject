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
    // The incumbent's own basis label ONLY (D03's gate no longer reads
    // this — see COMBINED_ARTIFACT_BASE's own comment for why comparing it
    // against validationRowCount was wrong: different populations).
    splitStats: {
      cut_timestamp: '2026-06-01T00:00:00Z',
      test_labelled_rows: 40,
    },
  };

  // MODEL-SERVE-019. The combined GOLD artifact `buildComparison` reads for
  // a new-data strategy's FROZEN_INCUMBENT_TEST/MERGED_TEST_SPLIT bases.
  //
  // D03's gate reads `operations[0].frozenEvalDroppedRows`, never
  // `validationRowCount` against the incumbent's `test_labelled_rows` — an
  // early version of this feature compared those two, and they describe
  // DIFFERENT populations (this artifact's unmasked row count vs. a
  // different service's labelled-only count), which would have refused the
  // delta on nearly every real model regardless of whether the slice
  // actually matched. `frozenEvalDroppedRows: 0` means the frozen slice
  // covers the SAME row extent the incumbent's own test split does.
  const COMBINED_ARTIFACT_BASE = {
    validationRowCount: 40,
    rowCount: 140,
    operations: [
      {
        cutTimestamp: '2026-06-01T00:00:00Z',
        frozenEvalTo: '2026-07-01T00:00:00Z',
        combinedEndTime: '2026-08-01T00:00:00Z',
        frozenEvalDroppedRows: 0,
        baseTrainRowCount: 80,
        newTrainRowCount: 20,
        dedupeDropped: 0,
      },
    ],
  };

  // The row a retrain candidate actually trains on (MODEL-SERVE-020-T01): the
  // combined FINAL — no operations, no validation columns, a pointer up to
  // the GOLD that carries them. Mirrors buildCombinedArtifact's FINAL write.
  const COMBINED_FINAL = {
    id: 'combined-final-1',
    type: 'FINAL',
    parentArtifactId: 'combined-gold-1',
    rowCount: 140,
    operations: [],
    validationRowCount: null,
    validationHoldoutFrom: null,
  };

  function makePrisma(
    overrides: {
      liveJob?: Record<string, unknown> | null;
      anyJob?: Record<string, unknown> | null;
      productionVersion?: Record<string, unknown> | null;
      versionById?: Record<string, unknown> | null;
      resultVersion?: Record<string, unknown> | null;
      runsById?: Record<string, Record<string, unknown> | null>;
      // MODEL-SERVE-019. The combined GOLD artifact behind a new-data
      // strategy's FROZEN_INCUMBENT_TEST/MERGED_TEST_SPLIT bases; `null`
      // exercises "not recorded" rather than a fetch failure.
      combinedArtifact?: Record<string, unknown> | null;
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
      // MODEL-SERVE-019-T03. Only reached for a new-data strategy
      // (`isAugmented`); `frozenEvalDroppedRows: 0` in COMBINED_ARTIFACT_BASE
      // holds the D03 gate comparable unless a test overrides it.
      // ID-AWARE on purpose: a candidate run's goldArtifactId is the combined
      // FINAL, whose `operations` is [] and whose validation columns are
      // null — the real data lives on its GOLD PARENT. An earlier version of
      // this mock returned one object for any id, which is exactly why a
      // read of the wrong row (the FINAL) passed every test while making
      // every live comparison non-comparable (MODEL-SERVE-020-T01).
      datasetArtifact: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.id === 'combined-final-1')
            return Promise.resolve(COMBINED_FINAL);
          if (where.id === 'combined-gold-1') {
            return Promise.resolve(
              overrides.combinedArtifact === undefined
                ? COMBINED_ARTIFACT_BASE
                : overrides.combinedArtifact,
            );
          }
          return Promise.resolve(null);
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
          // MODEL-SERVE-017. Null here because this fixture's version row
          // carries no source run — the same condition the real resolver
          // treats as "no computed boundary", which leaves the range picker
          // unclamped rather than inventing one.
          cutTimestamp: null,
          // Custom Finetune prefills its table and split from these.
          hyperparameters: { alpha: 1 },
          trainTestSplit: null,
        },
        job: null,
      });
    });

    it("exposes the current version's own train/test ratio for Custom Finetune to prefill", async () => {
      const prisma = makePrisma({
        productionVersion: {
          ...INCUMBENT_VERSION,
          sourceRun: {
            splitSpec: {
              method: 'chronological',
              ratio: 0.7,
              cut_timestamp: '2025-11-06 00:00:00',
            },
          },
        },
      });
      const service = new ModelRetrainAuthorizedService(
        prisma as never,
        makeCandidateJobs(JOB_BASE) as never,
        {} as never,
      );

      const res = await service.getCurrentRetrainJobService('model-1', ADMIN);

      expect(res.data.incumbent).toMatchObject({
        trainTestSplit: 0.7,
        cutTimestamp: '2025-11-06 00:00:00',
      });
    });

    it('reports no ratio for a cross-validated version — it has no single one to reuse', async () => {
      const prisma = makePrisma({
        productionVersion: {
          ...INCUMBENT_VERSION,
          sourceRun: { splitSpec: { method: 'cv_expanding', n_splits: 5 } },
        },
      });
      const service = new ModelRetrainAuthorizedService(
        prisma as never,
        makeCandidateJobs(JOB_BASE) as never,
        {} as never,
      );

      const res = await service.getCurrentRetrainJobService('model-1', ADMIN);

      expect(res.data.incumbent?.trainTestSplit).toBeNull();
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

  describe('buildComparison — MODEL-SERVE-021 NEW_DATA_ONLY basis', () => {
    // MODEL-SERVE-021 REVERSES MODEL-SERVE-017's own rule: NEW_DATA_ONLY no
    // longer carves a frozen slice of the incumbent's own rows (it REPLACES
    // the training data outright, so there is nothing of the incumbent's own
    // rows left to freeze). Comparability instead comes from scoring BOTH
    // the candidate and the incumbent's own saved model, inside the
    // candidate's training container, on the SAME operator-defined
    // validation window — `newDataHoldoutMetrics` / `incumbentNewDataHoldoutMetrics`
    // on the candidate run, never `evalSetKind`/`frozenEvalChecksum`.
    const finished = {
      ...JOB_BASE,
      status: 'SUCCEEDED',
      resultVersionId: 'version-4',
      bestRunId: 'run-candidate',
      retrainStrategy: 'NEW_DATA_ONLY',
    };

    it('is comparable when both versions were scored on the shared validation window, and reports its own strategy', async () => {
      const prisma = makePrisma({
        liveJob: finished,
        resultVersion: { version: 4, stage: 'STAGING' },
        runsById: {
          'run-incumbent': RUN_BASE,
          'run-candidate': {
            ...RUN_BASE,
            id: 'run-candidate',
            goldArtifactId: 'combined-final-1',
            artifactChecksum: 'new-only-sha',
            metrics: { rmse: 5.0, r2: -2.0, mae: 3.0 },
            newDataHoldoutMetrics: { rmse: 0.9, r2: 0.85, mae: 0.4 },
            incumbentNewDataHoldoutMetrics: { rmse: 1.25, r2: 0.8, mae: 0.5 },
            newDataHoldoutRowCount: 30,
            newDataHoldoutFrom: new Date('2026-11-06T19:00:00Z'),
            newDataHoldoutTo: new Date('2026-11-10T19:00:00Z'),
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
      // Its OWN strategy — never reported as AUGMENT_DATA, which would tell
      // the reader the candidate also trained on the incumbent's rows.
      expect(comparison?.basis.strategy).toBe('NEW_DATA_ONLY');
      // No frozen slice any more — never a stale FROZEN_INCUMBENT_TEST kind.
      expect(comparison?.basis.evalSet).toBeNull();
      expect(comparison?.basis.trainingComposition).toBeNull();
      // Both figures come off the SAME shared window, never the incumbent's
      // own historical test split or the candidate's plain test metrics.
      expect(comparison?.candidate.metrics).toEqual({
        rmse: 0.9,
        r2: 0.85,
        mae: 0.4,
      });
      expect(comparison?.incumbent.metrics).toEqual({
        rmse: 1.25,
        r2: 0.8,
        mae: 0.5,
      });
      expect(comparison?.candidate.metricsBasis?.frame).toBe('NEW_DATA_WINDOW');
      expect(comparison?.candidate.metricsBasis?.usedFor).toBe(
        'COMPARE_TO_PRODUCTION',
      );
      expect(comparison?.incumbent.metricsBasis?.frame).toBe('NEW_DATA_WINDOW');
      // Never duplicated under the standalone "report only" field.
      expect(comparison?.candidate.newDataHoldoutMetrics).toBeNull();
      expect(comparison?.rmseDelta).toBeCloseTo(0.9 - 1.25);
    });

    it('is not comparable when the current version could not be scored on the same window (e.g. lstm/gru, no recorded sequence_length)', async () => {
      const prisma = makePrisma({
        liveJob: finished,
        resultVersion: { version: 4, stage: 'STAGING' },
        runsById: {
          'run-incumbent': RUN_BASE,
          'run-candidate': {
            ...RUN_BASE,
            id: 'run-candidate',
            goldArtifactId: 'combined-final-1',
            artifactChecksum: 'new-only-sha',
            newDataHoldoutMetrics: { rmse: 0.9, r2: 0.85, mae: 0.4 },
            incumbentNewDataHoldoutMetrics: null,
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
      expect(comparison?.basis.reason).toContain(
        'the current version could not be scored on the same validation window',
      );
      expect(comparison?.rmseDelta).toBeNull();
    });

    it('is not comparable when the candidate has not been scored on the window yet', async () => {
      const prisma = makePrisma({
        liveJob: finished,
        resultVersion: { version: 4, stage: 'STAGING' },
        runsById: {
          'run-incumbent': RUN_BASE,
          'run-candidate': {
            ...RUN_BASE,
            id: 'run-candidate',
            goldArtifactId: 'combined-final-1',
            artifactChecksum: 'new-only-sha',
            newDataHoldoutMetrics: null,
            incumbentNewDataHoldoutMetrics: null,
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
      expect(comparison?.basis.reason).toContain(
        'the new version has not been scored on the validation window yet',
      );
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
            goldArtifactId: 'combined-final-1',
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
            goldArtifactId: 'combined-final-1',
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
      // MODEL-SERVE-019. Reworded jargon-free (no "incumbent"/"frozen") —
      // the client displays this string verbatim.
      expect(comparison?.basis.reason).toContain(
        "not yet scored on the current production version's own test data",
      );
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

    /**
     * MODEL-SERVE-019-D03. The candidate is scored on a RE-CUT frozen slice
     * that can be a strict subset of the incumbent's own full test split —
     * a raw delta across mismatched rows is refused rather than published.
     * Gated on `frozenEvalDroppedRows` (rows the new dataset's start cut off
     * the incumbent's own frozen tail), NOT on comparing this artifact's
     * unmasked row count against the incumbent's LABELLED row count — an
     * earlier version of this gate did that, and the two counts describe
     * different populations (would refuse on nearly every real model).
     */
    it('refuses the delta when the new dataset cuts into the frozen slice', async () => {
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
            goldArtifactId: 'combined-final-1',
            evalSetKind: 'FROZEN_INCUMBENT_TEST',
            frozenEvalChecksum: 'frozen-sha',
            holdoutMetrics: { rmse: 0.9, r2: 0.85, mae: 0.4 },
            metrics: { rmse: 5.0, r2: -2.0, mae: 3.0 },
          },
        },
        // 15 of the incumbent's own frozen rows fell at/after the new
        // dataset's start and were cut from the slice.
        combinedArtifact: {
          ...COMBINED_ARTIFACT_BASE,
          operations: [
            {
              ...COMBINED_ARTIFACT_BASE.operations[0],
              frozenEvalDroppedRows: 15,
            },
          ],
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
      expect(comparison?.basis.reason).toContain('fewer rows');
      expect(comparison?.basis.reason).toContain('15');
      expect(comparison?.rmseDelta).toBeNull();
      // Both raw numbers survive — an incomparable basis is not a blank.
      expect(comparison?.candidate.metrics.rmse).toBe(0.9);
      expect(comparison?.incumbent.metrics.rmse).toBe(1.25);
    });

    it('refuses the delta when frozenEvalDroppedRows was never recorded (a retrain from before this check)', async () => {
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
            goldArtifactId: 'combined-final-1',
            evalSetKind: 'FROZEN_INCUMBENT_TEST',
            frozenEvalChecksum: 'frozen-sha',
            holdoutMetrics: { rmse: 0.9, r2: 0.85, mae: 0.4 },
            metrics: { rmse: 5.0, r2: -2.0, mae: 3.0 },
          },
        },
        combinedArtifact: {
          ...COMBINED_ARTIFACT_BASE,
          operations: [
            {
              ...COMBINED_ARTIFACT_BASE.operations[0],
              frozenEvalDroppedRows: undefined,
            },
          ],
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
      expect(comparison?.basis.reason).toContain('not recorded whether');
      expect(comparison?.rmseDelta).toBeNull();
    });

    it("still shows the incumbent's own basis label even though it plays no part in the D03 gate", async () => {
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
          // A legacy incumbent run recorded before splitStats existed.
          'run-incumbent': { ...RUN_BASE, splitStats: null },
          'run-candidate': {
            ...RUN_BASE,
            id: 'run-candidate',
            goldArtifactId: 'combined-final-1',
            evalSetKind: 'FROZEN_INCUMBENT_TEST',
            frozenEvalChecksum: 'frozen-sha',
            holdoutMetrics: { rmse: 0.9, r2: 0.85, mae: 0.4 },
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

      // The default fixture's frozenEvalDroppedRows: 0 still holds this
      // comparable — the incumbent's OWN missing splitStats no longer gates
      // the delta, it only leaves the display-only basis label empty.
      expect(comparison?.basis.comparable).toBe(true);
      expect(
        comparison?.incumbent.metricsBasis?.unavailableReason,
      ).toBeTruthy();
      expect(comparison?.incumbent.metricsBasis?.rowCount).toBeNull();
    });

    /**
     * MODEL-SERVE-020. The real defect this pins: the trainer re-splits the
     * combined artifact chronologically, so the newest rows — the new data —
     * land in the TEST split and never in the fit. `trainingComposition`
     * describes what the candidate was FIT on, off its own recorded split.
     */
    describe('what the candidate was fit on', () => {
      function fitOf(
        splitSpec: Record<string, unknown>,
        ops: Record<string, unknown> = {},
      ) {
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
              goldArtifactId: 'combined-final-1',
              evalSetKind: 'FROZEN_INCUMBENT_TEST',
              frozenEvalChecksum: 'f',
              holdoutMetrics: { rmse: 0.9, r2: 0.85, mae: 0.4 },
              metrics: { rmse: 5, r2: -2, mae: 3 },
              splitSpec,
            },
          },
          combinedArtifact: {
            ...COMBINED_ARTIFACT_BASE,
            operations: [{ ...COMBINED_ARTIFACT_BASE.operations[0], ...ops }],
          },
        });
        const service = new ModelRetrainAuthorizedService(
          prisma as never,
          makeCandidateJobs(finished) as never,
          {} as never,
        );
        return service
          .getCurrentRetrainJobService('model-1', ADMIN)
          .then((r) => r.data?.job?.comparison?.basis.trainingComposition);
      }

      it('says NO new data was in the fit when the fit stops before the base cut (the real 5-of-5 case)', async () => {
        const tc = await fitOf(
          {
            method: 'chronological',
            ratio: 0.7,
            train_rows: 2180,
            cut_timestamp: '2025-09-29 20:00:00',
          },
          { cutTimestamp: '2025-11-06 19:00:00', frozenEvalTo: null },
        );
        expect(tc?.fitRowCount).toBe(2180);
        expect(tc?.fitUpTo).toBe('2025-09-29 20:00:00');
        expect(tc?.newDataUsedInFit).toBe(false);
      });

      it('says new data WAS in the fit when the fit reaches past the new data’s own start', async () => {
        const tc = await fitOf(
          {
            method: 'chronological',
            ratio: 0.7,
            train_rows: 16,
            cut_timestamp: '2025-11-20 00:00:00',
          },
          {
            cutTimestamp: '2025-11-06 19:00:00',
            frozenEvalTo: '2025-11-17 14:00:00',
          },
        );
        expect(tc?.newDataUsedInFit).toBe(true);
      });

      it('says unknown — never a guess — when the persisted facts cannot settle it', async () => {
        const tc = await fitOf(
          {
            method: 'chronological',
            ratio: 0.7,
            train_rows: 16,
            cut_timestamp: '2025-11-20 00:00:00',
          },
          { cutTimestamp: '2025-11-06 19:00:00', frozenEvalTo: null },
        );
        expect(tc?.newDataUsedInFit).toBeNull();
      });
    });

    it('populates each figure basis from persisted rows when the comparison holds', async () => {
      const finished = {
        ...JOB_BASE,
        status: 'SUCCEEDED',
        resultVersionId: 'version-4',
        bestRunId: 'run-candidate',
        retrainStrategy: 'AUGMENT_DATA',
        splitStats: {
          cut_timestamp: '2026-06-15T00:00:00Z',
          test_labelled_rows: 30,
        },
      };
      const prisma = makePrisma({
        liveJob: finished,
        resultVersion: { version: 4, stage: 'STAGING' },
        runsById: {
          'run-incumbent': RUN_BASE,
          'run-candidate': {
            ...RUN_BASE,
            id: 'run-candidate',
            goldArtifactId: 'combined-final-1',
            evalSetKind: 'FROZEN_INCUMBENT_TEST',
            frozenEvalChecksum: 'frozen-sha',
            holdoutMetrics: { rmse: 0.9, r2: 0.85, mae: 0.4 },
            metrics: { rmse: 5.0, r2: -2.0, mae: 3.0 },
            newDataHoldoutMetrics: { rmse: 1.1, r2: 0.5, mae: 0.6 },
            newDataHoldoutRowCount: 10,
            newDataHoldoutFrom: new Date('2026-07-01T00:00:00Z'),
            newDataHoldoutTo: new Date('2026-07-15T00:00:00Z'),
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
      // MODEL-SERVE-020-T05: the charts need the current version's own run.
      expect(comparison?.incumbent.sourceRunId).toBe('run-incumbent');
      expect(comparison?.incumbent.metricsBasis).toEqual({
        frame: 'INCUMBENT_TEST_SPLIT',
        from: '2026-06-01T00:00:00Z',
        to: null,
        rowCount: 40,
        usedFor: 'COMPARE_TO_PRODUCTION',
        unavailableReason: null,
      });
      expect(comparison?.candidate.metricsBasis).toEqual({
        frame: 'FROZEN_INCUMBENT_TEST',
        from: '2026-06-01T00:00:00Z',
        to: '2026-07-01T00:00:00Z',
        rowCount: 40,
        usedFor: 'COMPARE_TO_PRODUCTION',
        unavailableReason: null,
      });
      expect(comparison?.candidate.newRegimeMetricsBasis).toEqual({
        frame: 'MERGED_TEST_SPLIT',
        from: '2026-06-15T00:00:00Z',
        to: '2026-08-01T00:00:00Z',
        rowCount: 30,
        usedFor: 'RANK_CANDIDATES',
        unavailableReason: null,
      });
      expect(comparison?.candidate.newDataHoldoutBasis).toEqual({
        frame: 'NEW_DATA_WINDOW',
        from: '2026-07-01T00:00:00.000Z',
        to: '2026-07-15T00:00:00.000Z',
        rowCount: 10,
        usedFor: 'REPORT_ONLY',
        unavailableReason: null,
      });
      expect(comparison?.basis.trainingComposition).toEqual({
        baseTrainRowCount: 80,
        newTrainRowCount: 20,
        dedupeDropped: 0,
        cutTimestamp: '2026-06-01T00:00:00Z',
        combinedRowCount: 140,
        // The candidate run in this fixture records no split of its own.
        fitRowCount: null,
        fitUpTo: null,
        newDataUsedInFit: null,
      });
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

    it("reuses the current version's train/test ratio when the request names none", async () => {
      const { prisma, service } = setup({ withSourceJob: true });

      await service.triggerRetrainService('model-1', {} as never, ADMIN);

      const data = (
        prisma.modelCandidateJob.create.mock.calls[0] as [
          { data: Record<string, unknown> },
        ]
      )[0].data;
      expect(data.trainTestSplit).toBe(0.8);
    });

    it('trains on the ratio Custom Finetune asked for, when one is given', async () => {
      const { prisma, service } = setup({ withSourceJob: true });

      await service.triggerRetrainService(
        'model-1',
        {
          candidates: [{ algorithm: 'ridge', hyperparameters: { alpha: 3 } }],
          trainTestSplit: 0.7,
        } as never,
        ADMIN,
      );

      const data = (
        prisma.modelCandidateJob.create.mock.calls[0] as [
          { data: Record<string, unknown> },
        ]
      )[0].data;
      expect(data.trainTestSplit).toBe(0.7);
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

  /**
   * MODEL-SERVE-019-D01. Keep Existing Data is removed as a CHOICE for a new
   * trigger, but the enum value and the idempotency replay path both stay —
   * a retry of an old KEEP_EXISTING job must still return that job.
   */
  describe('triggerRetrainService — MODEL-SERVE-019 Keep Existing removal', () => {
    it('refuses a new KEEP_EXISTING request with 422', async () => {
      const prisma = makePrisma();
      const service = new ModelRetrainAuthorizedService(
        prisma as never,
        makeCandidateJobs(JOB_BASE) as never,
        {} as never,
      );

      await expect(
        service.triggerRetrainService(
          'model-1',
          { strategy: 'KEEP_EXISTING' } as never,
          ADMIN,
        ),
      ).rejects.toMatchObject({ statusCode: 422 });
      // Refused BEFORE a job row is created.
      expect(prisma.modelCandidateJob.create).not.toHaveBeenCalled();
    });

    it('replays an existing KEEP_EXISTING job by idempotencyKey instead of refusing', async () => {
      const existing = { ...JOB_BASE, id: 'old-keep-job', status: 'RUNNING' };
      const prisma = makePrisma();
      prisma.modelCandidateJob.findFirst = jest
        .fn()
        .mockResolvedValue(existing);
      const service = new ModelRetrainAuthorizedService(
        prisma as never,
        makeCandidateJobs(JOB_BASE) as never,
        {} as never,
      );

      const res = await service.triggerRetrainService(
        'model-1',
        { strategy: 'KEEP_EXISTING', idempotencyKey: 'retry-1' } as never,
        ADMIN,
      );

      expect(res.statusCode).toBe(200);
      expect(res.data.jobId).toBe('old-keep-job');
      expect(prisma.modelCandidateJob.create).not.toHaveBeenCalled();
    });

    // NOTE: an absent `strategy` (`dto.strategy === undefined`) is NOT
    // refused by this service check — `strategy` being required is enforced
    // at the DTO/zod boundary (`TriggerRetrainSchema`), not repeated here.
    // The pre-existing `triggerRetrainService — sized search` tests above
    // call the service directly with `{} as never`, bypassing that DTO
    // layer entirely to exercise sizing logic unrelated to strategy — they
    // rely on exactly this: an absent strategy takes the same code path a
    // KEEP_EXISTING job always did (no augmentation), which is what makes
    // them still valid regression tests of the sizing behaviour.
  });
});
