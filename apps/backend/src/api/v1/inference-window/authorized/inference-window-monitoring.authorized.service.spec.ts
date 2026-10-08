import { InferenceWindowMonitoringService } from './inference-window-monitoring.authorized.service';
import { postToPython } from '@/lib/python-client';
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
  sourceRun: { targetY: 'y_lab' },
};

const COLUMN_STATS_RESPONSE = {
  source_key: PRODUCTION_VERSION.goldObjectKey,
  column_stats_key: 'models/model-1/versions/v1/gold/column_stats.json',
  stats: {
    y_lab: {
      tag: 'y_lab',
      coverage: 1,
      null_pct: 0,
      outlier_count: 0,
      mean: 50,
      std: 5,
      percentiles: { p1: 40, p99: 60 },
      cleaned: true,
    },
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
      // MODEL-SERVE-031. No PSI evidence on this branch.
      psiSummary: null,
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
      // MODEL-SERVE-028. The schedule residual-SD bands, echoed whether or
      // not drift watching is on (residual-SD is not gated by it).
      thresholds: { warnSd: 1.5, criticalSd: 3.0 },
      // MODEL-SERVE-031. driftMonitor off means no PSI evidence.
      psiSummary: null,
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
    // MODEL-SERVE-028. `thresholds` are the residual-SD bands now, not a
    // drift claim, so they ride along with monitoring off too.
    expect(result.thresholds).toEqual({ warnSd: 1.5, criticalSd: 3.0 });
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
    });
  });

  it('is UNKNOWN when monitoring is on but no window carries featureStats or histograms yet', async () => {
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

  it('grades drift by PSI alone: a PSI WARN over the rolling windows reads WARN/DRIFT_WARN (MODEL-SERVE-028)', async () => {
    mockedPostToPython.mockImplementation((path: string) =>
      Promise.resolve(
        path === '/v1/preprocess/feature-spec'
          ? {
              source_key: PRODUCTION_VERSION.goldObjectKey,
              feature_spec_key: 'feature_spec.json',
              spec: {
                psiRefEdges: { tag_a: [0, 1, 2] },
                psiBinCount: { tag_a: 2 },
                psiBinMode: { tag_a: 'continuous' },
                psiRefCounts: { tag_a: [50, 50] },
              },
            }
          : COLUMN_STATS_RESPONSE,
      ),
    );
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
          driftMonitor: true,
          warnSd: 1.5,
          criticalSd: 3.0,
        }),
      },
      modelVersion: {
        findFirst: jest.fn().mockResolvedValue(PRODUCTION_VERSION),
      },
      inferenceWindow: {
        findMany: jest.fn().mockResolvedValue([
          {
            windowStart: new Date(),
            // A large mean shift on featureStats. It must NOT matter: the
            // z-score axis is gone, and only the histogram below grades.
            featureStats: {
              tag_a: { n: 10, sum: 1000, sumsq: 100_010, min: 99, max: 101 },
            },
            // 70/30 against a 50/50 reference -> PSI ~0.17, WARN (0.1-0.25).
            featureHistograms: {
              tag_a: { counts: [70, 30], below: 0, above: 0 },
            },
          },
        ]),
        findFirst: jest.fn().mockResolvedValue({ windowStart: new Date() }),
      },
    });
    const service = makeService(prisma);
    const result = await service.getHealthStatus('model-1');
    expect(result).toMatchObject({ status: 'WARN', reason: 'DRIFT_WARN' });
    // The schedule bands are echoed as the residual-SD thresholds.
    expect(result.thresholds).toEqual({ warnSd: 1.5, criticalSd: 3.0 });
  });

  it('is UNKNOWN when windows carry histograms but the artifact has no PSI reference', async () => {
    mockedPostToPython.mockImplementation((path: string) =>
      Promise.resolve(
        path === '/v1/preprocess/feature-spec'
          ? {
              source_key: PRODUCTION_VERSION.goldObjectKey,
              feature_spec_key: 'feature_spec.json',
              spec: {},
            }
          : COLUMN_STATS_RESPONSE,
      ),
    );
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
          driftMonitor: true,
          warnSd: 1.5,
          criticalSd: 3.0,
        }),
      },
      modelVersion: {
        findFirst: jest.fn().mockResolvedValue(PRODUCTION_VERSION),
      },
      inferenceWindow: {
        findMany: jest.fn().mockResolvedValue([
          {
            windowStart: new Date(),
            featureStats: null,
            featureHistograms: {
              tag_a: { counts: [70, 30], below: 0, above: 0 },
            },
          },
        ]),
        findFirst: jest.fn().mockResolvedValue({ windowStart: new Date() }),
      },
    });
    const result = await makeService(prisma).getHealthStatus('model-1');
    expect(result).toMatchObject({ status: 'UNKNOWN', reason: null });
  });
});

describe('InferenceWindowMonitoringService target row (MODEL-SERVE-018)', () => {
  function prismaWith(windows: Array<Record<string, unknown>>) {
    return buildPrisma({
      modelVersion: {
        findFirst: jest.fn().mockResolvedValue(PRODUCTION_VERSION),
      },
      inferenceWindow: {
        findMany: jest.fn().mockResolvedValue(windows),
        findFirst: jest.fn().mockResolvedValue({ windowStart: new Date() }),
      },
    });
  }
  const WINDOW = {
    windowStart: new Date(),
    status: 'SUCCEEDED',
    inputRows: 10,
    featureStats: {
      tag_a: { n: 10, sum: 100, sumsq: 1040, min: 8, max: 12 },
    },
  };

  it('PSI target is null when no window carries a target histogram', async () => {
    mockedPostToPython.mockRejectedValue(new Error('no spec'));
    const service = makeService(
      prismaWith([
        { ...WINDOW, featureHistograms: null, targetHistogram: null },
      ]),
    );

    const { data } = await service.getPsiReport(
      'model-1',
      '2026-01-01',
      '2026-01-02',
    );

    expect(data.targetColumn).toBe('y_lab');
    expect(data.target).toBeNull();
  });
});
