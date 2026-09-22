import { InferenceWindowMonitoringService } from './inference-window-monitoring.authorized.service';
import { postToPython } from '@/lib/python-client';
import { env } from '@/config/env.config';
import { resetColumnBaselineCacheForTests } from '@/lib/artifact-baseline';

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
  // `resolveColumnBaseline`'s cache is MODULE-LEVEL and outlives `afterEach`
  // clearing mock CALL HISTORY — every fixture below reuses one literal
  // `goldObjectKey` across several `it()` blocks, so without this a later
  // test would silently see an earlier test's cached baseline (or its
  // `toHaveBeenCalled()` assertion on `mockedPostToPython` would fail
  // because the cache served the answer instead of calling it).
  resetColumnBaselineCacheForTests();
});

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    inferenceSchedule: { findUnique: jest.fn().mockResolvedValue(null) },
    // MODEL-SERVE-009-T03/T04. `getHealthStatus` reads the per-tag rows to
    // attach "unchanged since" beside T29's badge. Present by default so
    // the evidence path is EXERCISED rather than swallowed — a mock missing
    // this accessor would make every case here pass while the field
    // silently came back empty.
    tagObservation: { findMany: jest.fn().mockResolvedValue([]) },
    modelVersion: { findFirst: jest.fn().mockResolvedValue(null) },
    inferenceWindow: {
      findMany: jest.fn().mockResolvedValue([]),
      // MODEL-SERVE-001-T26. `resolveLivenessFaults` reads the last
      // SUCCEEDED/SKIPPED window for staleness. `new Date()` = produced just
      // now, i.e. NOT stale — so every pre-existing case in this file keeps
      // asserting the drift verdict it was written for rather than tripping
      // the new ALERT/STALE path. The fault paths get their own cases.
      findFirst: jest.fn().mockResolvedValue({ windowStart: new Date() }),
    },
    // MODEL-SERVE-012. `getHealthStatus` pools these sums for the
    // output-error axis. Present by default and EMPTY, so every pre-existing
    // case here keeps asserting the drift verdict it was written for: no
    // joined pairs means UNKNOWN, which this axis defines as silent.
    inferenceWindowTruth: { findMany: jest.fn().mockResolvedValue([]) },
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
      // T26: OFF means DELIBERATELY NOT WATCHING, so it carries no reason.
      reason: null,
      // T29: no stuck instruments to report either.
      frozenColumns: [],
      // MODEL-SERVE-009-T03: present-and-empty on every branch, the same
      // discipline T29's own review follow-up applied to frozenColumns
      // after an inferred return type let a branch omit it.
      frozenSince: [],
      thresholds: null,
      // MODEL-SERVE-012. UNKNOWN with nulls, never a zero ratio: nothing has
      // been scored, so there is no spread to report.
      residualSd: {
        status: 'UNKNOWN',
        liveSd: null,
        ratio: null,
        baselineSd: null,
        n: 0,
      },
    });
    expect(mockedPostToPython).not.toHaveBeenCalled();
  });

  it('is OFF when a schedule exists but driftMonitor is false — never fetches a baseline', async () => {
    const prisma = buildPrisma({
      inferenceSchedule: {
        findUnique: jest.fn().mockResolvedValue({
          // MODEL-SERVE-001-T26: an ENABLED schedule, with the cadence/lag
          // `isStale` needs. Absent before, because nothing on this axis
          // read them until liveness moved here.
          enabled: true,
          cadenceMinutes: 60,
          lagMinutes: 15,
          // MODEL-SERVE-001-T28's bands. Quiet defaults, so every case below
          // still asserts the drift verdict it was written for.
          skipStreakAlert: 3,
          missingPctWarn: 5,
          missingPctAlert: 20,
          frozenWindows: 3,
          frozenTolerancePct: 0,
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
      // T26: OFF means DELIBERATELY NOT WATCHING, so it carries no reason.
      reason: null,
      // T29: no stuck instruments to report either.
      frozenColumns: [],
      // MODEL-SERVE-009-T03: present-and-empty on every branch, the same
      // discipline T29's own review follow-up applied to frozenColumns
      // after an inferred return type let a branch omit it.
      frozenSince: [],
      thresholds: null,
      // MODEL-SERVE-012. UNKNOWN with nulls, never a zero ratio: nothing has
      // been scored, so there is no spread to report.
      residualSd: {
        status: 'UNKNOWN',
        liveSd: null,
        ratio: null,
        baselineSd: null,
        n: 0,
      },
    });
    expect(mockedPostToPython).not.toHaveBeenCalled();
  });

  /**
   * MODEL-SERVE-001-T29. THE CASE THAT PINS THE RESTRUCTURING. The case above
   * now passes for a WEAKER reason than its name claims: `getHealthStatus` no
   * longer returns early on `driftMonitor: false`, so its baseline is skipped
   * only because that fixture's `findMany` returns `[]` (`statsRows.length ===
   * 0`). It therefore proves "no stats, no baseline", NOT "monitoring off, no
   * baseline".
   *
   * This one supplies real `featureStats` with monitoring OFF, and asserts the
   * split T26 settled: the baseline IS fetched and a stuck instrument IS
   * reported, because frozen is a LIVENESS fact — while the drift verdict
   * stays silent, because that is the half `driftMonitor` actually gates.
   * Without this, re-adding an early return would turn Sensor Frozen off for
   * the majority of models (`driftMonitor` defaults false) with every test
   * still green.
   */
  it('reports a frozen tag with driftMonitor OFF — liveness is ungated, only the drift verdict is', async () => {
    mockedPostToPython.mockResolvedValue(COLUMN_STATS_RESPONSE);
    // Flat across all three windows: min === max === 12. The baseline's own
    // std is 2, so guard (1) — "already flat in TRAINING" — does not skip it.
    const FLAT = {
      windowStart: new Date(),
      featureStats: {
        tag_a: { n: 10, sum: 120, sumsq: 1440, min: 12, max: 12 },
      },
    };
    const prisma = buildPrisma({
      inferenceSchedule: {
        findUnique: jest.fn().mockResolvedValue({
          enabled: true,
          cadenceMinutes: 60,
          lagMinutes: 15,
          skipStreakAlert: 3,
          missingPctWarn: 5,
          missingPctAlert: 20,
          frozenWindows: 3,
          frozenTolerancePct: 0,
          // The point of the case.
          driftMonitor: false,
          warnSd: 1.5,
          criticalSd: 3.0,
          driftThresholdPct: 10,
        }),
      },
      modelVersion: {
        findFirst: jest.fn().mockResolvedValue(PRODUCTION_VERSION),
      },
      inferenceWindow: {
        findMany: jest.fn().mockResolvedValue([FLAT, FLAT, FLAT]),
        findFirst: jest.fn().mockResolvedValue({ windowStart: new Date() }),
      },
    });
    const service = makeService(prisma);
    const result = await service.getHealthStatus('model-1');

    expect(result.status).toBe('FROZEN');
    expect(result.reason).toBe('SENSOR_FROZEN');
    expect(result.frozenColumns).toEqual(['tag_a']);
    // The baseline IS fetched with monitoring off — frozen needs it for
    // guard (1) and for the eps range.
    expect(mockedPostToPython).toHaveBeenCalled();
    // ...but no drift claim rides along: `thresholds` is null exactly when
    // `driftMonitor` is false.
    expect(result.thresholds).toBeNull();
  });

  it('is UNKNOWN when monitoring is on but there is no PRODUCTION version — never throws', async () => {
    const prisma = buildPrisma({
      inferenceSchedule: {
        findUnique: jest.fn().mockResolvedValue({
          // MODEL-SERVE-001-T26: an ENABLED schedule, with the cadence/lag
          // `isStale` needs. Absent before, because nothing on this axis
          // read them until liveness moved here.
          enabled: true,
          cadenceMinutes: 60,
          lagMinutes: 15,
          // MODEL-SERVE-001-T28's bands. Quiet defaults, so every case below
          // still asserts the drift verdict it was written for.
          skipStreakAlert: 3,
          missingPctWarn: 5,
          missingPctAlert: 20,
          frozenWindows: 3,
          frozenTolerancePct: 0,
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
          // MODEL-SERVE-001-T26: an ENABLED schedule, with the cadence/lag
          // `isStale` needs. Absent before, because nothing on this axis
          // read them until liveness moved here.
          enabled: true,
          cadenceMinutes: 60,
          lagMinutes: 15,
          // MODEL-SERVE-001-T28's bands. Quiet defaults, so every case below
          // still asserts the drift verdict it was written for.
          skipStreakAlert: 3,
          missingPctWarn: 5,
          missingPctAlert: 20,
          frozenWindows: 3,
          frozenTolerancePct: 0,
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
        // Produced just now — not stale, so this case still asserts UNKNOWN.
        findFirst: jest.fn().mockResolvedValue({ windowStart: new Date() }),
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
          // MODEL-SERVE-001-T26: an ENABLED schedule, with the cadence/lag
          // `isStale` needs. Absent before, because nothing on this axis
          // read them until liveness moved here.
          enabled: true,
          cadenceMinutes: 60,
          lagMinutes: 15,
          // MODEL-SERVE-001-T28's bands. Quiet defaults, so every case below
          // still asserts the drift verdict it was written for.
          skipStreakAlert: 3,
          missingPctWarn: 5,
          missingPctAlert: 20,
          frozenWindows: 3,
          frozenTolerancePct: 0,
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
        findFirst: jest.fn().mockResolvedValue({ windowStart: new Date() }),
      },
    });
    const service = makeService(prisma);
    const result = await service.getHealthStatus('model-1');
    expect(result.status).toBe('WARN');
  });
});

describe('InferenceWindowMonitoringService.getDriftReport', () => {
  // The window-plane twin of the assertion in
  // prediction-log.authorized.service.spec.ts. The panel's status tooltip
  // explains a verdict by naming the threshold that produced it, and the
  // client type makes `basis.thresholds` optional — so a plane that
  // quietly stopped sending them would leave every tooltip on THIS plane
  // (the one a scheduled model uses) with no criteria and no failure.
  it('publishes the thresholds the comparison used', async () => {
    mockedPostToPython.mockResolvedValue(COLUMN_STATS_RESPONSE);
    const prisma = buildPrisma({
      modelVersion: {
        findFirst: jest.fn().mockResolvedValue(PRODUCTION_VERSION),
      },
      inferenceWindow: {
        findMany: jest.fn().mockResolvedValue([
          {
            windowStart: new Date(),
            featureStats: {
              tag_a: { n: 10, sum: 100, sumsq: 1040, min: 8, max: 12 },
            },
          },
        ]),
        findFirst: jest.fn().mockResolvedValue({ windowStart: new Date() }),
      },
    });

    const service = makeService(prisma);
    const result = await service.getDriftReport(
      'model-1',
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T01:00:00.000Z',
    );

    expect(result.data.basis.thresholds).toEqual({
      warnSd: env.DRIFT_WARN_SD,
      criticalSd: env.DRIFT_CRITICAL_SD,
      outOfRangePct: env.DRIFT_OUT_OF_RANGE_PCT,
    });
  });
});
