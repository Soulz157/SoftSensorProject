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
    // MODEL-SERVE-009-T02. Present by default so the per-tag write path is
    // EXERCISED rather than swallowed by its own best-effort catch — a
    // fixture missing this accessor made every existing test pass while the
    // feature silently did nothing.
    tagObservation: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
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

  /**
   * T11. A window is due only once it has ELAPSED and cleared its lag —
   * windowStart + cadence + lag <= now — not merely windowStart + lag, which
   * dispatched a window a whole cadence before its own windowEnd. Live-
   * measured: 20 fully-elapsed windows returned 60/60 rows at 0% missing
   * while 4 windows read this early returned 19-30 rows, tracking elapsed
   * minutes linearly.
   *
   * NEGATIVE CONTROL, confirmed by hand against the pre-fix formula
   * (`to = now - lag`, no `+ cadence`): at now=10:20 with cadence=60/lag=15,
   * the pre-fix `to` is 10:05, whose newest aligned windowStart is 10:00 —
   * a window whose OWN windowEnd (11:00) is still 40 minutes in the future
   * at dispatch time. This test's exact-boundary assertion (09:00, not
   * 10:00) fails against that formula and passes only against the fix.
   */
  it('T11: never inserts a window whose own windowEnd has not yet elapsed past the lag', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-14T10:20:00.000Z'));
    try {
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
      await (service as unknown as { insertDueWindows(): Promise<void> })[
        'insertDueWindows'
      ]();

      const call = prisma.inferenceWindow.createMany.mock.calls[0][0];
      const starts = call.data.map((row: { windowStart: Date }) =>
        row.windowStart.getTime(),
      );
      const newest = Math.max(...starts);

      // Exact boundary: 09:00, never 10:00 (what the pre-fix formula would
      // have produced at this same clock).
      expect(newest).toBe(new Date('2026-09-14T09:00:00.000Z').getTime());

      // The general invariant, for every row this call inserts: windowEnd +
      // lag must already be in the past at dispatch time.
      const now = Date.now();
      for (const row of call.data as Array<{
        windowStart: Date;
        windowEnd: Date;
      }>) {
        expect(row.windowEnd.getTime() + 15 * 60_000).toBeLessThanOrEqual(now);
      }
    } finally {
      jest.useRealTimers();
    }
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
          // MODEL-SERVE-001-T14: a real InferenceSchedule row always has a
          // NOT NULL minRows now — every fixture in this describe block
          // must set it, or `scored_rows < undefined` (always false) would
          // silently make SKIPPED unreachable in this mock.
          minRows: env.INFERENCE_MIN_ROWS,
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

  /**
   * MODEL-SERVE-001-T14. The regression proof: this row count would have
   * been marked SKIPPED under the OLD behaviour (reading the global
   * `env.INFERENCE_MIN_ROWS`, 30) even though it is a COMPLETE, healthy
   * window for a schedule fetching at a 5-minute interval (12 rows/hour,
   * so 10 is close to a full window — nowhere near "too few"). Reading
   * `schedule.minRows` (6, as `putScheduleService` would derive for this
   * exact interval) is what makes the difference observable here.
   */
  it('does NOT skip a per-schedule-appropriate row count, even though it is below the GLOBAL env.INFERENCE_MIN_ROWS', async () => {
    (materializeInferenceWindow as jest.Mock).mockResolvedValue({
      object_key:
        'inference/model-1/version-1/dt=2026-09-10/hour=08/input.parquet',
      row_count: 10,
      scored_rows: 10,
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
          fetchConfig: { intervalTime: '5m' },
          minRows: 6, // deriveMinRows(60, '5m') — see inference-windows.spec.ts
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

    // 10 >= this schedule's own 6-row floor — a live container IS spawned.
    // The SKIPPED branch `return`s before ever reaching spawn, so this
    // alone proves the window was NOT skipped, even though 10 is below the
    // global env.INFERENCE_MIN_ROWS (30) that the OLD behaviour compared
    // every schedule against regardless of its own real interval.
    expect(runner.spawn).toHaveBeenCalledTimes(1);
    expect(runner.spawn).toHaveBeenCalledWith(
      'w1',
      expect.any(String),
      'infer',
    );
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
          // MODEL-SERVE-001-T14: a real InferenceSchedule row always has a
          // NOT NULL minRows now — every fixture in this describe block
          // must set it, or `scored_rows < undefined` (always false) would
          // silently make SKIPPED unreachable in this mock.
          minRows: env.INFERENCE_MIN_ROWS,
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
          // MODEL-SERVE-001-T14: a real InferenceSchedule row always has a
          // NOT NULL minRows now — every fixture in this describe block
          // must set it, or `scored_rows < undefined` (always false) would
          // silently make SKIPPED unreachable in this mock.
          minRows: env.INFERENCE_MIN_ROWS,
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

/**
 * The claim is global across every model and takes INFERENCE_MAX_CONCURRENCY
 * rows — 1 by default — so its ORDER decides what the whole system works on
 * next. Oldest-first made a freshly enabled schedule replay up to 48 hours
 * of backfill before ever scoring the current hour, which (a) held the
 * newest SUCCEEDED window in the past and so reported a healthy model as
 * STALE for the whole drain, and (b) let one model's backlog monopolise the
 * single slot while every other model's live window waited.
 */
describe('InferenceWindowSchedulerService.dispatchDue ordering', () => {
  function prismaWithPending(
    rows: Array<{ id: string; windowStart: Date }>,
    enabledModelIds: string[] = ['model-1'],
  ) {
    return buildPrisma({
      inferenceSchedule: {
        findMany: jest
          .fn()
          .mockResolvedValue(
            enabledModelIds.map((modelId) => ({ modelId, enabled: true })),
          ),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      inferenceWindow: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue(rows),
        // dispatchOne re-reads the row and bails when it is not PENDING —
        // enough to keep this test about the claim, not the dispatch.
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
    });
  }

  it('claims the NEWEST pending window, so live inference beats backfill', async () => {
    const prisma = prismaWithPending([]);
    const service = makeService(prisma);

    await service['dispatchDue']();

    expect(prisma.inferenceWindow.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'PENDING', modelId: { in: ['model-1'] } },
        orderBy: { windowStart: 'desc' },
      }),
    );
  });

  it('still respects INFERENCE_MAX_CONCURRENCY as the batch bound', async () => {
    const prisma = prismaWithPending([]);
    const service = makeService(prisma);

    await service['dispatchDue']();

    expect(prisma.inferenceWindow.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: env.INFERENCE_MAX_CONCURRENCY }),
    );
  });

  it('dispatches the current hour ahead of a two-day backfill', async () => {
    // What the ordering is FOR: the row the database would return first
    // under `desc` is the live one, not the oldest backfill window.
    const backfill = {
      id: 'backfill-oldest',
      windowStart: new Date('2026-09-12T04:00:00.000Z'),
    };
    const live = {
      id: 'live-current',
      windowStart: new Date('2026-09-14T03:00:00.000Z'),
    };
    const ordered = [backfill, live].sort(
      (a, b) => b.windowStart.getTime() - a.windowStart.getTime(),
    );
    const prisma = prismaWithPending(ordered.slice(0, 1));
    const service = makeService(prisma);
    const dispatched: string[] = [];
    jest
      .spyOn(
        service as unknown as { dispatchOne: (id: string) => Promise<void> },
        'dispatchOne',
      )
      .mockImplementation((id: string) => {
        dispatched.push(id);
        return Promise.resolve();
      });

    await service['dispatchDue']();

    expect(dispatched).toEqual(['live-current']);
  });

  /**
   * MODEL-SERVE-001-T19 (A1). This is the actual defect: `insertDueWindows`
   * already filters on `enabled: true`, but `dispatchDue` did not, so
   * disabling a schedule stopped FUTURE rows and did nothing to whatever
   * was already PENDING — it kept draining one window per tick as if Stop
   * had no effect. Regression-proofed two ways: an all-disabled system
   * never even issues the InferenceWindow query, and an enabled subset
   * scopes the claim to exactly those schedules' models.
   */
  it('never queries PENDING windows when no schedule is enabled', async () => {
    const prisma = prismaWithPending([], []); // no schedule is enabled
    const service = makeService(prisma);

    await service['dispatchDue']();

    expect(prisma.inferenceSchedule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { enabled: true } }),
    );
    // Short-circuits before ever asking InferenceWindow for PENDING rows —
    // there is nothing an enabled-schedule filter could match.
    expect(prisma.inferenceWindow.findMany).not.toHaveBeenCalled();
  });

  it('scopes the PENDING claim to only the currently-enabled schedules', async () => {
    const prisma = prismaWithPending([], ['model-1', 'model-2']);
    const service = makeService(prisma);

    await service['dispatchDue']();

    expect(prisma.inferenceWindow.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'PENDING',
          modelId: { in: ['model-1', 'model-2'] },
        },
      }),
    );
  });
});

