import { ModelRunAuthorizedService } from './model-run.authorized.service';
import * as pythonClient from '@/lib/python-preprocess-client';

jest.mock('@/lib/python-preprocess-client');

const mockedPresignArtifact = pythonClient.presignArtifact as jest.Mock;
// MODEL-FLOW-016-T08. The holdout presign is now a SEPARATE call
// (presignRunObject), not a second call to presignArtifact — the whole
// point of the fix (presignArtifact hard-refuses a run-scoped key). Mocked
// separately so each test queues exactly one once-value per mock per
// claim() call; chaining two mockResolvedValueOnce entries on ONE mock (as
// this used to, when both calls went through presignArtifact) leaks an
// unconsumed value into the next test, since jest.clearAllMocks() clears
// call history but not queued once-implementations.
const mockedPresignRunObject = pythonClient.presignRunObject as jest.Mock;
const mockedReplayHoldoutForRun = pythonClient.replayHoldoutForRun as jest.Mock;
const mockedPrepareHoldoutForRun =
  pythonClient.prepareHoldoutForRun as jest.Mock;

const RUN_BASE = {
  id: 'run-1',
  modelId: null as string | null,
  modelDraftId: 'draft-1' as string | null,
  datasetId: 'ds-1',
  goldArtifactId: 'gold-1',
  goldObjectKey: 'ds-1/artifacts/gold-1/data_gold.parquet',
  artifactChecksum: 'gold-checksum',
  featureSpecKey: 'ds-1/artifacts/gold-1/feature_spec.json' as string | null,
  targetY: 'TI-101',
  algorithm: 'ridge',
  hyperparameters: {},
  seed: 42,
  splitSpec: { method: 'chronological' },
  imageDigest: 'sha256:abc',
};

