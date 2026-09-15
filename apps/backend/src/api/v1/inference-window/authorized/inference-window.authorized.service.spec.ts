import { InferenceWindowAuthorizedService } from './inference-window.authorized.service';
import {
  inferenceWindowTruthSeries,
  presignInferenceWindowObject,
} from '@/lib/python-preprocess-client';

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

/** MODEL-SERVE-005-T03. The truth sweeper is injected only for the
 *  re-join route; every case in this file exercises schedule/window paths
 *  that never reach it, so a bare stub is the honest double. */
function buildTruthSweeper(overrides = {}) {
  return { joinWindow: jest.fn().mockResolvedValue(undefined), ...overrides };
}

function makeService(
  prisma: ReturnType<typeof buildPrisma>,
  descriptor: ReturnType<typeof buildDescriptor> = buildDescriptor(),
  truthSweeper: ReturnType<typeof buildTruthSweeper> = buildTruthSweeper(),
) {
  return new InferenceWindowAuthorizedService(
    prisma as unknown as ConstructorParameters<
      typeof InferenceWindowAuthorizedService
    >[0],
    descriptor as unknown as ConstructorParameters<
      typeof InferenceWindowAuthorizedService
    >[1],
    truthSweeper as unknown as ConstructorParameters<
      typeof InferenceWindowAuthorizedService
    >[2],
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
    // MODEL-SERVE-001-T14. A 1-minute interval at the default 60-minute
    // cadence reproduces env.INFERENCE_MIN_ROWS's OWN derivation exactly
    // (30) — the case this task must not disturb.
    expect(call.create.minRows).toBe(30);
    expect(result.data?.minRows).toBe(30);
  });

  // ── MODEL-SERVE-001-T14 ──────────────────────────────────────────────────

  it('derives a SMALLER per-schedule minRows for a non-1-minute PI interval', async () => {
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
            // 60-minute cadence (the DTO's own default) / 5-minute interval
            // = 12 rows in a complete window; half of that is 6 — NOT the
            // global 30 this schedule would have been evaluated against
            // before this task, which is the whole defect T14 exists to fix.
            sourceFetchConfigs: { 'src-a': { intervalTime: '5m' } },
            baseTags: [],
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
    const call = prisma.inferenceSchedule.upsert.mock.calls[0][0];
    expect(call.create.minRows).toBe(6);
    expect(result.data?.minRows).toBe(6);
  });

  it('falls back to env.INFERENCE_MIN_ROWS for a source with no interval concept (e.g. SQL)', async () => {
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
            // SQLConfig carries no `intervalTime` field at all — never a
            // fabricated per-schedule number derived from a guess.
            sourceFetchConfigs: {
              'src-a': { type: 'sql', connectionString: 'x', query: 'y' },
            },
            baseTags: [],
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
    const call = prisma.inferenceSchedule.upsert.mock.calls[0][0];
    expect(call.create.minRows).toBe(30);
    expect(result.data?.minRows).toBe(30);
  });

  it('recomputes minRows unconditionally on a settings-only update, unlike cadenceMinutes/lagMinutes', async () => {
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
            sourceFetchConfigs: { 'src-a': { intervalTime: '5m' } },
            baseTags: [],
          },
        }),
      },
      inferenceSchedule: {
        upsert: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        // Already enabled at the OLD, global-constant floor — as every
        // schedule created before this task would be.
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
    // A settings-only tweak that names neither cadenceMinutes nor minRows.
    await service.putScheduleService(
      'model-1',
      { enabled: true, driftMonitor: true },
      user,
    );
    const call = prisma.inferenceSchedule.upsert.mock.calls[0][0];
    // cadenceMinutes/lagMinutes are conditionally omitted from `update`
    // when the DTO does not send them (existing MERGE behaviour) — minRows
    // must NOT follow that pattern, since it tracks the CURRENT
    // fetchConfig, which this call resolved fresh regardless.
    expect(call.update.cadenceMinutes).toBeUndefined();
    expect(call.update.minRows).toBe(6);
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

describe('InferenceWindowAuthorizedService.getStatusService — reason surfacing (MODEL-SERVE-001-T09)', () => {
  const NOW = new Date('2026-09-14T12:00:00.000Z');
  const OLDER = new Date('2026-09-14T10:00:00.000Z');

  function statusPrisma(overrides: {
    failed?: { windowStart: Date; failureReason: string | null } | null;
    skipped?: { windowStart: Date; failureReason: string | null } | null;
  }) {
    return buildPrisma({
      inferenceSchedule: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ enabled: true, cadenceMinutes: 60 }),
      },
      inferenceWindow: {
        findFirst: jest
          .fn()
          .mockImplementation(({ where }: { where: { status: unknown } }) => {
            if (where.status === 'FAILED') {
              return Promise.resolve(overrides.failed ?? null);
            }
            if (where.status === 'SKIPPED') {
              return Promise.resolve(overrides.skipped ?? null);
            }
            // The `in: [...]` reads (lastSucceeded/lastTerminal) — no
            // successful history in any of these fixtures.
            return Promise.resolve(null);
          }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    });
  }

  it('surfaces the latest FAILED reason, redacted, never the SKIPPED one', async () => {
    const prisma = statusPrisma({
      failed: {
        windowStart: NOW,
        failureReason:
          'Materialize failed: 404 for url: https://minio.local/gold/x?X-Amz-Signature=abc',
      },
      skipped: {
        windowStart: OLDER,
        failureReason: 'Only 5 usable row(s), below INFERENCE_MIN_ROWS (30).',
      },
    });
    const service = makeService(prisma);

    const result = await service.getStatusService('model-1', user);

    expect(result.data.lastFailure).toEqual({
      windowStart: NOW,
      reason: 'Materialize failed: 404 for url: [redacted url]',
    });
    expect(result.data.lastSkipped).toEqual({
      windowStart: OLDER,
      reason: 'Only 5 usable row(s), below INFERENCE_MIN_ROWS (30).',
    });
  });

  it('reports both as null when neither a FAILED nor a SKIPPED window exists', async () => {
    const prisma = statusPrisma({ failed: null, skipped: null });
    const service = makeService(prisma);

    const result = await service.getStatusService('model-1', user);

    expect(result.data.lastFailure).toBeNull();
    expect(result.data.lastSkipped).toBeNull();
  });

  it('a SKIPPED window never populates lastFailure', async () => {
    const prisma = statusPrisma({
      failed: null,
      skipped: { windowStart: OLDER, failureReason: 'below threshold' },
    });
    const service = makeService(prisma);

    const result = await service.getStatusService('model-1', user);

    expect(result.data.lastFailure).toBeNull();
    expect(result.data.lastSkipped?.reason).toBe('below threshold');
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

/**
 * MODEL-SERVE-005-T03. The read side of the ground-truth join.
 *
 * These cover the refusals the live verification never touched: it drove
 * python and Prisma directly and never entered this service, so the
 * version-grouping rule — the one that decides whether a published RMSE is
 * a number about anything — had no test at any level.
 */
const RANGE = {
  from: '2026-09-14T00:00:00.000Z',
  to: '2026-09-15T00:00:00.000Z',
};

/** One truth row. Sums default to a single pair with residual +1 against an
 *  actual of 40, so a fixture states its pairs rather than six raw numbers. */
function truthRow(overrides: Record<string, unknown> = {}) {
  return {
    windowStart: new Date('2026-09-14T08:00:00.000Z'),
    modelVersionId: 'version-1',
    targetColumn: 'S204FBP.lab',
    pairsKey: 'inference/model-1/version-1/dt=2026-09-14/hour=15/truth.parquet',
    truthRows: 1,
    pairedRows: 1,
    joinedThrough: new Date('2026-09-14T09:00:00.000Z'),
    failureReason: null,
    n: 1,
    sumSe: 1,
    sumAe: 1,
    sumSigned: 1,
    sumActual: 40,
    sumActualSq: 1600,
    window: { missingPct: 0.1 },
    ...overrides,
  };
}

/** `dueWindows` is what `rejoinTruthService` enumerates; `rows` is what
 *  `getTruthService` reads. Both are supplied up front rather than patched
 *  onto the double afterwards, so the stub keeps its declared shape. */
function buildTruthPrisma(
  rows: Array<ReturnType<typeof truthRow>>,
  windowsInRange = rows.length,
  dueWindows: Array<{ id: string }> = [],
  // T11: getTruthService now issues a SECOND, distinct `count` — the fourth
  // empty cause (SKIPPED windows the SUCCEEDED-only windowsInRange count
  // cannot see). Keyed by `where.status`, same discipline `statusPrisma`
  // above already applies to its own dual-branch `findFirst` mock, so the
  // two counts can differ instead of silently sharing one value.
  windowsSkipped = 0,
) {
  return buildPrisma({
    inferenceWindowTruth: { findMany: jest.fn().mockResolvedValue(rows) },
    inferenceWindow: {
      findUniqueOrThrow: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      count: jest
        .fn()
        .mockImplementation(({ where }: { where: { status: unknown } }) =>
          Promise.resolve(
            where.status === 'SKIPPED' ? windowsSkipped : windowsInRange,
          ),
        ),
      findMany: jest.fn().mockResolvedValue(dueWindows),
    },
  });
}

describe('InferenceWindowAuthorizedService.getTruthService (MODEL-SERVE-005-T03)', () => {
  beforeEach(() => {
    jest
      .mocked(inferenceWindowTruthSeries)
      .mockResolvedValue({ points: [], truncated: false });
  });

  it('publishes pooled metrics when the range speaks with ONE version', async () => {
    const service = makeService(
      buildTruthPrisma([
        truthRow(),
        truthRow({
          windowStart: new Date('2026-09-14T09:00:00.000Z'),
          n: 1,
          sumSe: 4,
          sumAe: 2,
          sumSigned: -2,
          sumActual: 44,
          sumActualSq: 1936,
        }),
      ]),
    );

    const res = await service.getTruthService('model-1', RANGE, user);

    expect(res.data.mixedVersions).toBe(false);
    expect(res.data.versions).toHaveLength(1);
    // Pooled over both windows: n = 2, sumSe = 5 -> RMSE = sqrt(2.5).
    expect(res.data.metrics!.n).toBe(2);
    expect(res.data.metrics!.rmse).toBeCloseTo(Math.sqrt(2.5), 10);
    expect(res.data.metrics!.bias).toBeCloseTo(-0.5, 10);
  });

  /** The case the whole grouping rule exists for. MODEL-SERVE-006-T07
   *  deliberately allows two versions to score one windowStart, and each
   *  version's target is resolved through its OWN sourceRun — so two
   *  versions in one range can carry different targets, and a single
   *  pooled RMSE over them would be a number about nothing. */
  it('REFUSES a single metric when two versions are in range', async () => {
    const service = makeService(
      buildTruthPrisma([
        truthRow(),
        truthRow({
          modelVersionId: 'version-2',
          targetColumn: 'S301OUT.lab',
          n: 2,
          sumSe: 8,
          sumAe: 4,
          sumSigned: 4,
          sumActual: 100,
          sumActualSq: 5008,
        }),
      ]),
    );

    const res = await service.getTruthService('model-1', RANGE, user);

    expect(res.data.metrics).toBeNull();
    expect(res.data.mixedVersions).toBe(true);
    expect(res.data.versions).toHaveLength(2);
    // Each group keeps its own target, so a caller can say which is which
    // instead of being handed one unlabelled figure.
    expect(res.data.versions.map((v) => v.targetColumn).sort()).toEqual([
      'S204FBP.lab',
      'S301OUT.lab',
    ]);
    expect(res.data.versions.every((v) => v.metrics !== null)).toBe(true);
  });

  it('reports NO error — not zero — when nothing has joined yet', async () => {
    const service = makeService(buildTruthPrisma([], 5));

    const res = await service.getTruthService('model-1', RANGE, user);

    expect(res.data.metrics).toBeNull();
    expect(res.data.versions).toHaveLength(0);
    expect(res.data.coverage.windowsInRange).toBe(5);
    expect(res.data.coverage.windowsJoined).toBe(0);
    expect(res.data.coverage.windowsAwaitingTruth).toBe(5);
  });

  /**
   * T11. `windowsInRange` counts SUCCEEDED only, so an all-SKIPPED range
   * read as "no completed windows" — identical to "the scheduler never ran
   * here" — even though it ran, fetched, and deliberately declined to
   * score. `windowsSkipped` is the fact that lets a caller tell the two
   * apart; it must be independent of, not derived from, windowsInRange.
   */
  it('reports windowsSkipped independently of windowsInRange (the fourth empty cause)', async () => {
    const service = makeService(buildTruthPrisma([], 0, [], 3));

    const res = await service.getTruthService('model-1', RANGE, user);

    expect(res.data.coverage.windowsInRange).toBe(0);
    expect(res.data.coverage.windowsSkipped).toBe(3);
  });

  /** A failure row exists to stop the sweeper starving on an unjoinable
   *  window. It must never reach a metric, and must stay distinguishable
   *  from a window the lab simply has not reported on. */
  it('excludes a FAILED join from metrics but counts it as failed', async () => {
    const service = makeService(
      buildTruthPrisma(
        [
          truthRow(),
          truthRow({
            windowStart: new Date('2026-09-14T10:00:00.000Z'),
            targetColumn: null,
            pairsKey: null,
            truthRows: 0,
            pairedRows: 0,
            n: 0,
            sumSe: 0,
            sumAe: 0,
            sumSigned: 0,
            sumActual: 0,
            sumActualSq: 0,
            failureReason: 'ModelVersion version-1 has no target column',
          }),
        ],
        2,
      ),
    );

    const res = await service.getTruthService('model-1', RANGE, user);

    // The zeros of the failure row do not dilute the real pair.
    expect(res.data.metrics!.n).toBe(1);
    expect(res.data.metrics!.rmse).toBeCloseTo(1, 10);
    expect(res.data.coverage.windowsJoined).toBe(1);
    expect(res.data.coverage.windowsFailed).toBe(1);
    // Disjoint: the failed window is NOT also counted as awaiting the lab,
    // or the two chips in the coverage strip would contradict each other.
    expect(res.data.coverage.windowsAwaitingTruth).toBe(0);
    expect(
      res.data.windows.find((w) => w.failureReason !== null),
    ).toBeDefined();
  });

  it('surfaces the target even when no window has joined anything', async () => {
    const service = makeService(
      buildTruthPrisma([
        truthRow({
          truthRows: 0,
          pairedRows: 0,
          pairsKey: null,
          n: 0,
          sumSe: 0,
          sumAe: 0,
          sumSigned: 0,
          sumActual: 0,
          sumActualSq: 0,
        }),
      ]),
    );

    const res = await service.getTruthService('model-1', RANGE, user);

    expect(res.data.metrics).toBeNull();
    // Knowable before any truth arrives, so the UI keeps its target label
    // rather than losing it while waiting for the first lab sample.
    expect(res.data.targetColumn).toBe('S204FBP.lab');
  });

  /** MODEL-SERVE-006-T05's stated reason for missingPct is telling real
   *  drift apart from a sensor that stopped reporting. A mean would hide
   *  the one catastrophic window that is exactly that signal. */
  it('reports the MAX missing rate, never a mean', async () => {
    const service = makeService(
      buildTruthPrisma([
        truthRow({ window: { missingPct: 0.02 } }),
        truthRow({
          windowStart: new Date('2026-09-14T09:00:00.000Z'),
          window: { missingPct: 0.91 },
        }),
      ]),
    );

    const res = await service.getTruthService('model-1', RANGE, user);

    expect(res.data.coverage.maxMissingPct).toBeCloseTo(0.91, 10);
  });

  it('keeps metrics and coverage when the pairs objects cannot be read', async () => {
    jest
      .mocked(inferenceWindowTruthSeries)
      .mockRejectedValue(new Error('object store unreachable'));
    const service = makeService(buildTruthPrisma([truthRow()]));

    const res = await service.getTruthService('model-1', RANGE, user);

    // The chart loses its points; the numbers from Postgres are still true.
    expect(res.data.points).toEqual([]);
    expect(res.data.metrics!.n).toBe(1);
    expect(res.data.coverage.windowsJoined).toBe(1);
  });
});

describe('InferenceWindowAuthorizedService.rejoinTruthService (MODEL-SERVE-005-T03)', () => {
  it('drives the SAME sweeper path, once per window in range', async () => {
    const prisma = buildTruthPrisma([], 0, [
      { id: 'window-1' },
      { id: 'window-2' },
    ]);
    const sweeper = buildTruthSweeper();
    const service = makeService(prisma, buildDescriptor(), sweeper);

    const res = await service.rejoinTruthService('model-1', RANGE, user);

    expect(sweeper.joinWindow).toHaveBeenCalledTimes(2);
    expect(res.data).toMatchObject({ requested: 2, rejoined: 2, failed: 0 });
  });

  it('reports a failed window instead of abandoning the rest of the range', async () => {
    const prisma = buildTruthPrisma([], 0, [
      { id: 'window-1' },
      { id: 'window-2' },
    ]);
    const sweeper = buildTruthSweeper({
      joinWindow: jest
        .fn()
        .mockRejectedValueOnce(new Error('source unreachable'))
        .mockResolvedValueOnce(undefined),
    });
    const service = makeService(prisma, buildDescriptor(), sweeper);

    const res = await service.rejoinTruthService('model-1', RANGE, user);

    expect(res.data.rejoined).toBe(1);
    expect(res.data.failed).toBe(1);
    expect(res.data.failures[0]).toContain('source unreachable');
  });
});

// ── MODEL-SERVE-001-T10 ────────────────────────────────────────────────────

/** The exact shape `train.py`'s top-level handler produces when
 *  `download_verified` fails against a presigned object URL: `requests`
 *  embeds the whole URL, query string included, in the HTTPError text. */
const PRESIGNED_FAILURE =
  '404 Client Error: Not Found for url: ' +
  'https://minio:9000/artifacts/model.joblib' +
  '?X-Amz-Credential=AKIAEXAMPLE%2F20260914%2Fus-east-1' +
  '&X-Amz-Signature=deadbeefcafe';

const WINDOW_ROW = {
  id: 'window-1',
  status: 'FAILED',
  windowStart: new Date('2026-09-14T10:00:00.000Z'),
  windowEnd: new Date('2026-09-14T11:00:00.000Z'),
  inputRows: 60,
  missingPct: 0,
  imageDigest: 'sha256:abc',
  containerId: null as string | null,
  failureReason: null as string | null,
  attempts: 1,
  startedAt: null,
  finishedAt: null,
};

interface LogLine {
  id: string;
  level: string;
  message: string;
  createdAt: Date;
}

/** Returns the mock handles alongside the double: asserting through
 *  `prisma.inferenceWindow.findFirst.mock` would reach through an untyped
 *  index signature, which is what `no-unsafe-member-access` is for. */
function buildLogPrisma(
  logs: LogLine[],
  windowOverrides: Record<string, unknown> = {},
  prismaOverrides: Record<string, unknown> = {},
) {
  const windowFindFirst = jest
    .fn()
    .mockResolvedValue({ ...WINDOW_ROW, ...windowOverrides });
  // The service reads newest-first; the double must behave that way too or
  // the reverse-for-display assertion below proves nothing.
  const logFindMany = jest
    .fn()
    .mockImplementation(({ take }: { take: number }) => {
      const newestFirst = [...logs].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
      );
      return Promise.resolve(newestFirst.slice(0, take));
    });
  const logCount = jest.fn().mockResolvedValue(logs.length);

  // `windowProvenance` reads the version/promoter behind the window and the
  // model's own deploy stamp — B3 items (1) and (2).
  const windowFindUnique = jest.fn().mockResolvedValue({
    modelVersion: {
      version: 3,
      stage: 'PRODUCTION',
      promotedAt: new Date('2026-09-13T08:00:00.000Z'),
      promotionOverride: null,
      promotedBy: { firstName: 'Ada', lastName: 'Lovelace' },
    },
  });

  const prisma = buildPrisma({
    inferenceWindow: {
      findFirst: windowFindFirst,
      findUnique: windowFindUnique,
      findUniqueOrThrow: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    inferenceWindowLog: { findMany: logFindMany, count: logCount },
    ...prismaOverrides,
  });

  return { prisma, windowFindFirst, windowFindUnique, logFindMany, logCount };
}

interface WindowFindFirstArgs {
  where: unknown;
  orderBy: unknown;
  select: Record<string, unknown>;
}

/** `mock.calls[0]` is `any`; narrowing the whole array once keeps every
 *  assertion below type-safe without an eslint-disable. */
function firstCallArgs(mock: jest.Mock): WindowFindFirstArgs {
  const calls = mock.mock.calls as Array<[WindowFindFirstArgs]>;
  return calls[0][0];
}

function line(n: number, message = `line ${n}`, level = 'info'): LogLine {
  return {
    id: `log-${n}`,
    level,
    message,
    createdAt: new Date(Date.UTC(2026, 8, 14, 10, 0, n)),
  };
}

describe('InferenceWindowAuthorizedService.listLogsService — redaction (MODEL-SERVE-001-T10)', () => {
  it('strips a presigned URL out of a container log line', async () => {
    const { prisma } = buildLogPrisma([line(1, PRESIGNED_FAILURE, 'error')]);
    const service = makeService(prisma);

    const res = await service.listLogsService('model-1', 'window-1', user);

    expect(res.data.lines[0].message).not.toContain('X-Amz-Signature');
    expect(res.data.lines[0].message).not.toContain('https://');
    expect(res.data.lines[0].message).toContain('[redacted url]');
  });

  it('strips a presigned URL out of the window failureReason too', async () => {
    // train.py passes ONE str(err) to _api.log AND _api.report_failure, so
    // closing only the log sink would leave the same credential on the row.
    const { prisma } = buildLogPrisma([], {
      failureReason: PRESIGNED_FAILURE,
    });
    const service = makeService(prisma);

    const res = await service.listLogsService('model-1', 'window-1', user);

    expect(res.data.window.failureReason).not.toContain('X-Amz-Signature');
    expect(res.data.window.failureReason).toContain('[redacted url]');
  });

  it('leaves a failureReason that carries no URL untouched', async () => {
    const { prisma } = buildLogPrisma([], {
      failureReason: 'Input parquet has zero rows — nothing to score.',
    });
    const service = makeService(prisma);

    const res = await service.listLogsService('model-1', 'window-1', user);

    expect(res.data.window.failureReason).toBe(
      'Input parquet has zero rows — nothing to score.',
    );
  });

  it('never returns the window tokenHash', async () => {
    const { prisma, windowFindFirst } = buildLogPrisma([line(1)]);
    const service = makeService(prisma);

    const res = await service.listLogsService('model-1', 'window-1', user);

    expect(res.data.window).not.toHaveProperty('tokenHash');
    expect(firstCallArgs(windowFindFirst).select.tokenHash).toBeUndefined();
  });
});

describe('InferenceWindowAuthorizedService.listLogsService — the cap is taken from the newest end (MODEL-SERVE-001-T10)', () => {
  it('keeps the NEWEST 500 lines, not the first 500, and reports what it dropped', async () => {
    const logs = Array.from({ length: 620 }, (_, i) => line(i + 1));
    const { prisma } = buildLogPrisma(logs);
    const service = makeService(prisma);

    const res = await service.listLogsService('model-1', 'window-1', user);

    expect(res.data.lines).toHaveLength(500);
    expect(res.data.truncated).toBe(true);
    expect(res.data.omittedCount).toBe(120);
    // The tail is where a FAILED window's failure actually is — the whole
    // reason this does not copy the training read's asc + take.
    expect(res.data.lines[499].message).toBe('line 620');
    // ...and it is still oldest-first for display.
    expect(res.data.lines[0].message).toBe('line 121');
  });

  it('reads one row past the cap rather than counting on every request', async () => {
    const { prisma, logFindMany, logCount } = buildLogPrisma([
      line(1),
      line(2),
    ]);
    const service = makeService(prisma);

    await service.listLogsService('model-1', 'window-1', user);

    expect(logFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 501, orderBy: { createdAt: 'desc' } }),
    );
    expect(logCount).not.toHaveBeenCalled();
  });

  it('does not claim truncation at exactly the cap', async () => {
    const logs = Array.from({ length: 500 }, (_, i) => line(i + 1));
    const { prisma } = buildLogPrisma(logs);
    const service = makeService(prisma);

    const res = await service.listLogsService('model-1', 'window-1', user);

    expect(res.data.lines).toHaveLength(500);
    expect(res.data.truncated).toBe(false);
    expect(res.data.omittedCount).toBe(0);
  });
});

describe('InferenceWindowAuthorizedService.listLogsService — one endpoint serves the peek and the tab (MODEL-SERVE-001-T10)', () => {
  it('resolves `latest` to the model’s most recent window', async () => {
    const { prisma, windowFindFirst } = buildLogPrisma([line(1)]);
    const service = makeService(prisma);

    await service.listLogsService('model-1', 'latest', user);

    const args = firstCallArgs(windowFindFirst);
    expect(args.where).toEqual({ modelId: 'model-1' });
    expect(args.orderBy).toEqual({ windowStart: 'desc' });
  });

  it('scopes an explicit window id to the model, so a foreign id cannot be read', async () => {
    const { prisma, windowFindFirst } = buildLogPrisma([line(1)]);
    const service = makeService(prisma);

    await service.listLogsService('model-1', 'window-9', user);

    expect(firstCallArgs(windowFindFirst).where).toEqual({
      id: 'window-9',
      modelId: 'model-1',
    });
  });

  it('says the model has no windows yet, rather than "not found", for `latest`', async () => {
    const { prisma, windowFindFirst } = buildLogPrisma([]);
    windowFindFirst.mockResolvedValue(null);
    const service = makeService(prisma);

    await expect(
      service.listLogsService('model-1', 'latest', user),
    ).rejects.toMatchObject({
      statusCode: 404,
      message: 'This model has no inference windows yet',
    });
  });

  it('404s an unknown explicit window id', async () => {
    const { prisma, windowFindFirst } = buildLogPrisma([]);
    windowFindFirst.mockResolvedValue(null);
    const service = makeService(prisma);

    await expect(
      service.listLogsService('model-1', 'window-9', user),
    ).rejects.toMatchObject({
      statusCode: 404,
      message: 'Inference window not found',
    });
  });

  it('refuses a viewer, before reading any log row', async () => {
    const { prisma, logFindMany } = buildLogPrisma(
      [line(1)],
      {},
      {
        workspace: { findFirst: jest.fn().mockResolvedValue(null) },
        workspaceMember: {
          findFirst: jest.fn().mockResolvedValue({ role: 'VIEWER' }),
        },
      },
    );
    const service = makeService(prisma);

    await expect(
      service.listLogsService('model-1', 'window-1', {
        id: 'user-2',
        role: 'USER',
      } as unknown as Auth.UserPayload),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(logFindMany).not.toHaveBeenCalled();
  });
});

describe('InferenceWindowAuthorizedService.listLogsService — a zero-line window still carries its facts (MODEL-SERVE-001-T10)', () => {
  // A console that shows only stdout cannot explain a window that never
  // spawned a container, which is most of TM2's history. Each of these
  // returns zero lines for a DIFFERENT reason, and the row is what lets the
  // client tell them apart instead of rendering one em dash.
  it.each([
    ['PENDING', null],
    ['SKIPPED', 'Only 3 row(s) in window, below INFERENCE_MIN_ROWS'],
    ['FAILED', 'Materialize failed before the container was spawned'],
    ['RUNNING', null],
  ])(
    'returns the window row for a %s window with no lines',
    async (status, failureReason) => {
      const { prisma } = buildLogPrisma([], { status, failureReason });
      const service = makeService(prisma);

      const res = await service.listLogsService('model-1', 'window-1', user);

      expect(res.data.lines).toEqual([]);
      expect(res.data.truncated).toBe(false);
      expect(res.data.window.status).toBe(status);
      expect(res.data.window.failureReason).toBe(failureReason);
      // imageDigest is null for a window that never ran a container — the
      // client's fourth discriminator.
      expect(res.data.window).toHaveProperty('imageDigest');
    },
  );
});

describe('InferenceWindowAuthorizedService.listLogsService — the span starts at Deploy (MODEL-SERVE-001-T10, B3)', () => {
  it('carries the promote that preceded the window, with its actor', async () => {
    const { prisma } = buildLogPrisma([line(1)]);
    const service = makeService(prisma);

    const res = await service.listLogsService('model-1', 'window-1', user);

    expect(res.data.provenance.version).toBe(3);
    expect(res.data.provenance.stage).toBe('PRODUCTION');
    expect(res.data.provenance.promotedBy).toBe('Ada Lovelace');
  });

  it('carries the schedule enable stamp off Model.data', async () => {
    const { prisma } = buildLogPrisma(
      [line(1)],
      {},
      {
        model: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'model-1',
            workspaceId: 'ws-1',
            data: {
              deployedBy: 'Grace Hopper',
              deployedAt: '2026-09-13T09:00:00.000Z',
            },
          }),
          update: jest.fn().mockResolvedValue({}),
        },
      },
    );
    const service = makeService(prisma);

    const res = await service.listLogsService('model-1', 'window-1', user);

    expect(res.data.provenance.deployedBy).toBe('Grace Hopper');
    expect(res.data.provenance.deployedAt).toBe('2026-09-13T09:00:00.000Z');
  });

  it('surfaces the r2-floor override reason — an override with no trace is no floor', async () => {
    const { prisma, windowFindUnique } = buildLogPrisma([line(1)]);
    windowFindUnique.mockResolvedValue({
      modelVersion: {
        version: 4,
        stage: 'PRODUCTION',
        promotedAt: new Date('2026-09-13T08:00:00.000Z'),
        promotionOverride: {
          actorId: 'user-1',
          actorName: 'Ada Lovelace',
          reason: 'Accepted for a trial run on a quiet unit',
          at: '2026-09-13T08:00:00.000Z',
        },
        promotedBy: { firstName: 'Ada', lastName: 'Lovelace' },
      },
    });
    const service = makeService(prisma);

    const res = await service.listLogsService('model-1', 'window-1', user);

    expect(res.data.provenance.promotionOverrideReason).toBe(
      'Accepted for a trial run on a quiet unit',
    );
  });

  it('redacts a URL pasted into an override reason', async () => {
    const { prisma, windowFindUnique } = buildLogPrisma([line(1)]);
    windowFindUnique.mockResolvedValue({
      modelVersion: {
        version: 4,
        stage: 'PRODUCTION',
        promotedAt: null,
        promotionOverride: { reason: `see ${PRESIGNED_FAILURE}` },
        promotedBy: null,
      },
    });
    const service = makeService(prisma);

    const res = await service.listLogsService('model-1', 'window-1', user);

    expect(res.data.provenance.promotionOverrideReason).not.toContain(
      'X-Amz-Signature',
    );
  });

  it('still returns logs when the deploy stamp and promoter are absent', async () => {
    // A model deployed before the stamp existed, or whose promoter was
    // deleted, must still have readable logs — provenance is soft.
    const { prisma, windowFindUnique } = buildLogPrisma([line(1)]);
    windowFindUnique.mockResolvedValue({
      modelVersion: {
        version: 1,
        stage: 'PRODUCTION',
        promotedAt: null,
        promotionOverride: null,
        promotedBy: null,
      },
    });
    const service = makeService(prisma);

    const res = await service.listLogsService('model-1', 'window-1', user);

    expect(res.data.lines).toHaveLength(1);
    expect(res.data.provenance.deployedBy).toBeNull();
    expect(res.data.provenance.promotedBy).toBeNull();
    expect(res.data.provenance.promotionOverrideReason).toBeNull();
  });
});

