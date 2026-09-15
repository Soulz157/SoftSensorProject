import {
  classifyDeployStatus,
  deriveDeployStatuses,
  isStale,
  overlayDeployStatus,
} from './deploy-status';

describe('classifyDeployStatus (MODEL-SERVE-006-T12)', () => {
  it('is stopped when the schedule is not enabled, regardless of history', () => {
    expect(
      classifyDeployStatus({
        enabled: false,
        hasEverSucceeded: true,
        staleness: 'OK',
        failing: false,
        hasFailedWindows: false,
      }),
    ).toBe('stopped');
  });

  it('is running when enabled and fresh', () => {
    expect(
      classifyDeployStatus({
        enabled: true,
        hasEverSucceeded: true,
        staleness: 'OK',
        failing: false,
        hasFailedWindows: false,
      }),
    ).toBe('running');
  });

  it('is initializing when enabled, stale, but never succeeded yet — a warm-up, not a failure', () => {
    expect(
      classifyDeployStatus({
        enabled: true,
        hasEverSucceeded: false,
        staleness: 'STALE',
        failing: false,
        hasFailedWindows: false,
      }),
    ).toBe('initializing');
  });

  it('is error when enabled, stale, and it WAS producing before — a real regression', () => {
    expect(
      classifyDeployStatus({
        enabled: true,
        hasEverSucceeded: true,
        staleness: 'STALE',
        failing: false,
        hasFailedWindows: false,
      }),
    ).toBe('error');
  });

  it('is error when failing, even if not yet stale by the time window', () => {
    expect(
      classifyDeployStatus({
        enabled: true,
        hasEverSucceeded: true,
        staleness: 'OK',
        failing: true,
        hasFailedWindows: true,
      }),
    ).toBe('error');
  });

  /**
   * The gap that let a completely broken schedule read as a healthy
   * warm-up. `failing` needs THREE consecutive failures — right for a
   * mature schedule, far too slow for a new one, which only reaches three
   * failures after three cadences. Until then "never succeeded + stale"
   * returned `initializing` no matter how many windows had already failed.
   */
  it('is error when a NEVER-SUCCEEDED schedule has already failed a window', () => {
    expect(
      classifyDeployStatus({
        enabled: true,
        hasEverSucceeded: false,
        staleness: 'STALE',
        // Only one or two failures so far — below the `failing` bar.
        failing: false,
        hasFailedWindows: true,
      }),
    ).toBe('error');
  });

  it('is still initializing when nothing has been produced at all', () => {
    expect(
      classifyDeployStatus({
        enabled: true,
        hasEverSucceeded: false,
        staleness: 'STALE',
        failing: false,
        hasFailedWindows: false,
      }),
    ).toBe('initializing');
  });

  it('a failed window in the past does NOT override a currently fresh schedule', () => {
    // Recovered: it has succeeded since, and is not stale. An old failure
    // must not pin a working model to `error` forever — the status is
    // derived at read time precisely so it can heal.
    expect(
      classifyDeployStatus({
        enabled: true,
        hasEverSucceeded: true,
        staleness: 'OK',
        failing: false,
        hasFailedWindows: true,
      }),
    ).toBe('running');
  });

  it('is stopped even when failing — a disabled schedule is not an alarm', () => {
    expect(
      classifyDeployStatus({
        enabled: false,
        hasEverSucceeded: false,
        staleness: 'STALE',
        failing: true,
        hasFailedWindows: true,
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
  it('merges deployStatus into existing data without mutating the input', () => {
    const model = { id: 'm1', data: { prodStatus: 'normal' } };
    const result = overlayDeployStatus(model, 'running');
    expect(result.data).toEqual({
      prodStatus: 'normal',
      deployStatus: 'running',
    });
    expect(model.data).toEqual({ prodStatus: 'normal' }); // unchanged
  });

  it('handles a null/non-object data field defensively', () => {
    const model = { id: 'm1', data: null };
    expect(overlayDeployStatus(model, 'stopped').data).toEqual({
      deployStatus: 'stopped',
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

  it('returns stopped for every id when nothing has a schedule', async () => {
    const prisma = buildPrisma();
    const result = await deriveDeployStatuses(prisma, ['m1', 'm2']);
    expect(result).toEqual({ m1: 'stopped', m2: 'stopped' });
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
    expect(result.m1).toBe('running');
  });

  it('derives error for an enabled schedule whose last 3 terminal windows all failed', async () => {
    const prisma = buildPrisma({
      inferenceSchedule: {
        findMany: jest.fn().mockResolvedValue([
          {
            modelId: 'm1',
            enabled: true,
            cadenceMinutes: 60,
            lagMinutes: 15,
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
            { status: 'FAILED' },
            { status: 'FAILED' },
            { status: 'FAILED' },
          ]),
      },
    });
    const result = await deriveDeployStatuses(prisma, ['m1']);
    expect(result.m1).toBe('error');
  });

  it('derives initializing for a just-enabled schedule with no windows yet', async () => {
    const prisma = buildPrisma({
      inferenceSchedule: {
        findMany: jest.fn().mockResolvedValue([
          {
            modelId: 'm1',
            enabled: true,
            cadenceMinutes: 60,
            lagMinutes: 15,
          },
        ]),
      },
      inferenceWindow: {
        groupBy: jest.fn().mockResolvedValue([]), // no SUCCEEDED/SKIPPED window yet
        findMany: jest.fn().mockResolvedValue([]),
      },
    });
    const result = await deriveDeployStatuses(prisma, ['m1']);
    expect(result.m1).toBe('initializing');
  });
});
