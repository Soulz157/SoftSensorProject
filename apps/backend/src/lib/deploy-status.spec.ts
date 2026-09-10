import {
  classifyDeployStatus,
  deriveDeployStatuses,
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
      }),
    ).toBe('error');
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
        findMany: jest
          .fn()
          .mockResolvedValue([
            { modelId: 'm1', enabled: true, cadenceMinutes: 60 },
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
        findMany: jest
          .fn()
          .mockResolvedValue([
            { modelId: 'm1', enabled: true, cadenceMinutes: 60 },
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
        findMany: jest
          .fn()
          .mockResolvedValue([
            { modelId: 'm1', enabled: true, cadenceMinutes: 60 },
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