describe('InferenceWindowAuthorizedService.listLogsService — containerId is the ran/did-not-run discriminator (MODEL-SERVE-001-T10)', () => {
  // VERIFIED LIVE 2026-09-14 against TM2: 20 of its 50 FAILED windows carry
  // a containerId and a startedAt while imageDigest is STILL NULL. The
  // client splits its FAILED sentence on containerId, so this endpoint has
  // to return it or that distinction is unrenderable.
  it('returns containerId so a spawned-but-silent window is distinguishable', async () => {
    const { prisma } = buildLogPrisma([], {
      status: 'FAILED',
      containerId: 'd4d86b385dd0',
      imageDigest: null,
      startedAt: new Date('2026-09-14T10:01:00.000Z'),
      failureReason:
        'Container d4d86b385dd0 no longer exists — the server restarted while this window was in flight.',
    });
    const service = makeService(prisma);

    const res = await service.listLogsService('model-1', 'window-1', user);

    expect(res.data.lines).toEqual([]);
    expect(res.data.window.containerId).toBe('d4d86b385dd0');
    expect(res.data.window.imageDigest).toBeNull();
  });

  it('returns a null containerId for a window that never spawned one', async () => {
    const { prisma } = buildLogPrisma([], {
      status: 'FAILED',
      containerId: null,
      imageDigest: null,
    });
    const service = makeService(prisma);

    const res = await service.listLogsService('model-1', 'window-1', user);

    expect(res.data.window.containerId).toBeNull();
  });
});
