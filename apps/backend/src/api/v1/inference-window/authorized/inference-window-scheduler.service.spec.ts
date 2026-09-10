import { InferenceWindowSchedulerService } from './inference-window-scheduler.service';
import { materializeInferenceWindow } from '@/lib/python-preprocess-client';
import { env } from '@/config/env.config';

jest.mock('@/lib/python-preprocess-client');
jest.mock('@/lib/crypto', () => ({
  decryptSecret: jest.fn().mockReturnValue('decrypted-secret'),
}));

afterEach(() => {
  jest.clearAllMocks();
});

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    inferenceSchedule: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    inferenceWindow: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
    },
    modelVersion: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUniqueOrThrow: jest.fn(),
    },
    dataSource: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    ...overrides,
  };
}

function buildRunner(overrides: Record<string, unknown> = {}) {
  return {
    spawn: jest.fn().mockResolvedValue(undefined),
    containerExists: jest.fn().mockResolvedValue(false),
    ...overrides,
  };
}

function buildDescriptor(overrides: Record<string, unknown> = {}) {
  return {
    getDescriptorByVersionIdService: jest.fn().mockResolvedValue({
      data: { featureColumns: ['a', 'b'] },
    }),
    ...overrides,
  };
}

function makeService(
  prisma: ReturnType<typeof buildPrisma>,
  runner: ReturnType<typeof buildRunner> = buildRunner(),
  descriptor: ReturnType<typeof buildDescriptor> = buildDescriptor(),
) {
  return new InferenceWindowSchedulerService(
    prisma as unknown as ConstructorParameters<
      typeof InferenceWindowSchedulerService
    >[0],
    runner as unknown as ConstructorParameters<
      typeof InferenceWindowSchedulerService
    >[1],
    descriptor as unknown as ConstructorParameters<
      typeof InferenceWindowSchedulerService
    >[2],
  );
}

