import { InferenceWindowMonitoringService } from './inference-window-monitoring.authorized.service';
import { postToPython } from '@/lib/python-client';

// MODEL-SERVE-001-T21. `resolveColumnBaseline` (lib/artifact-baseline.ts)
// calls `postToPython` directly for `/v1/preprocess/column-stats` — mocked
// here, never letting a real network call happen, same discipline
// prediction-log.authorized.service.spec.ts already applies for the same
// dependency.
jest.mock('@/lib/python-client', () => ({
  PYTHON_TIMEOUT: { test: 15_000, metadata: 300_000, fetch: 120_000 },
  postToPython: jest.fn(),
}));
const mockedPostToPython = postToPython as jest.Mock;

afterEach(() => {
  jest.clearAllMocks();
});

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    inferenceSchedule: { findUnique: jest.fn().mockResolvedValue(null) },
    modelVersion: { findFirst: jest.fn().mockResolvedValue(null) },
    inferenceWindow: { findMany: jest.fn().mockResolvedValue([]) },
    ...overrides,
  };
}

function makeService(prisma: ReturnType<typeof buildPrisma>) {
  return new InferenceWindowMonitoringService(
    prisma as unknown as ConstructorParameters<
      typeof InferenceWindowMonitoringService
    >[0],
  );
}

const PRODUCTION_VERSION = {
  id: 'v1',
  version: 3,
  goldArtifactId: 'gold-1',
  goldObjectKey: 'models/model-1/versions/v1/gold/data.parquet',
};

const COLUMN_STATS_RESPONSE = {
  source_key: PRODUCTION_VERSION.goldObjectKey,
  column_stats_key: 'models/model-1/versions/v1/gold/column_stats.json',
  stats: {
    tag_a: {
      tag: 'tag_a',
      coverage: 1,
      null_pct: 0,
      outlier_count: 0,
      mean: 10,
      std: 2,
      percentiles: { p1: 4, p99: 16 },
      cleaned: true,
    },
  },
};

describe('InferenceWindowMonitoringService.getHealthStatus (MODEL-SERVE-001-T21)', () => {
  it('is OFF when the model has no schedule at all', async () => {
    const prisma = buildPrisma();
    const service = makeService(prisma);
    expect(await service.getHealthStatus('model-1')).toEqual({
      status: 'OFF',
      thresholds: null,
    });
    expect(mockedPostToPython).not.toHaveBeenCalled();
  });

  it('is OFF when a schedule exists but driftMonitor is false — never fetches a baseline', async () => {
    const prisma = buildPrisma({
      inferenceSchedule: {
        findUnique: jest.fn().mockResolvedValue({
          driftMonitor: false,
          warnSd: 1.5,
          criticalSd: 3.0,
          driftThresholdPct: 10,
        }),
      },
    });
    const service = makeService(prisma);
    expect(await service.getHealthStatus('model-1')).toEqual({
      status: 'OFF',
      thresholds: null,
    });
    expect(mockedPostToPython).not.toHaveBeenCalled();
  });

  it('is UNKNOWN when monitoring is on but there is no PRODUCTION version — never throws', async () => {
    const prisma = buildPrisma({
      inferenceSchedule: {
        findUnique: jest.fn().mockResolvedValue({
          driftMonitor: true,
          warnSd: 1.5,
          criticalSd: 3.0,
          driftThresholdPct: 10,
        }),
      },
      modelVersion: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    const service = makeService(prisma);
    const result = await service.getHealthStatus('model-1');
    expect(result.status).toBe('UNKNOWN');
    expect(result.thresholds).toEqual({
      warnSd: 1.5,
      criticalSd: 3.0,
      outOfRangePct: 10,
    });
  });

  it('is UNKNOWN when monitoring is on but no window carries usable featureStats yet', async () => {
    const prisma = buildPrisma({
      inferenceSchedule: {
        findUnique: jest.fn().mockResolvedValue({
          driftMonitor: true,
          warnSd: 1.5,
          criticalSd: 3.0,
          driftThresholdPct: 10,
        }),
      },
      modelVersion: {
        findFirst: jest.fn().mockResolvedValue(PRODUCTION_VERSION),
      },
      inferenceWindow: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ featureStats: null, windowStart: new Date() }]),
      },
    });
    const service = makeService(prisma);
    const result = await service.getHealthStatus('model-1');
    expect(result.status).toBe('UNKNOWN');
    expect(mockedPostToPython).not.toHaveBeenCalled();
  });

  it("uses THIS schedule's own thresholds, not env defaults, to classify a real comparison", async () => {
    mockedPostToPython.mockResolvedValue(COLUMN_STATS_RESPONSE);
    const prisma = buildPrisma({
      inferenceSchedule: {
        findUnique: jest.fn().mockResolvedValue({
          driftMonitor: true,
          // Deliberately tight — a live mean of 12 against a baseline
          // mean 10 / std 2 is z=1; warnSd here is 0.5, well below env's
          // own 1.5 default, so this only reads WARN because the
          // PER-SCHEDULE threshold was actually used.
          warnSd: 0.5,
          criticalSd: 3.0,
          driftThresholdPct: 10,
        }),
      },
      modelVersion: {
        findFirst: jest.fn().mockResolvedValue(PRODUCTION_VERSION),
      },
      inferenceWindow: {
        findMany: jest.fn().mockResolvedValue([
          {
            windowStart: new Date(),
            featureStats: {
              tag_a: { n: 10, sum: 120, sumsq: 1480, min: 8, max: 16 },
            },
          },
        ]),
      },
    });
    const service = makeService(prisma);
    const result = await service.getHealthStatus('model-1');
    expect(result.status).toBe('WARN');
  });
});
