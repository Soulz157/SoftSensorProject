import { InferenceWindowAuthorizedService } from './inference-window.authorized.service';
import { presignInferenceWindowObject } from '@/lib/python-preprocess-client';

jest.mock('@/lib/python-preprocess-client');

afterEach(() => {
  jest.clearAllMocks();
});

const user = { id: 'user-1', role: 'ADMIN' } as unknown as Auth.UserPayload;

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    model: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'model-1', workspaceId: 'ws-1', data: {} }),
      update: jest.fn().mockResolvedValue({}),
    },
    // MODEL-SERVE-006-T12. putScheduleService's stampDeployed reads the
    // acting user's name on the OFF -> ON transition.
    user: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ firstName: 'Ada', lastName: 'Lovelace' }),
    },
    workspace: { findFirst: jest.fn().mockResolvedValue({ id: 'ws-1' }) },
    workspaceMember: { findFirst: jest.fn().mockResolvedValue(null) },
    modelVersion: {
      findFirst: jest.fn().mockResolvedValue(null),
      findFirstOrThrow: jest.fn(),
    },
    dataset: { findUnique: jest.fn().mockResolvedValue(null) },
    inferenceSchedule: {
      upsert: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    inferenceWindow: {
      findUniqueOrThrow: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    ...overrides,
  };
}

function buildDescriptor(overrides: Record<string, unknown> = {}) {
  return {
    getDescriptorByVersionIdService: jest.fn().mockResolvedValue({
      data: {
        derivedFromTarget: [],
        targetScaled: false,
        featureColumns: ['a', 'b'],
        modelId: 'model-1',
        versionId: 'version-1',
        modelUrl: 'https://example/model.joblib',
        modelChecksum: 'checksum',
        scalers: {},
        scalingParams: {},
      },
    }),
    ...overrides,
  };
}

function makeService(
  prisma: ReturnType<typeof buildPrisma>,
  descriptor: ReturnType<typeof buildDescriptor> = buildDescriptor(),
) {
  return new InferenceWindowAuthorizedService(
    prisma as unknown as ConstructorParameters<
      typeof InferenceWindowAuthorizedService
    >[0],
    descriptor as unknown as ConstructorParameters<
      typeof InferenceWindowAuthorizedService
    >[1],
  );
}