function makePrisma(
  overrides: {
    bronze?: Record<string, unknown> | null;
    run?: Record<string, unknown>;
  } = {},
) {
  const run = { ...RUN_BASE, ...overrides.run };
  const bronze =
    overrides.bronze === undefined
      ? {
          type: 'BRONZE',
          objectKey: 'ds-1/artifacts/bronze-1/data.parquet',
          validationRowCount: 3,
          validationHoldoutFrom: new Date('2026-01-08T00:00:00.000Z'),
        }
      : overrides.bronze;

  return {
    modelTrainingRun: {
      findUnique: jest.fn().mockResolvedValue(run),
      update: jest.fn().mockResolvedValue(run),
    },
    modelTrainingRunLog: {
      create: jest.fn().mockResolvedValue({}),
    },
    datasetArtifact: {
      findUnique: jest.fn().mockResolvedValue({ runId: 'wizard-run-1' }),
      findFirst: jest.fn().mockResolvedValue(bronze),
    },
    modelDraft: {
      update: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  };
}

describe('ModelRunAuthorizedService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPresignArtifact.mockResolvedValue({
      data_url: 'https://minio.example/gold-signed',
      sidecar_urls: {
        'feature_spec.json': 'https://minio.example/spec-signed',
      },
      checksum: 'gold-checksum',
      row_count: 100,
      expires_at: '2026-01-01T00:00:00Z',
    });
  });

  it('should be defined', () => {
    const prisma = makePrisma();
    const service = new ModelRunAuthorizedService(
      prisma as never,
      {
        advanceJobForRun: jest.fn(),
      } as never,
    );
    expect(service).toBeDefined();
  });

  describe('claim()', () => {
    it('replays the holdout and adds holdout fields when the dataset has one', async () => {
      const prisma = makePrisma();
      mockedReplayHoldoutForRun.mockResolvedValue({
        object_key: 'drafts/draft-1/runs/run-1/validate_ready.parquet',
        row_count: 3,
        checksum: 'replay-checksum',
      });
      mockedPresignRunObject.mockResolvedValueOnce({
        data_url: 'https://minio.example/holdout-signed',
        sidecar_urls: {},
        checksum: 'holdout-checksum',
        row_count: 3,
        expires_at: '2026-01-01T00:00:00Z',
      });

      const service = new ModelRunAuthorizedService(
        prisma as never,
        {
          advanceJobForRun: jest.fn(),
        } as never,
      );
      const result = await service.claim('run-1');

      expect(mockedReplayHoldoutForRun).toHaveBeenCalledWith({
        feature_spec_key: 'ds-1/artifacts/gold-1/feature_spec.json',
        source_key: 'ds-1/artifacts/bronze-1/validate_data.parquet',
        target_key: 'drafts/draft-1/runs/run-1/validate_ready.parquet',
        holdout_from: '2026-01-08T00:00:00.000Z',
        overwrite: true,
      });
      expect(mockedPresignRunObject).toHaveBeenCalledWith({
        source_key: 'drafts/draft-1/runs/run-1/validate_ready.parquet',
      });
      expect(result.holdoutDataUrl).toBe(
        'https://minio.example/holdout-signed',
      );
      expect(result.holdoutArtifactChecksum).toBe('holdout-checksum');
      expect(result.holdoutRowCount).toBe(3);
    });

    it('derives source_key from the BRONZE objectKey, not run.datasetId — a draft-scoped BRONZE resolves under drafts/, the bug this test locks in', async () => {
      const prisma = makePrisma({
        bronze: {
          // run.datasetId is 'ds-1' (RUN_BASE), but this run's dataset was
          // adopted from a draft — the BRONZE's real objectKey still starts
          // with drafts/. Before the fix,
          // `validateDataKey(run.datasetId, bronze.id)` would have rebuilt
          // `ds-1/artifacts/bronze-1/validate_data.parquet` — a key nothing
          // ever wrote — so this replay silently no-opped (soft-fail) for
          // every such run.
          type: 'BRONZE',
          objectKey: 'drafts/draft-9/artifacts/bronze-1/data_bronze.parquet',
          validationRowCount: 3,
          validationHoldoutFrom: new Date('2026-01-08T00:00:00.000Z'),
        },
      });
      mockedReplayHoldoutForRun.mockResolvedValue({
        object_key: 'drafts/draft-1/runs/run-1/validate_ready.parquet',
        row_count: 3,
        checksum: 'replay-checksum',
      });
      mockedPresignRunObject.mockResolvedValueOnce({
        data_url: 'https://minio.example/holdout-signed',
        sidecar_urls: {},
        checksum: 'holdout-checksum',
        row_count: 3,
        expires_at: '2026-01-01T00:00:00Z',
      });

      const service = new ModelRunAuthorizedService(
        prisma as never,
        {
          advanceJobForRun: jest.fn(),
        } as never,
      );
      await service.claim('run-1');

      expect(mockedReplayHoldoutForRun).toHaveBeenCalledWith(
        expect.objectContaining({
          source_key: 'drafts/draft-9/artifacts/bronze-1/validate_data.parquet',
        }),
      );
    });

    it('omits holdout fields and never replays when the dataset has no holdout', async () => {
      const prisma = makePrisma({
        bronze: {
          id: 'bronze-1',
          validationRowCount: null,
          validationHoldoutFrom: null,
        },
      });
      const service = new ModelRunAuthorizedService(
        prisma as never,
        {
          advanceJobForRun: jest.fn(),
        } as never,
      );

      const result = await service.claim('run-1');

      expect(mockedReplayHoldoutForRun).not.toHaveBeenCalled();
      expect(result).not.toHaveProperty('holdoutDataUrl');
      expect(result).not.toHaveProperty('holdoutArtifactChecksum');
      expect(result).not.toHaveProperty('holdoutRowCount');
    });

    it('omits holdout fields without querying artifacts when the run has no featureSpecKey', async () => {
      const prisma = makePrisma({ run: { featureSpecKey: null } });
      const service = new ModelRunAuthorizedService(
        prisma as never,
        {
          advanceJobForRun: jest.fn(),
        } as never,
      );

      const result = await service.claim('run-1');

      expect(prisma.datasetArtifact.findUnique).not.toHaveBeenCalled();
      expect(mockedReplayHoldoutForRun).not.toHaveBeenCalled();
      expect(result).not.toHaveProperty('holdoutDataUrl');
    });

    it('DS-LAKE-023-T03/D1: a SILVER-type holdout artifact routes to prepareHoldoutForRun, not replayHoldoutForRun, and needs no validationHoldoutFrom', async () => {
      const prisma = makePrisma({
        bronze: {
          type: 'SILVER',
          objectKey: 'ds-1/artifacts/silver-1/data_silver.parquet',
          validationRowCount: 5,
          // Deliberately null — a SILVER-produced (feature-bearing) holdout
          // has no lead-in to trim, so prepareHoldoutForRun needs no
          // holdout_from at all, unlike the BRONZE/replay branch.
          validationHoldoutFrom: null,
        },
      });
      mockedPrepareHoldoutForRun.mockResolvedValue({
        object_key: 'drafts/draft-1/runs/run-1/validate_ready.parquet',
        row_count: 5,
        checksum: 'prepare-checksum',
      });
      mockedPresignRunObject.mockResolvedValueOnce({
        data_url: 'https://minio.example/holdout-signed',
        sidecar_urls: {},
        checksum: 'holdout-checksum',
        row_count: 5,
        expires_at: '2026-01-01T00:00:00Z',
      });

      const service = new ModelRunAuthorizedService(
        prisma as never,
        {
          advanceJobForRun: jest.fn(),
        } as never,
      );
      const result = await service.claim('run-1');

      expect(mockedReplayHoldoutForRun).not.toHaveBeenCalled();
      expect(mockedPrepareHoldoutForRun).toHaveBeenCalledWith({
        feature_spec_key: 'ds-1/artifacts/gold-1/feature_spec.json',
        source_key: 'ds-1/artifacts/silver-1/validate_data.parquet',
        target_key: 'drafts/draft-1/runs/run-1/validate_ready.parquet',
        overwrite: true,
      });
      expect(result.holdoutDataUrl).toBe(
        'https://minio.example/holdout-signed',
      );
      expect(result.holdoutRowCount).toBe(5);
    });

    it("DS-LAKE-023 edit-mode re-split pass: a GOLD-type holdout artifact ALSO routes to prepareHoldoutForRun, not replayHoldoutForRun — edit mode's combined FEATURE job writes GOLD, not SILVER", async () => {
      const prisma = makePrisma({
        bronze: {
          type: 'GOLD',
          objectKey: 'ds-1/artifacts/gold-2/data_gold.parquet',
          validationRowCount: 7,
          // Same reasoning as the SILVER case above — a feature-bearing
          // holdout has no lead-in to trim.
          validationHoldoutFrom: null,
        },
      });
      mockedPrepareHoldoutForRun.mockResolvedValue({
        object_key: 'drafts/draft-1/runs/run-1/validate_ready.parquet',
        row_count: 7,
        checksum: 'prepare-checksum',
      });
      mockedPresignRunObject.mockResolvedValueOnce({
        data_url: 'https://minio.example/holdout-signed',
        sidecar_urls: {},
        checksum: 'holdout-checksum',
        row_count: 7,
        expires_at: '2026-01-01T00:00:00Z',
      });

      const service = new ModelRunAuthorizedService(
        prisma as never,
        {
          advanceJobForRun: jest.fn(),
        } as never,
      );
      const result = await service.claim('run-1');

      expect(mockedReplayHoldoutForRun).not.toHaveBeenCalled();
      expect(mockedPrepareHoldoutForRun).toHaveBeenCalledWith({
        feature_spec_key: 'ds-1/artifacts/gold-1/feature_spec.json',
        source_key: 'ds-1/artifacts/gold-2/validate_data.parquet',
        target_key: 'drafts/draft-1/runs/run-1/validate_ready.parquet',
        overwrite: true,
      });
      expect(result.holdoutDataUrl).toBe(
        'https://minio.example/holdout-signed',
      );
      expect(result.holdoutRowCount).toBe(7);
    });

    it('DS-LAKE-023 finding 4: resolves the holdout artifact deterministically (newest first), guarding against two artifacts sharing one runId', async () => {
      const prisma = makePrisma();
      mockedReplayHoldoutForRun.mockResolvedValue({
        object_key: 'drafts/draft-1/runs/run-1/validate_ready.parquet',
        row_count: 3,
        checksum: 'replay-checksum',
      });
      mockedPresignArtifact.mockResolvedValueOnce({
        data_url: 'https://minio.example/gold-signed',
        sidecar_urls: {
          'feature_spec.json': 'https://minio.example/spec-signed',
        },
        checksum: 'gold-checksum',
        row_count: 100,
        expires_at: '2026-01-01T00:00:00Z',
      });

      const service = new ModelRunAuthorizedService(
        prisma as never,
        {
          advanceJobForRun: jest.fn(),
        } as never,
      );
      await service.claim('run-1');

      const call = prisma.datasetArtifact.findFirst.mock.calls[0][0] as {
        where: { validationRowCount?: unknown };
        orderBy?: { createdAt?: string };
      };
      expect(call.orderBy).toEqual({ createdAt: 'desc' });
      expect(call.where.validationRowCount).toEqual({ not: null });
    });

    it('soft-fails a replay error: logs it, omits holdout fields, still returns the claim', async () => {
      const prisma = makePrisma();
      mockedReplayHoldoutForRun.mockRejectedValue(
        new Error('Lead-in is insufficient to replay this recipe'),
      );
      const service = new ModelRunAuthorizedService(
        prisma as never,
        {
          advanceJobForRun: jest.fn(),
        } as never,
      );

      const result = await service.claim('run-1');

      expect(result).not.toHaveProperty('holdoutDataUrl');
      expect(result.runId).toBe('run-1');
      expect(prisma.modelTrainingRunLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            runId: 'run-1',
            level: 'warn',
            message: expect.stringContaining('Lead-in is insufficient'),
          }),
        }),
      );
      // The run itself must NOT be marked FAILED by a holdout-only problem —
      // only the checksum-drift branch above it does that.
      expect(prisma.modelTrainingRun.update).not.toHaveBeenCalled();
    });
  });

  describe('complete()', () => {
    it('persists holdoutMetrics as a field separate from metrics', async () => {
      const prisma = makePrisma();
      const service = new ModelRunAuthorizedService(
        prisma as never,
        {
          advanceJobForRun: jest.fn(),
        } as never,
      );

      await service.complete('run-1', {
        status: 'SUCCEEDED',
        metrics: { r2: 0.9 },
        holdoutMetrics: { r2: 0.4 },
        splitSpec: {
          method: 'chronological',
          ratio: 0.8,
          cut_timestamp: '2026-01-01',
          train_rows: 10,
          test_rows: 3,
          source_rows: 13,
          labelled_rows: 13,
        },
        uploaded: ['model.joblib'],
      } as never);

      const [updateCall] = prisma.modelTrainingRun.update.mock.calls;
      expect(updateCall[0].data.metrics).toEqual({ r2: 0.9 });
      expect(updateCall[0].data.holdoutMetrics).toEqual({ r2: 0.4 });
    });

    it('MODEL-FLOW-016-T04: sets cvFoldsKey when cv_folds.json is uploaded, null otherwise', async () => {
      const prisma = makePrisma();
      const service = new ModelRunAuthorizedService(
        prisma as never,
        { advanceJobForRun: jest.fn() } as never,
      );

      await service.complete('run-1', {
        status: 'SUCCEEDED',
        metrics: { cv_r2_mean: 0.9 },
        splitSpec: {
          method: 'cv_expanding',
          n_splits: 3,
          source_rows: 100,
          labelled_rows: 90,
          distinct_labelled_values: 30,
          folds: [],
        },
        uploaded: ['model.joblib', 'cv_folds.json'],
      } as never);

      const [updateCall] = prisma.modelTrainingRun.update.mock.calls;
      expect(updateCall[0].data.cvFoldsKey).toBe(
        'drafts/draft-1/runs/run-1/cv_folds.json',
      );

      // A non-CV run (cv_folds.json never uploaded) gets null — the same
      // null-means-not-applicable discipline lossHistoryKey uses.
      const prisma2 = makePrisma();
      const service2 = new ModelRunAuthorizedService(
        prisma2 as never,
        { advanceJobForRun: jest.fn() } as never,
      );
      await service2.complete('run-1', {
        status: 'SUCCEEDED',
        uploaded: ['model.joblib'],
      } as never);
      const [updateCall2] = prisma2.modelTrainingRun.update.mock.calls;
      expect(updateCall2[0].data.cvFoldsKey).toBeNull();
    });

    it('MODEL-FLOW-007 regression guard: once modelId is set, resolveRunOwner flips to models/{modelId}/... — a key nothing was ever written to under pointer-only adoption', async () => {
      // Save Model (MODEL-FLOW-007) sets modelId on the winning run WITHOUT
      // moving its bytes — they stay under drafts/{modelDraftId}/runs/... —
      // relying on claim()/mintUploadUrls()/complete() never being called
      // again for a run once it is terminal (Save only ever adopts a
      // SUCCEEDED run). This test pins exactly what complete() WOULD compute
      // if that invariant were ever broken: models/{modelId}/..., not the
      // drafts/{modelDraftId}/... prefix the bytes actually live under. If
      // this assertion ever needs to change, the change is touching the
      // exact risk this comment names — read model-run.authorized.service.ts's
      // own resolveRunOwner doc comment first.
      const prisma = makePrisma({
        run: { modelId: 'model-1', modelDraftId: 'draft-1' },
      });
      const service = new ModelRunAuthorizedService(
        prisma as never,
        { advanceJobForRun: jest.fn() } as never,
      );

      await service.complete('run-1', {
        status: 'SUCCEEDED',
        uploaded: ['model.joblib'],
      } as never);

      const [updateCall] = prisma.modelTrainingRun.update.mock.calls;
      expect(updateCall[0].data.modelKey).toBe(
        'models/model-1/runs/run-1/model.joblib',
      );
    });
  });
});
