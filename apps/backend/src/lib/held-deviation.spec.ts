import { heldDeviationOf, loadHeldFallbacks } from '@/lib/held-deviation';
import type { PrismaService } from '@softsensor/prisma';

describe('heldDeviationOf (MODEL-SERVE-046)', () => {
  it('is the larger distance from the held value to the request min/max', () => {
    expect(heldDeviationOf({ n: 3, min: 90, max: 130 }, 100)).toBe(30);
    expect(heldDeviationOf({ n: 3, min: 60, max: 101 }, 100)).toBe(40);
    expect(heldDeviationOf({ n: 1, min: 67.43, max: 67.43 }, 93)).toBeCloseTo(
      25.57,
    );
  });

  it('is null when either half is missing or unusable', () => {
    expect(heldDeviationOf({ n: 1, min: 1, max: 1 }, null)).toBeNull();
    expect(heldDeviationOf(null, 5)).toBeNull();
    expect(heldDeviationOf({ n: 0, min: 1, max: 1 }, 5)).toBeNull();
    expect(heldDeviationOf({ n: 2, min: 'x', max: 1 }, 5)).toBeNull();
    expect(heldDeviationOf({ n: 2, min: 1, max: NaN }, 5)).toBeNull();
  });
});

describe('loadHeldFallbacks', () => {
  const NOW = new Date('2026-11-03T12:00:00.000Z');
  const prismaWith = (observation: object | null, log: object | null) =>
    ({
      tagObservation: {
        findMany: jest.fn().mockResolvedValue(observation ? [observation] : []),
      },
      predictionLog: {
        findMany: jest.fn().mockResolvedValue(log ? [log] : []),
      },
    }) as unknown as PrismaService;
  const version = { id: 'v1', modelId: 'm1', targetY: 'Lab' };
  const log = {
    modelVersionId: 'v1',
    requestedAt: NOW,
    predictionStats: { n: 1, min: 60, max: 60 },
  };
  const fresh = {
    modelId: 'm1',
    tag: 'Lab',
    lastValue: 100,
    lastSeenAt: new Date(NOW.getTime() - 60_000),
  };

  it('keys the deviation by model id', async () => {
    const out = await loadHeldFallbacks(prismaWith(fresh, log), [version], NOW);
    expect(out.get('m1')?.worstAbsResidual).toBe(40);
  });

  it('skips a version with no target tag without querying', async () => {
    const prisma = prismaWith(fresh, log);
    const out = await loadHeldFallbacks(
      prisma,
      [{ ...version, targetY: null }],
      NOW,
    );
    expect(out.size).toBe(0);
    expect(
      (prisma as unknown as { tagObservation: { findMany: jest.Mock } })
        .tagObservation.findMany,
    ).not.toHaveBeenCalled();
  });

  it('skips a stale held value, a missing observation and a missing log', async () => {
    const stale = {
      ...fresh,
      lastSeenAt: new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000),
    };
    expect(
      (await loadHeldFallbacks(prismaWith(stale, log), [version], NOW)).size,
    ).toBe(0);
    expect(
      (await loadHeldFallbacks(prismaWith(null, log), [version], NOW)).size,
    ).toBe(0);
    expect(
      (await loadHeldFallbacks(prismaWith(fresh, null), [version], NOW)).size,
    ).toBe(0);
  });
});