describe('InferenceWindowSchedulerService.insertDueWindows (MODEL-SERVE-006-T02)', () => {
  it('inserts PENDING rows only for a schedule with a PRODUCTION version', async () => {
    const prisma = buildPrisma({
      inferenceSchedule: {
        findMany: jest.fn().mockResolvedValue([
          {
            modelId: 'model-1',
            enabled: true,
            cadenceMinutes: 60,
            lagMinutes: 15,
          },
        ]),
      },
      modelVersion: {
        findFirst: jest.fn().mockResolvedValue({ id: 'version-1' }),
      },
    });
    const service = makeService(prisma);
    // insertDueWindows is private; exercise the documented CONTRACT via the
    // same reflection cast this file's own class exposes no public
    // entrypoint for: createMany is called with skipDuplicates.
    await (service as unknown as { insertDueWindows(): Promise<void> })[
      'insertDueWindows'
    ]();

    expect(prisma.inferenceWindow.createMany).toHaveBeenCalledTimes(1);
    const call = prisma.inferenceWindow.createMany.mock.calls[0][0];
    expect(call.skipDuplicates).toBe(true);
    expect(call.data.length).toBeGreaterThan(0);
    for (const row of call.data) {
      expect(row.modelId).toBe('model-1');
      expect(row.modelVersionId).toBe('version-1');
      expect(row.status).toBe('PENDING');
      // windowEnd is exactly one cadence after windowStart
      expect(row.windowEnd.getTime() - row.windowStart.getTime()).toBe(
        60 * 60_000,
      );
    }
  });

  it('skips a schedule with no PRODUCTION version — not an error, T10 surfaces this instead', async () => {
    const prisma = buildPrisma({
      inferenceSchedule: {
        findMany: jest.fn().mockResolvedValue([
          {
            modelId: 'model-1',
            enabled: true,
            cadenceMinutes: 60,
            lagMinutes: 15,
          },
        ]),
      },
      modelVersion: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    const service = makeService(prisma);
    await (service as unknown as { insertDueWindows(): Promise<void> })[
      'insertDueWindows'
    ]();
    expect(prisma.inferenceWindow.createMany).not.toHaveBeenCalled();
  });

  it('does nothing when no schedule is enabled', async () => {
    const prisma = buildPrisma();
    const service = makeService(prisma);
    await (service as unknown as { insertDueWindows(): Promise<void> })[
      'insertDueWindows'
    ]();
    expect(prisma.modelVersion.findFirst).not.toHaveBeenCalled();
    expect(prisma.inferenceWindow.createMany).not.toHaveBeenCalled();
  });
});

describe('InferenceWindowSchedulerService.reconcileStuckWindows (MODEL-SERVE-006-T02)', () => {
  it('fails a stuck window whose container no longer exists', async () => {
    const prisma = buildPrisma({
      inferenceWindow: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'w1', containerId: 'c1' }]),
        update: jest.fn().mockResolvedValue({}),
      },
    });
    const runner = buildRunner({
      containerExists: jest.fn().mockResolvedValue(false),
    });
    const service = makeService(prisma, runner);
    await (service as unknown as { reconcileStuckWindows(): Promise<void> })[
      'reconcileStuckWindows'
    ]();

    expect(prisma.inferenceWindow.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'w1' },
        data: expect.objectContaining({ status: 'FAILED' }),
      }),
    );
  });

  it('leaves a stuck window alone when its container still exists — a real report always wins', async () => {
    const prisma = buildPrisma({
      inferenceWindow: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'w1', containerId: 'c1' }]),
        update: jest.fn().mockResolvedValue({}),
      },
    });
    const runner = buildRunner({
      containerExists: jest.fn().mockResolvedValue(true),
    });
    const service = makeService(prisma, runner);
    await (service as unknown as { reconcileStuckWindows(): Promise<void> })[
      'reconcileStuckWindows'
    ]();
    expect(prisma.inferenceWindow.update).not.toHaveBeenCalled();
  });

  it('fails a stuck window with no containerId at all — it never spawned', async () => {
    const prisma = buildPrisma({
      inferenceWindow: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'w1', containerId: null }]),
        update: jest.fn().mockResolvedValue({}),
      },
    });
    const runner = buildRunner();
    const service = makeService(prisma, runner);
    await (service as unknown as { reconcileStuckWindows(): Promise<void> })[
      'reconcileStuckWindows'
    ]();
    expect(runner.containerExists).not.toHaveBeenCalled();
    expect(prisma.inferenceWindow.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED' }),
      }),
    );
  });
});

