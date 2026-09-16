import {
  classifyDeployStatus,
  deriveDeployStatuses,
  isStale,
  overlayDeployStatus,
} from './deploy-status';

describe('classifyDeployStatus (MODEL-SERVE-006-T12, reshaped by T26)', () => {
  it('is stopped when the schedule is not enabled, regardless of history', () => {
    expect(
      classifyDeployStatus({
        enabled: false,
        hasEverSucceeded: true,
        preflightOk: true,
      }),
    ).toBe('stopped');
  });

  it('is running when enabled and preflight passed', () => {
    expect(
      classifyDeployStatus({
        enabled: true,
        hasEverSucceeded: true,
        preflightOk: true,
      }),
    ).toBe('running');
  });

  it('is running from the press — a probed schedule does not sit in initializing', () => {
    // The operator has already been told the source answers; making them
    // watch a spinner until the first window lands would report an
    // uncertainty the system no longer has.
    expect(
      classifyDeployStatus({
        enabled: true,
        hasEverSucceeded: false,
        preflightOk: true,
      }),
    ).toBe('running');
  });

  it('is error when preflight FAILED — the only remaining path to error', () => {
    expect(
      classifyDeployStatus({
        enabled: true,
        hasEverSucceeded: false,
        preflightOk: false,
      }),
    ).toBe('error');
  });

  it('is initializing when NOT PROBED and nothing has been produced yet', () => {
    // A non-PI source, or a schedule enabled before T25 shipped.
    expect(
      classifyDeployStatus({
        enabled: true,
        hasEverSucceeded: false,
        preflightOk: null,
      }),
    ).toBe('initializing');
  });

  it('a NOT-PROBED schedule that has produced is running, not initializing', () => {
    // This is the case that carries every pre-T25 schedule across the
    // migration: never probed, but demonstrably working. A `null` read as a
    // failure here would flip every live schedule to Failed on deploy day.
    expect(
      classifyDeployStatus({
        enabled: true,
        hasEverSucceeded: true,
        preflightOk: null,
      }),
    ).toBe('running');
  });

  it('is stopped even when preflight failed — a disabled schedule is not an alarm', () => {
    expect(
      classifyDeployStatus({
        enabled: false,
        hasEverSucceeded: false,
        preflightOk: false,
      }),
    ).toBe('stopped');
  });
});

/**
 * T11. The scheduler now dispatches a window only once `windowStart +
 * cadence + lag <= now` (the scheduler's own T11 fix) — so that interval is
 * PROCESSING TIME, not lateness, and must not count against
 * INFERENCE_STALE_AFTER_CADENCES (default 3). Boundary math below at
 * cadence=60/lag=15: allowance is 3*60=180min beyond `windowStart + 75min`.
 *
 * Not "headroom unchanged": the old inline calc measured staleness purely
 * from `lastSucceeded.windowStart`, giving 180min of raw allowance from
 * windowStart. The fix's own 75min processing offset makes the EFFECTIVE
 * headroom wider (255min from windowStart), not narrower — asserted here as
 * `isStale`'s own boundary, not as a before/after comparison.
 */
describe('isStale (MODEL-SERVE-001-T11)', () => {
  const NOW = new Date('2026-09-14T12:00:00.000Z');

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('is STALE, unconditionally, when nothing has ever succeeded', () => {
    expect(isStale(null, 60, 15)).toBe('STALE');
  });

  it('is OK exactly AT the boundary (windowStart + cadence + lag + STALE*cadence)', () => {
    // processableAt = 07:45 + 75min = 09:00; now(12:00) - 09:00 = 180min,
    // the exact allowance (3 * 60min) — NOT strictly greater, so OK.
    const lastWindowStart = new Date('2026-09-14T07:45:00.000Z');
    expect(isStale(lastWindowStart, 60, 15)).toBe('OK');
  });

  it('is STALE one minute past that same boundary', () => {
    const lastWindowStart = new Date('2026-09-14T07:44:00.000Z');
    expect(isStale(lastWindowStart, 60, 15)).toBe('STALE');
  });

  it('does not count the cadence+lag processing interval itself as staleness', () => {
    // A window that became processable RIGHT NOW (the freshest possible
    // reading) must never read STALE regardless of cadence/lag size.
    const lastWindowStart = new Date(NOW.getTime() - (60 + 15) * 60_000);
    expect(isStale(lastWindowStart, 60, 15)).toBe('OK');
  });
});