describe('InferenceWindowAuthorizedService.putScheduleService — D5 enable-time refusals (MODEL-SERVE-006-T09)', () => {
  it('refuses when the model has no PRODUCTION version', async () => {
    const prisma = buildPrisma();
    const service = makeService(prisma);
    await expect(
      service.putScheduleService('model-1', { enabled: true }, user),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('refuses when the model derives a feature from the target', async () => {
    const prisma = buildPrisma({
      modelVersion: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'version-1', sourceDatasetId: 'ds-1' }),
      },
    });
    const descriptor = buildDescriptor({
      getDescriptorByVersionIdService: jest.fn().mockResolvedValue({
        data: {
          derivedFromTarget: ['S204FBP.lab'],
          targetScaled: false,
          featureColumns: ['a', 'b'],
        },
      }),
    });
    const service = makeService(prisma, descriptor);
    await expect(
      service.putScheduleService('model-1', { enabled: true }, user),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('refuses when the target is scaled with no recorded inverse transform', async () => {
    const prisma = buildPrisma({
      modelVersion: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'version-1', sourceDatasetId: 'ds-1' }),
      },
    });
    const descriptor = buildDescriptor({
      getDescriptorByVersionIdService: jest.fn().mockResolvedValue({
        data: {
          derivedFromTarget: [],
          targetScaled: true,
          featureColumns: ['a'],
        },
      }),
    });
    const service = makeService(prisma, descriptor);
    await expect(
      service.putScheduleService('model-1', { enabled: true }, user),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('refuses when no feature_columns are recorded', async () => {
    const prisma = buildPrisma({
      modelVersion: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'version-1', sourceDatasetId: 'ds-1' }),
      },
    });
    const descriptor = buildDescriptor({
      getDescriptorByVersionIdService: jest.fn().mockResolvedValue({
        data: {
          derivedFromTarget: [],
          targetScaled: false,
          featureColumns: [],
        },
      }),
    });
    const service = makeService(prisma, descriptor);
    await expect(
      service.putScheduleService('model-1', { enabled: true }, user),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('requires an explicit sourceId when the dataset has more than one source (D8)', async () => {
    const prisma = buildPrisma({
      modelVersion: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'version-1', sourceDatasetId: 'ds-1' }),
      },
      dataset: {
        findUnique: jest.fn().mockResolvedValue({
          sourceIds: ['src-a', 'src-b'],
          pipelineConfig: { sourceFetchConfigs: {}, baseTags: [] },
        }),
      },
    });
    const service = makeService(prisma);
    await expect(
      service.putScheduleService('model-1', { enabled: true }, user),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('enables successfully when every guard passes, snapshotting fetchConfig', async () => {
    const prisma = buildPrisma({
      modelVersion: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'version-1', sourceDatasetId: 'ds-1' }),
      },
      dataset: {
        findUnique: jest.fn().mockResolvedValue({
          sourceIds: ['src-a'],
          pipelineConfig: {
            sourceFetchConfigs: { 'src-a': { intervalTime: '1m' } },
            baseTags: ['tag1'],
          },
        }),
      },
    });
    const service = makeService(prisma);
    const result = await service.putScheduleService(
      'model-1',
      { enabled: true },
      user,
    );
    expect(result.statusCode).toBe(200);
    expect(prisma.inferenceSchedule.upsert).toHaveBeenCalledTimes(1);
    const call = prisma.inferenceSchedule.upsert.mock.calls[0][0];
    expect(call.create.sourceId).toBe('src-a');
    expect(call.create.fetchConfig).toEqual({
      intervalTime: '1m',
      baseTags: ['tag1'],
    });
  });

  it('stamps deployedAt/deployedBy on a fresh OFF -> ON enable', async () => {
    const prisma = buildPrisma({
      modelVersion: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'version-1', sourceDatasetId: 'ds-1' }),
      },
      dataset: {
        findUnique: jest.fn().mockResolvedValue({
          sourceIds: ['src-a'],
          pipelineConfig: {
            sourceFetchConfigs: { 'src-a': { intervalTime: '1m' } },
            baseTags: [],
          },
        }),
      },
    });
    const service = makeService(prisma);
    await service.putScheduleService('model-1', { enabled: true }, user);

    expect(prisma.model.update).toHaveBeenCalledTimes(1);
    const stampCall = prisma.model.update.mock.calls[0][0];
    expect(stampCall.data.data.deployedBy).toBe('Ada Lovelace');
    expect(typeof stampCall.data.data.deployedAt).toBe('string');
  });

  it('does NOT re-stamp deployedAt on a settings-only update while already enabled', async () => {
    const prisma = buildPrisma({
      modelVersion: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'version-1', sourceDatasetId: 'ds-1' }),
      },
      dataset: {
        findUnique: jest.fn().mockResolvedValue({
          sourceIds: ['src-a'],
          pipelineConfig: {
            sourceFetchConfigs: { 'src-a': { intervalTime: '1m' } },
            baseTags: [],
          },
        }),
      },
      inferenceSchedule: {
        upsert: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        // Already enabled — this is a settings tweak, not a first enable.
        findUnique: jest.fn().mockResolvedValue({
          enabled: true,
          autoRetrain: false,
          warnSd: 1.5,
          criticalSd: 3.0,
          driftMonitor: false,
          driftThresholdPct: 10,
        }),
      },
    });
    const service = makeService(prisma);
    await service.putScheduleService(
      'model-1',
      { enabled: true, driftMonitor: true },
      user,
    );
    expect(prisma.model.update).not.toHaveBeenCalled();
  });

  it('rejects a partial update that would put warnSd >= the row’s existing criticalSd (D9-adjacent server-side re-check)', async () => {
    const prisma = buildPrisma({
      modelVersion: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'version-1', sourceDatasetId: 'ds-1' }),
      },
      dataset: {
        findUnique: jest.fn().mockResolvedValue({
          sourceIds: ['src-a'],
          pipelineConfig: {
            sourceFetchConfigs: { 'src-a': { intervalTime: '1m' } },
            baseTags: [],
          },
        }),
      },
      inferenceSchedule: {
        upsert: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue({
          enabled: true,
          autoRetrain: false,
          warnSd: 1.5,
          criticalSd: 3.0,
          driftMonitor: false,
          driftThresholdPct: 10,
        }),
      },
    });
    const service = makeService(prisma);
    // Sends only warnSd — the DTO's own refine cannot see this violates
    // the EXISTING criticalSd (3.0), only the service-side re-check can.
    await expect(
      service.putScheduleService('model-1', { enabled: true, warnSd: 5 }, user),
    ).rejects.toMatchObject({ statusCode: 422 });
    expect(prisma.inferenceSchedule.upsert).not.toHaveBeenCalled();
  });

  it('disables without touching the descriptor at all', async () => {
    const prisma = buildPrisma();
    const descriptor = buildDescriptor();
    const service = makeService(prisma, descriptor);
    const result = await service.putScheduleService(
      'model-1',
      { enabled: false },
      user,
    );
    expect(result.statusCode).toBe(200);
    expect(prisma.inferenceSchedule.updateMany).toHaveBeenCalledWith({
      where: { modelId: 'model-1' },
      data: { enabled: false },
    });
    expect(descriptor.getDescriptorByVersionIdService).not.toHaveBeenCalled();
  });
});