// ── MODEL-SERVE-009-T02: per-tag current state ─────────────────────────────

describe('InferenceWindowSchedulerService per-tag observations (MODEL-SERVE-009-T02)', () => {
  const win = {
    id: 'w1',
    status: 'PENDING',
    modelId: 'model-1',
    modelVersionId: 'version-1',
    windowStart: new Date('2026-09-10T08:00:00.000Z'),
    windowEnd: new Date('2026-09-10T09:00:00.000Z'),
  };
  const READINGS = {
    'TI202.PV': {
      last_value: 41.5,
      last_status: 0,
      observed_at: '2026-09-10T08:59:00.000Z',
    },
    'FIC114A.PV': {
      last_value: 0,
      last_status: 0,
      observed_at: '2026-09-10T08:59:00.000Z',
    },
  };

  function prismaFor(overrides: Record<string, unknown> = {}) {
    return buildPrisma({
      inferenceWindow: {
        findUnique: jest.fn().mockResolvedValue(win),
        update: jest.fn().mockResolvedValue({ modelId: 'model-1' }),
      },
      inferenceSchedule: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue({
          modelId: 'model-1',
          sourceId: 'source-1',
          fetchConfig: { intervalTime: '1m' },
          minRows: env.INFERENCE_MIN_ROWS,
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
      ...overrides,
    });
  }

  function materializeWith(tagObservations: Record<string, unknown>) {
    (materializeInferenceWindow as jest.Mock).mockResolvedValue({
      object_key:
        'inference/model-1/version-1/dt=2026-09-10/hour=08/input.parquet',
      row_count: 60,
      scored_rows: env.INFERENCE_MIN_ROWS + 10,
      missing_pct: 1,
      checksum: 'abc',
      tag_observations: tagObservations,
    });
  }

  async function dispatch(prisma: ReturnType<typeof buildPrisma>) {
    const service = makeService(prisma, buildRunner());
    await (service as unknown as { dispatchOne(id: string): Promise<void> })[
      'dispatchOne'
    ]('w1');
  }

  it('upserts one row per tag on a successful fetch, keyed on (model, tag)', async () => {
    materializeWith(READINGS);
    const prisma = prismaFor();

    await dispatch(prisma);

    expect(prisma.tagObservation.upsert).toHaveBeenCalledTimes(2);
    const first = prisma.tagObservation.upsert.mock.calls[0][0];
    // The unique key is what makes "updated in place" the database's rule
    // rather than every caller's habit — and what keeps this off the
    // timeseries-in-Postgres path architecture.storage_authority forbids.
    expect(first.where).toEqual({
      modelId_tag: { modelId: 'model-1', tag: 'TI202.PV' },
    });
    expect(first.update.lastFetchOutcome).toBe('SUCCEEDED');
    expect(first.update.lastValue).toBe(41.5);
  });

  it('records a FAILED fetch on existing rows rather than leaving them untouched', async () => {
    (materializeInferenceWindow as jest.Mock).mockRejectedValue(
      new Error('source unreachable'),
    );
    const prisma = prismaFor();

    await dispatch(prisma);

    // findings[9]: an absent fetch is NOT a flat tag. Without this a
    // multi-hour outage reads identically to a multi-hour freeze.
    expect(prisma.tagObservation.updateMany).toHaveBeenCalled();
    const call = prisma.tagObservation.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ modelId: 'model-1' });
    expect(call.data.lastFetchOutcome).toBe('FAILED');
    // Neither timestamp moves: nothing arrived, so nothing arrived.
    expect(call.data.lastSeenAt).toBeUndefined();
    expect(call.data.lastChangedAt).toBeUndefined();
  });

  it('writes nothing per-tag when the fetch reported no tags at all', async () => {
    materializeWith({});
    const prisma = prismaFor();

    await dispatch(prisma);

    expect(prisma.tagObservation.upsert).not.toHaveBeenCalled();
  });

  it('does not cost the window its input pointer when the per-tag write throws', async () => {
    materializeWith(READINGS);
    const prisma = prismaFor({
      tagObservation: {
        findMany: jest.fn().mockRejectedValue(new Error('db down')),
        upsert: jest.fn(),
        updateMany: jest.fn(),
      },
    });

    await dispatch(prisma);

    // The window's scored record must not be lost for derived state the
    // next fetch rewrites anyway.
    const updates = prisma.inferenceWindow.update.mock.calls;
    expect(updates.length).toBeGreaterThan(0);
    expect(updates[0][0].data.inputKey).toContain('input.parquet');
  });
});