describe('overlayDeployStatus', () => {
  it('merges deployStatus AND enabled into existing data without mutating the input', () => {
    const model = { id: 'm1', data: { prodStatus: 'normal' } };
    const result = overlayDeployStatus(model, {
      status: 'running',
      enabled: true,
      lastFailure: null,
      monitoring: { status: 'OFF', reason: null, frozenColumns: [] },
    });
    expect(result.data).toEqual({
      prodStatus: 'normal',
      deployStatus: 'running',
      enabled: true,
      lastFailure: null,
      monitoring: { status: 'OFF', reason: null, frozenColumns: [] },
    });
    expect(model.data).toEqual({ prodStatus: 'normal' }); // unchanged
  });

  it('handles a null/non-object data field defensively', () => {
    const model = { id: 'm1', data: null };
    expect(
      overlayDeployStatus(model, {
        status: 'stopped',
        enabled: false,
        lastFailure: null,
        monitoring: { status: 'OFF', reason: null, frozenColumns: [] },
      }).data,
    ).toEqual({
      deployStatus: 'stopped',
      enabled: false,
      lastFailure: null,
      monitoring: { status: 'OFF', reason: null, frozenColumns: [] },
    });
  });

  // MODEL-SERVE-001-T23.
  it('carries a real failure reason through onto the list payload', () => {
    const at = new Date('2026-09-15T10:00:00.000Z');
    const model = { id: 'm1', data: {} };
    const result = overlayDeployStatus(model, {
      status: 'error',
      enabled: true,
      lastFailure: { reason: 'Materialize failed: source unreachable', at },
      monitoring: { status: 'OFF', reason: null, frozenColumns: [] },
    });
    expect(result.data).toEqual({
      deployStatus: 'error',
      enabled: true,
      lastFailure: { reason: 'Materialize failed: source unreachable', at },
      monitoring: { status: 'OFF', reason: null, frozenColumns: [] },
    });
  });

  /**
   * MODEL-SERVE-001-T19. The exact case the fix exists for: a schedule the
   * operator has enabled but which is failing reads status 'error' while
   * `enabled` stays true — a Start/Stop control reading `enabled` (not
   * `status`) is what lets it offer Stop here.
   */
  it('carries enabled=true alongside an error status — the enabled-but-failing case', () => {
    const model = { id: 'm1', data: {} };
    const result = overlayDeployStatus(model, {
      status: 'error',
      enabled: true,
      lastFailure: null,
      monitoring: { status: 'OFF', reason: null, frozenColumns: [] },
    });
    expect(result.data).toEqual({
      deployStatus: 'error',
      enabled: true,
      lastFailure: null,
      monitoring: { status: 'OFF', reason: null, frozenColumns: [] },
    });
  });
});

