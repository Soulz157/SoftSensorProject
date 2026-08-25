import { ModelRunAuthorizedService } from './model-run.authorized.service';
import * as pythonClient from '@/lib/python-preprocess-client';

jest.mock('@/lib/python-preprocess-client');

const mockedPresignArtifact = pythonClient.presignArtifact as jest.Mock;
const mockedReplayHoldoutForRun = pythonClient.replayHoldoutForRun as jest.Mock;

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
      mockedPresignArtifact
        .mockResolvedValueOnce({
          data_url: 'https://minio.example/gold-signed',
          sidecar_urls: {
            'feature_spec.json': 'https://minio.example/spec-signed',
          },
          checksum: 'gold-checksum',
          row_count: 100,
          expires_at: '2026-01-01T00:00:00Z',
        })
        .mockResolvedValueOnce({
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
      mockedPresignArtifact
        .mockResolvedValueOnce({
          data_url: 'https://minio.example/gold-signed',
          sidecar_urls: {
            'feature_spec.json': 'https://minio.example/spec-signed',
          },
          checksum: 'gold-checksum',
          row_count: 100,
          expires_at: '2026-01-01T00:00:00Z',
        })
        .mockResolvedValueOnce({
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
  });
});