describe('InferenceWindowSchedulerService.dispatchOne (MODEL-SERVE-006-T05)', () => {
  const baseWindow = {
    id: 'w1',
    status: 'PENDING',
    modelId: 'model-1',
    modelVersionId: 'version-1',
    windowStart: new Date('2026-09-10T08:00:00.000Z'),
    windowEnd: new Date('2026-09-10T09:00:00.000Z'),
  };

  it('marks a window SKIPPED (not FAILED) when scored_rows < INFERENCE_MIN_ROWS', async () => {
    (materializeInferenceWindow as jest.Mock).mockResolvedValue({
      object_key:
        'inference/model-1/version-1/dt=2026-09-10/hour=08/input.parquet',
      row_count: 60,
      scored_rows: env.INFERENCE_MIN_ROWS - 1,
      missing_pct: 50,
      checksum: 'abc',
    });
    const prisma = buildPrisma({
      inferenceWindow: {
        findUnique: jest.fn().mockResolvedValue(baseWindow),
        update: jest.fn().mockResolvedValue({}),
      },
      inferenceSchedule: {
        findUnique: jest.fn().mockResolvedValue({
          modelId: 'model-1',
          sourceId: 'source-1',
          fetchConfig: { intervalTime: '1m' },
        }),
      },
      modelVersion: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ featureSpecKey: 'spec-key' }),
      },
      dataSource: {
        findUnique: jest.fn().mockResolvedValue({
          type: 'sql',
          host: 'h',
          username: 'u',
          dbName: 'd',
          secretCiphertext: 'enc',
          config: { driver: 'postgres', port: 5432, table: 't' },
        }),
      },
    });
    const runner = buildRunner();
    const service = makeService(prisma, runner);
    await (service as unknown as { dispatchOne(id: string): Promise<void> })[
      'dispatchOne'
    ]('w1');

    expect(runner.spawn).not.toHaveBeenCalled();
    const updates = prisma.inferenceWindow.update.mock.calls;
    const finalUpdate = updates[updates.length - 1][0];
    expect(finalUpdate.data.status).toBe('SKIPPED');
  });

  it('marks a window FAILED when materialize throws, and never spawns a container', async () => {
    (materializeInferenceWindow as jest.Mock).mockRejectedValue(
      new Error('source unreachable'),
    );
    const prisma = buildPrisma({
      inferenceWindow: {
        findUnique: jest.fn().mockResolvedValue(baseWindow),
        update: jest.fn().mockResolvedValue({}),
      },
      inferenceSchedule: {
        findUnique: jest.fn().mockResolvedValue({
          modelId: 'model-1',
          sourceId: 'source-1',
          fetchConfig: { intervalTime: '1m' },
        }),
      },
      modelVersion: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ featureSpecKey: 'spec-key' }),
      },
      dataSource: {
        findUnique: jest.fn().mockResolvedValue({
          type: 'sql',
          host: 'h',
          username: 'u',
          dbName: 'd',
          secretCiphertext: 'enc',
          config: { driver: 'postgres', port: 5432, table: 't' },
        }),
      },
    });
    const runner = buildRunner();
    const service = makeService(prisma, runner);
    await (service as unknown as { dispatchOne(id: string): Promise<void> })[
      'dispatchOne'
    ]('w1');

    expect(runner.spawn).not.toHaveBeenCalled();
    const updates = prisma.inferenceWindow.update.mock.calls;
    const finalUpdate = updates[updates.length - 1][0];
    expect(finalUpdate.data.status).toBe('FAILED');
    expect(finalUpdate.data.failureReason).toMatch(/source unreachable/);
  });

  it('spawns an infer-mode container when enough rows scored', async () => {
    (materializeInferenceWindow as jest.Mock).mockResolvedValue({
      object_key:
        'inference/model-1/version-1/dt=2026-09-10/hour=08/input.parquet',
      row_count: 60,
      scored_rows: env.INFERENCE_MIN_ROWS + 10,
      missing_pct: 1,
      checksum: 'abc',
    });
    const prisma = buildPrisma({
      inferenceWindow: {
        findUnique: jest.fn().mockResolvedValue(baseWindow),
        update: jest.fn().mockResolvedValue({}),
      },
      inferenceSchedule: {
        findUnique: jest.fn().mockResolvedValue({
          modelId: 'model-1',
          sourceId: 'source-1',
          fetchConfig: { intervalTime: '1m' },
        }),
      },
      modelVersion: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ featureSpecKey: 'spec-key' }),
      },
      dataSource: {
        findUnique: jest.fn().mockResolvedValue({
          type: 'sql',
          host: 'h',
          username: 'u',
          dbName: 'd',
          secretCiphertext: 'enc',
          config: { driver: 'postgres', port: 5432, table: 't' },
        }),
      },
    });
    const runner = buildRunner();
    const service = makeService(prisma, runner);
    await (service as unknown as { dispatchOne(id: string): Promise<void> })[
      'dispatchOne'
    ]('w1');

    expect(runner.spawn).toHaveBeenCalledTimes(1);
    expect(runner.spawn).toHaveBeenCalledWith(
      'w1',
      expect.any(String),
      'infer',
    );
  });

  it('does nothing when the window is no longer PENDING (picked up by a concurrent pass)', async () => {
    const prisma = buildPrisma({
      inferenceWindow: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ ...baseWindow, status: 'RUNNING' }),
      },
    });
    const runner = buildRunner();
    const service = makeService(prisma, runner);
    await (service as unknown as { dispatchOne(id: string): Promise<void> })[
      'dispatchOne'
    ]('w1');
    expect(materializeInferenceWindow).not.toHaveBeenCalled();
    expect(runner.spawn).not.toHaveBeenCalled();
  });
});