describe('deriveDeployStatuses (batched)', () => {
  function buildPrisma(overrides: Record<string, unknown> = {}) {
    return {
      inferenceSchedule: { findMany: jest.fn().mockResolvedValue([]) },
      inferenceWindow: {
        groupBy: jest.fn().mockResolvedValue([]),
        findMany: jest.fn().mockResolvedValue([]),
      },
      ...overrides,
    } as unknown as Parameters<typeof deriveDeployStatuses>[0];
  }

  it('returns stopped/disabled for every id when nothing has a schedule', async () => {
    const prisma = buildPrisma();
    const result = await deriveDeployStatuses(prisma, ['m1', 'm2']);
    expect(result).toEqual({
      m1: {
        status: 'stopped',
        enabled: false,
        lastFailure: null,
        monitoring: { status: 'OFF', reason: null, frozenColumns: [] },
      },
      m2: {
        status: 'stopped',
        enabled: false,
        lastFailure: null,
        monitoring: { status: 'OFF', reason: null, frozenColumns: [] },
      },
    });
  });

  /**
   * MODEL-SERVE-001-V22. THE NO-N+1 BOUND, which is what lets the Alerts page
   * stay a pure function over the models list instead of one status request
   * per model.
   *
   * The shape is deliberately asserted as it really is — **2 + E**, E being
   * the number of ENABLED schedules — not as the "fully batched" the doc
   * comment on `deriveDeployStatuses` once implied. The two batched reads are
   * constant; the take-3 terminal-window read fans out over enabled models
   * only. Pinning the real figure is the point: a future change that adds one
   * more per-model read (a baseline fetch for drift, a featureStats select for
   * frozen) breaks this test rather than quietly tripling the list's cost.
   *
   * The fixture uses TWO ENABLED schedules on purpose. With everything
   * disabled the fan-out term is zero and the assertion passes at one query
   * while proving nothing at all — the exact vacuous-fixture trap this
   * feature has hit twice before.
   */
  it('runs 2 + (one per ENABLED schedule) queries for the list — no per-model fan-out beyond the terminal-window read', async () => {
    const prisma = buildPrisma({
      inferenceSchedule: {
        findMany: jest.fn().mockResolvedValue([
          {
            modelId: 'm1',
            enabled: true,
            // Finite cadence/lag, NOT undefined: `isStale` fails toward
            // 'STALE' on a missing cadence, and three pre-existing fixtures
            // in this file were found passing `undefined` (see isStale's own
            // doc). A vague fixture would make this assert the wrong path.
            cadenceMinutes: 60,
            lagMinutes: 15,
            preflightOk: true,
            skipStreakAlert: 3,
            missingPctWarn: 5,
            missingPctAlert: 20,
          },
          {
            modelId: 'm2',
            enabled: true,
            cadenceMinutes: 60,
            lagMinutes: 15,
            preflightOk: true,
            skipStreakAlert: 3,
            missingPctWarn: 5,
            missingPctAlert: 20,
          },
          // Disabled: contributes NO terminal-window read. Present so the
          // count below distinguishes "per enabled schedule" from "per model".
          {
            modelId: 'm3',
            enabled: false,
            cadenceMinutes: 60,
            lagMinutes: 15,
            preflightOk: null,
            skipStreakAlert: 3,
            missingPctWarn: 5,
            missingPctAlert: 20,
          },
        ]),
      },
      inferenceWindow: {
        groupBy: jest.fn().mockResolvedValue([
          { modelId: 'm1', _max: { windowStart: new Date() } },
          { modelId: 'm2', _max: { windowStart: new Date() } },
        ]),
        findMany: jest.fn().mockResolvedValue([]),
      },
    });

    await deriveDeployStatuses(prisma, ['m1', 'm2', 'm3']);

    const mock = prisma as unknown as {
      inferenceSchedule: { findMany: jest.Mock };
      inferenceWindow: { groupBy: jest.Mock; findMany: jest.Mock };
    };
    // Batched over every id, once.
    expect(mock.inferenceSchedule.findMany).toHaveBeenCalledTimes(1);
    // Batched over the enabled ids, once.
    expect(mock.inferenceWindow.groupBy).toHaveBeenCalledTimes(1);
    // TWO enabled schedules => two terminal-window reads. Three models, not
    // three reads: the disabled one costs nothing.
    expect(mock.inferenceWindow.findMany).toHaveBeenCalledTimes(2);
  });

  it('returns an empty object for an empty id list without querying', async () => {
    const prisma = buildPrisma();
    const result = await deriveDeployStatuses(prisma, []);
    expect(result).toEqual({});
    expect(
      (prisma as unknown as { inferenceSchedule: { findMany: jest.Mock } })
        .inferenceSchedule.findMany,
    ).not.toHaveBeenCalled();
  });

  it('derives running for an enabled schedule with a recent succeeded window', async () => {
    const prisma = buildPrisma({
      inferenceSchedule: {
        findMany: jest.fn().mockResolvedValue([
          {
            modelId: 'm1',
            enabled: true,
            cadenceMinutes: 60,
            lagMinutes: 15,
            // Real rows always carry this column. Stated explicitly so a
            // reader cannot conclude it is optional — `undefined` would take
            // the same branch as `true` here and pass for the wrong reason.
            preflightOk: true,
          },
        ]),
      },
      inferenceWindow: {
        groupBy: jest
          .fn()
          .mockResolvedValue([
            { modelId: 'm1', _max: { windowStart: new Date() } },
          ]),
        findMany: jest
          .fn()
          .mockResolvedValue([
            { status: 'SUCCEEDED' },
            { status: 'SUCCEEDED' },
            { status: 'SUCCEEDED' },
          ]),
      },
    });
    const result = await deriveDeployStatuses(prisma, ['m1']);
    expect(result.m1).toEqual({
      status: 'running',
      enabled: true,
      lastFailure: null,
      monitoring: { status: 'OFF', reason: null, frozenColumns: [] },
    });
  });

  /**
   * MODEL-SERVE-001-V19. RUNNING IS STICKY — proven on a fixture that HAS
   * ALREADY SUCCEEDED ONCE, which is the half of V19 that does the work.
   *
   * A never-succeeded fixture would pass under the OLD logic too and prove
   * nothing: that is the exact trap V10 recorded when TM2 could not
   * demonstrate T12's warmup change because it already held six failed
   * windows. Here `groupBy` returns a real last-SUCCEEDED window (the model
   * WAS producing), and only then do three consecutive FAILED windows
   * arrive.
   *
   * BEFORE T26 THIS CASE ASSERTED `status: 'error'`. That is the behaviour
   * change, stated rather than quietly rewritten: three failed windows say
   * something about the DATA, not about whether the scheduler is
   * dispatching, so they moved to the monitoring axis (ALERT/
   * SOURCE_UNREACHABLE — see model-health.spec.ts). `enabled` staying true
   * alongside it is still T19's Stop-control requirement, unchanged.
   */
  it('stays running through three consecutive failures on a model that has succeeded before', async () => {
    const failedWindows = [
      {
        status: 'FAILED',
        failureReason: 'spawn refused',
        windowStart: new Date('2026-09-15T12:00:00.000Z'),
      },
      {
        status: 'FAILED',
        failureReason: 'spawn refused',
        windowStart: new Date('2026-09-15T11:00:00.000Z'),
      },
      {
        status: 'FAILED',
        failureReason: 'spawn refused',
        windowStart: new Date('2026-09-15T10:00:00.000Z'),
      },
    ];

    // Snapshot the status after EACH failure, not only after the third:
    // "it ended up running" is compatible with it having flickered through
    // 'error' in between, which is what an operator would actually see.
    const statusAfter: string[] = [];
    for (let n = 1; n <= 3; n += 1) {
      const prisma = buildPrisma({
        inferenceSchedule: {
          findMany: jest.fn().mockResolvedValue([
            {
              modelId: 'm1',
              enabled: true,
              cadenceMinutes: 60,
              lagMinutes: 15,
              preflightOk: true,
            },
          ]),
        },
        inferenceWindow: {
          // It succeeded once, before any of the failures above.
          groupBy: jest
            .fn()
            .mockResolvedValue([
              { modelId: 'm1', _max: { windowStart: new Date() } },
            ]),
          findMany: jest.fn().mockResolvedValue(failedWindows.slice(3 - n)),
        },
      });
      const result = await deriveDeployStatuses(prisma, ['m1']);
      statusAfter.push(result.m1.status);
    }

    expect(statusAfter).toEqual(['running', 'running', 'running']);
  });

  it('still reports the failure reason while reading running — the fault is not hidden, just re-homed', async () => {
    const prisma = buildPrisma({
      inferenceSchedule: {
        findMany: jest.fn().mockResolvedValue([
          {
            modelId: 'm1',
            enabled: true,
            cadenceMinutes: 60,
            lagMinutes: 15,
            preflightOk: true,
          },
        ]),
      },
      inferenceWindow: {
        groupBy: jest
          .fn()
          .mockResolvedValue([
            { modelId: 'm1', _max: { windowStart: new Date() } },
          ]),
        findMany: jest.fn().mockResolvedValue([
          {
            status: 'FAILED',
            failureReason: 'spawn refused',
            windowStart: new Date('2026-09-15T12:00:00.000Z'),
          },
        ]),
      },
    });
    const result = await deriveDeployStatuses(prisma, ['m1']);
    expect(result.m1).toEqual({
      status: 'running',
      enabled: true,
      lastFailure: {
        reason: 'spawn refused',
        at: new Date('2026-09-15T12:00:00.000Z'),
      },
      // ONE failure, below the 3-window bar — a fault is reported, not yet
      // alarmed. The deploy axis is unmoved either way.
      monitoring: { status: 'OFF', reason: null, frozenColumns: [] },
    });
  });

  it('derives initializing for a just-enabled, NOT-PROBED schedule with no windows yet', async () => {
    const prisma = buildPrisma({
      inferenceSchedule: {
        findMany: jest.fn().mockResolvedValue([
          {
            modelId: 'm1',
            enabled: true,
            cadenceMinutes: 60,
            lagMinutes: 15,
            // T25/T26: not probed (a non-PI source, or enabled before T25).
            // A PROBED schedule is running from the press instead.
            preflightOk: null,
          },
        ]),
      },
      inferenceWindow: {
        groupBy: jest.fn().mockResolvedValue([]), // no SUCCEEDED/SKIPPED window yet
        findMany: jest.fn().mockResolvedValue([]),
      },
    });
    const result = await deriveDeployStatuses(prisma, ['m1']);
    expect(result.m1).toEqual({
      status: 'initializing',
      enabled: true,
      lastFailure: null,
      monitoring: { status: 'OFF', reason: null, frozenColumns: [] },
    });
  });

  it('derives error for a schedule whose enable-time preflight failed', async () => {
    const prisma = buildPrisma({
      inferenceSchedule: {
        findMany: jest.fn().mockResolvedValue([
          {
            modelId: 'm1',
            enabled: true,
            cadenceMinutes: 60,
            lagMinutes: 15,
            preflightOk: false,
          },
        ]),
      },
    });
    const result = await deriveDeployStatuses(prisma, ['m1']);
    expect(result.m1?.status).toBe('error');
    // T19's Stop-control requirement survives the reshape.
    expect(result.m1?.enabled).toBe(true);
  });

  it('derives disabled/stopped for a schedule the operator turned off, even mid-failure', async () => {
    const prisma = buildPrisma({
      inferenceSchedule: {
        findMany: jest.fn().mockResolvedValue([
          {
            modelId: 'm1',
            enabled: false,
            cadenceMinutes: 60,
            lagMinutes: 15,
            preflightOk: true,
          },
        ]),
      },
    });
    const result = await deriveDeployStatuses(prisma, ['m1']);
    expect(result.m1).toEqual({
      status: 'stopped',
      enabled: false,
      lastFailure: null,
      monitoring: { status: 'OFF', reason: null, frozenColumns: [] },
    });
  });

  /**
   * MODEL-SERVE-001-T23. The reason the Alerts page can show a real failure
   * cause without a per-model request: it rides on the recent-terminal
   * query this function already makes. Redaction is asserted here rather
   * than trusted, because this column holds the infer container's verbatim
   * `str(err)` — the one failureReason writer never sanitized on the way in.
   */
  it('returns the most recent FAILED window reason, redacted', async () => {
    const newest = new Date('2026-09-15T12:00:00.000Z');
    const older = new Date('2026-09-15T11:00:00.000Z');
    const prisma = buildPrisma({
      inferenceSchedule: {
        findMany: jest.fn().mockResolvedValue([
          {
            modelId: 'm1',
            enabled: true,
            cadenceMinutes: 60,
            lagMinutes: 15,
            // Real rows always carry this column. Stated explicitly so a
            // reader cannot conclude it is optional — `undefined` would take
            // the same branch as `true` here and pass for the wrong reason.
            preflightOk: true,
          },
        ]),
      },
      inferenceWindow: {
        groupBy: jest.fn().mockResolvedValue([]),
        // DESC by windowStart, as the real query orders it.
        findMany: jest.fn().mockResolvedValue([
          {
            status: 'FAILED',
            failureReason: 'Materialize failed: http://pi.internal/x timed out',
            windowStart: newest,
          },
          {
            status: 'FAILED',
            failureReason: 'an older failure',
            windowStart: older,
          },
        ]),
      },
    });
    const result = await deriveDeployStatuses(prisma, ['m1']);
    expect(result.m1?.lastFailure?.at).toEqual(newest);
    expect(result.m1?.lastFailure?.reason).not.toContain('pi.internal');
    expect(result.m1?.lastFailure?.reason).toContain('Materialize failed');
  });

  it('reports lastFailure null when the recent-terminal sample holds no FAILED row', async () => {
    const prisma = buildPrisma({
      inferenceSchedule: {
        findMany: jest.fn().mockResolvedValue([
          {
            modelId: 'm1',
            enabled: true,
            cadenceMinutes: 60,
            lagMinutes: 15,
            // Real rows always carry this column. Stated explicitly so a
            // reader cannot conclude it is optional — `undefined` would take
            // the same branch as `true` here and pass for the wrong reason.
            preflightOk: true,
          },
        ]),
      },
      inferenceWindow: {
        groupBy: jest
          .fn()
          .mockResolvedValue([
            { modelId: 'm1', _max: { windowStart: new Date() } },
          ]),
        findMany: jest.fn().mockResolvedValue([
          { status: 'SUCCEEDED', failureReason: null, windowStart: new Date() },
          {
            status: 'SKIPPED',
            failureReason: 'below minRows',
            windowStart: new Date(),
          },
        ]),
      },
    });
    const result = await deriveDeployStatuses(prisma, ['m1']);
    // A SKIPPED window carries a failureReason too, and it is NOT an error —
    // the same distinction getStatusService's lastFailure/lastSkipped split
    // already draws. It must not leak into this field.
    expect(result.m1?.lastFailure).toBeNull();
  });
});