describe('InferenceWindowAuthorizedService.completeService — server-built keys (MODEL-SERVE-006-T06)', () => {
  it('builds predictionsKey server-side, never trusting the container body', async () => {
    const prisma = buildPrisma({
      inferenceWindow: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'w1',
          modelId: 'model-1',
          modelVersionId: 'version-1',
          windowStart: new Date('2026-09-10T08:00:00.000Z'),
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    });
    const service = makeService(prisma);
    await service.completeService('w1', {
      status: 'SUCCEEDED',
      rowCount: 59,
      outputChecksum: 'abc',
      uploaded: ['predictions.parquet', 'metrics.json'],
    } as never);

    const call = prisma.inferenceWindow.update.mock.calls[0][0];
    expect(call.data.predictionsKey).toBe(
      'inference/model-1/version-1/dt=2026-09-10/hour=08/predictions.parquet',
    );
    expect(call.data.metricsKey).toBe(
      'inference/model-1/version-1/dt=2026-09-10/hour=08/metrics.json',
    );
    expect(call.data.status).toBe('SUCCEEDED');
  });

  it('omits metricsKey when metrics.json was not among the uploaded filenames', async () => {
    const prisma = buildPrisma({
      inferenceWindow: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'w1',
          modelId: 'model-1',
          modelVersionId: 'version-1',
          windowStart: new Date('2026-09-10T08:00:00.000Z'),
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    });
    const service = makeService(prisma);
    await service.completeService('w1', {
      status: 'SUCCEEDED',
      rowCount: 59,
      outputChecksum: 'abc',
      uploaded: ['predictions.parquet'],
    } as never);
    const call = prisma.inferenceWindow.update.mock.calls[0][0];
    expect(call.data.metricsKey).toBeNull();
  });

  it('records FAILED with the reason, never touching predictionsKey', async () => {
    const prisma = buildPrisma({
      inferenceWindow: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'w1',
          modelId: 'model-1',
          modelVersionId: 'version-1',
          windowStart: new Date('2026-09-10T08:00:00.000Z'),
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    });
    const service = makeService(prisma);
    await service.completeService('w1', {
      status: 'FAILED',
      failureReason: 'boom',
    } as never);
    const call = prisma.inferenceWindow.update.mock.calls[0][0];
    expect(call.data.status).toBe('FAILED');
    expect(call.data.failureReason).toBe('boom');
    expect(call.data.predictionsKey).toBeUndefined();
  });
});

describe('InferenceWindowAuthorizedService.claimService', () => {
  it('refuses to claim before the window has a materialized input', async () => {
    const prisma = buildPrisma({
      inferenceWindow: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ id: 'w1', inputKey: null, inputChecksum: null }),
      },
    });
    const service = makeService(prisma);
    await expect(service.claimService('w1')).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(presignInferenceWindowObject).not.toHaveBeenCalled();
  });
});
