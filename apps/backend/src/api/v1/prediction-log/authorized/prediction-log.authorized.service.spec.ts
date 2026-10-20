/* eslint-disable @typescript-eslint/unbound-method -- expect(mock.method) never calls it */
import { PredictionLogAuthorizedService } from './prediction-log.authorized.service';
import { resetColumnBaselineCacheForTests } from '@/lib/artifact-baseline';
import * as pythonClient from '@/lib/python-preprocess-client';
import { env } from '@/config/env.config';
import type { InferenceWindowMonitoringService } from '@/api/v1/inference-window/authorized/inference-window-monitoring.authorized.service';

jest.mock('@/lib/python-preprocess-client');
// `postToPython` is never called by getInputDriftService directly
// (it goes through `readFeatureSpec`'s own
// postToPython call inside python-preprocess-client/lib/artifact-baseline,
// already covered by the mock above) — mocked here only so importing
// '@/lib/python-client' at all (a transitive import of the service under
// test) never reaches a real network call during this suite.
jest.mock('@/lib/python-client', () => ({
  PYTHON_TIMEOUT: { test: 15_000, metadata: 300_000, fetch: 120_000 },
  postToPython: jest.fn(),
}));

const mockedReadFeatureSpec = pythonClient.readFeatureSpec as jest.Mock;
const mockedPredictionLogSeries = pythonClient.predictionLogSeries as jest.Mock;

// MODEL-SERVE-001-T17. `hasSchedule` defaults `false` so every EXISTING
// test below (none of which configures a schedule) keeps exercising the
// exact `/predict`-plane code path it always has — the dispatch this task
// adds is opt-IN per model, never a change to a model with no schedule.
// `mockResolvedValue` (not `mockResolvedValueOnce`) survives
// `jest.clearAllMocks()` below (that clears call history, not the
// implementation), so this one setup line is enough for the whole file.
// Typed at the declaration site (rather than `as never` at each of the 8
// call sites below) so every call site passes it as a plain, pre-typed
// value — one cast, not eight.
const mockWindowMonitoring = {
  hasSchedule: jest.fn().mockResolvedValue(false),
  getInputDriftReport: jest.fn(),
} as unknown as InferenceWindowMonitoringService;

const ADMIN: Auth.UserPayload = {
  id: 'u1',
  role: 'ADMIN',
} as Auth.UserPayload;

const PRODUCTION_VERSION = {
  id: 'v1',
  version: 3,
  goldArtifactId: 'gold-1',
  goldObjectKey: 'models/model-1/versions/v1/gold/data.parquet',
};

function makePrisma(overrides: {
  model?: Record<string, unknown> | null;
  productionVersion?: Record<string, unknown> | null;
  predictionLogs?: Array<Record<string, unknown>>;
  schedule?: Record<string, unknown> | null;
}) {
  const model =
    overrides.model === undefined ? { id: 'model-1' } : overrides.model;
  const productionVersion =
    overrides.productionVersion === undefined
      ? PRODUCTION_VERSION
      : overrides.productionVersion;
  const predictionLogs = overrides.predictionLogs ?? [];

  return {
    model: { findUnique: jest.fn().mockResolvedValue(model) },
    modelVersion: { findFirst: jest.fn().mockResolvedValue(productionVersion) },
    predictionLog: {
      findMany: jest.fn().mockResolvedValue(predictionLogs),
      create: jest.fn().mockResolvedValue({ id: 'log-1' }),
    },
    // MODEL-SERVE-008-T06. The prediction series reads this row; `null` is the honest default —
    // a model with no schedule at all.
    inferenceSchedule: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          overrides.schedule === undefined ? null : overrides.schedule,
        ),
    },
  };
}

const RANGE = {
  from: '2026-01-01T00:00:00.000Z',
  to: '2026-01-02T00:00:00.000Z',
};

/** `jest.fn()` (no generic) makes `.mock.calls` `any[][]` — indexing into
 *  it twice chains TWO unsafe-member-access lint findings before a cast on
 *  the final expression can suppress either. Casting `.mock.calls` itself
 *  ONCE, before any indexing, keeps every step after this point a real
 *  type instead. */
function createCallArgs(prisma: ReturnType<typeof makePrisma>): {
  data: { featureHistograms: unknown };
} {
  const calls = prisma.predictionLog.create.mock.calls as unknown as Array<
    [{ data: { featureHistograms: unknown } }]
  >;
  return calls[0][0];
}

beforeEach(() => {
  jest.clearAllMocks();
  // `resolveDriftReference`'s cache is MODULE-LEVEL and outlives per-test
  // mock clearing. Every drift test in this file reuses one literal
  // `goldObjectKey` (`PRODUCTION_VERSION.goldObjectKey`) — see the same
  // note in inference-window-monitoring.authorized.service.spec.ts.
  resetColumnBaselineCacheForTests();
});

// ── ingestPredictionLogService: featureHistograms round-trip ──────────────

describe('PredictionLogAuthorizedService.ingestPredictionLogService', () => {
  const BASE_DTO = {
    modelId: 'model-1',
    modelVersionId: 'v1',
    requestedAt: '2026-01-01T00:00:00.000Z',
    rowCount: 1,
    loggedRows: 1,
    samplingRate: 1,
    rows: [{ features: { A: 1 }, prediction: 1 }],
    featureStats: { A: { n: 1, sum: 1, sumsq: 1, min: 1, max: 1 } },
    predictionStats: { n: 1, sum: 1, sumsq: 1, min: 1, max: 1 },
  };

  it('writes a real object (not JS null) when featureHistograms is present', async () => {
    const prisma = makePrisma({});
    const service = new PredictionLogAuthorizedService(
      prisma as never,
      mockWindowMonitoring,
    );
    await service.ingestPredictionLogService({
      ...BASE_DTO,
      featureHistograms: { A: { counts: [1], below: 0, above: 0 } },
    });

    const writeArgs = createCallArgs(prisma);
    expect(writeArgs.data.featureHistograms).toEqual({
      A: { counts: [1], below: 0, above: 0 },
    });
  });

  it('writes PrismaTypes.DbNull (not a bare JS null) when featureHistograms is null', async () => {
    const prisma = makePrisma({});
    const service = new PredictionLogAuthorizedService(
      prisma as never,
      mockWindowMonitoring,
    );
    await service.ingestPredictionLogService({
      ...BASE_DTO,
      featureHistograms: null,
    });

    const writeArgs = createCallArgs(prisma);
    // Prisma's DbNull sentinel is a class instance, not `null` itself —
    // asserting it is NOT the bare JS value is the regression this guards:
    // a plain `null` here would previously either be silently coerced or
    // rejected by the generated client, never correctly written as SQL NULL.
    expect(writeArgs.data.featureHistograms).not.toBeNull();
    expect(writeArgs.data.featureHistograms).toBeDefined();
  });
});

// ── getInputDriftService ───────────────────────────────────────────────────────

describe('PredictionLogAuthorizedService.getInputDriftService', () => {
  it('refuses (404) when the model has no PRODUCTION version', async () => {
    const prisma = makePrisma({ productionVersion: null });
    const service = new PredictionLogAuthorizedService(
      prisma as never,
      mockWindowMonitoring,
    );
    await expect(
      service.getInputDriftService('model-1', RANGE, ADMIN),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  const SPEC = {
    source_key: PRODUCTION_VERSION.goldObjectKey,
    feature_spec_key: 'feature_spec.json',
    spec: {
      psiRefEdges: { X: [0, 5, 10], V: [0, 1, 2] },
      psiBinCount: { X: 2, V: 3 },
      psiBinMode: { X: 'continuous', V: 'categorical' },
      psiRefCounts: { X: [50, 50], V: [10, 10, 10] },
    },
  };
  /** 40 logged rows, one a minute from 05:00 UTC: X steps 1..40 / 4 (so
   *  0.25..10), with the last 4 pushed above the training max of 10. */
  const ROWS = Array.from({ length: 40 }, (_, i) => ({
    timestamp: new Date(Date.UTC(2026, 0, 1, 5, i)).toISOString(),
    prediction: 1,
    features: { X: i >= 36 ? 12 : (i + 1) / 4, V: i === 0 ? 2.4 : 1 },
  }));

  it('grades each tag from the logged rows its trend is drawn from (MODEL-SERVE-036)', async () => {
    const prisma = makePrisma({});
    mockedReadFeatureSpec.mockResolvedValue(SPEC);
    mockedPredictionLogSeries.mockResolvedValue({
      points: ROWS,
      truncated: false,
    });

    const service = new PredictionLogAuthorizedService(
      prisma as never,
      mockWindowMonitoring,
    );
    const result = await service.getInputDriftService('model-1', RANGE, ADMIN);

    expect(mockedPredictionLogSeries).toHaveBeenCalledWith({
      model_id: 'model-1',
      model_version_id: PRODUCTION_VERSION.id,
      from: RANGE.from,
      to: RANGE.to,
    });
    const byName = Object.fromEntries(
      result.data.columns.map((c) => [c.column, c]),
    );
    // 4 of 40 above the max -> 10%, WARN.
    expect(byName.X).toMatchObject({
      status: 'WARN',
      above: 4,
      below: 0,
      outOfRangePct: 10,
      trainMin: 0,
      trainMax: 10,
    });
    // Categorical half-gap tolerance: 2.4 is within 0.5 of state 2 -> in.
    expect(byName.V).toMatchObject({ status: 'OK', above: 0 });
    expect(result.data.series.X.points).toHaveLength(40);
    expect(
      result.data.series.X.points.filter((p) => p.outOfRange > 0),
    ).toHaveLength(4);
    expect(result.data.series.X.windows[0]).toMatchObject({ n: 40, above: 4 });
    expect(result.data.basis).toMatchObject({
      plane: 'predict',
      modelVersionId: PRODUCTION_VERSION.id,
      version: PRODUCTION_VERSION.version,
      windowsUsed: 1,
      capped: false,
      thresholds: {
        outOfRangeWarnPct: env.INPUT_DRIFT_OUT_OF_RANGE_WARN_PCT,
        outOfRangeCriticalPct: env.INPUT_DRIFT_OUT_OF_RANGE_CRITICAL_PCT,
        minSamples: env.INPUT_DRIFT_MIN_SAMPLES,
      },
    });
  });

  it('cuts a range longer than 31 days to the newest 31 and says so', async () => {
    const prisma = makePrisma({});
    mockedReadFeatureSpec.mockResolvedValue(SPEC);
    mockedPredictionLogSeries.mockResolvedValue({
      points: [],
      truncated: false,
    });

    const service = new PredictionLogAuthorizedService(
      prisma as never,
      mockWindowMonitoring,
    );
    const result = await service.getInputDriftService(
      'model-1',
      { from: '2025-01-01T00:00:00.000Z', to: '2026-01-02T00:00:00.000Z' },
      ADMIN,
    );

    expect(result.data.basis.capped).toBe(true);
    expect(result.data.basis.from).toBe('2025-12-02T00:00:00.000Z');
  });

  it('reports every column UNKNOWN, never throws, when feature_spec.json is unavailable', async () => {
    const prisma = makePrisma({});
    mockedReadFeatureSpec.mockRejectedValue(new Error('object not found'));
    mockedPredictionLogSeries.mockResolvedValue({
      points: ROWS,
      truncated: false,
    });

    const service = new PredictionLogAuthorizedService(
      prisma as never,
      mockWindowMonitoring,
    );
    const result = await service.getInputDriftService('model-1', RANGE, ADMIN);

    expect(result.data.columns.map((c) => c.status)).toEqual([
      'UNKNOWN',
      'UNKNOWN',
    ]);
    expect(result.data.columns[0].reason).toMatch(/no training range/);
    // The trend is still there to look at.
    expect(result.data.series.X.points).toHaveLength(40);
  });
});

// ── MODEL-SERVE-001-T17: plane dispatch ────────────────────────────────────

describe('PredictionLogAuthorizedService plane dispatch', () => {
  it('getInputDriftService delegates to the window plane when a schedule exists, and never touches PredictionLog', async () => {
    const prisma = makePrisma({});
    const windowMonitoring = {
      hasSchedule: jest.fn().mockResolvedValue(true),
      getInputDriftReport: jest.fn().mockResolvedValue({
        statusCode: 200,
        message: 'Input drift report fetched',
        type: 'SUCCESS',
        data: { status: 'OK', columns: [], basis: { plane: 'window' } },
      }),
    } as unknown as InferenceWindowMonitoringService;

    const service = new PredictionLogAuthorizedService(
      prisma as never,
      windowMonitoring,
    );
    const result = await service.getInputDriftService('model-1', RANGE, ADMIN);

    expect(windowMonitoring.getInputDriftReport).toHaveBeenCalledWith(
      'model-1',
      RANGE.from,
      RANGE.to,
    );
    expect(result.data.basis).toMatchObject({ plane: 'window' });
    // The defining behaviour of a DISPATCH, not merely an alternative path
    // that also runs: the /predict-plane query must never fire once the
    // window plane has been chosen.
    expect(prisma.modelVersion.findFirst).not.toHaveBeenCalled();
    expect(prisma.predictionLog.findMany).not.toHaveBeenCalled();
  });

  it('getInputDriftService stays on the /predict plane when no schedule exists', async () => {
    const prisma = makePrisma({});
    mockedReadFeatureSpec.mockResolvedValue({
      source_key: PRODUCTION_VERSION.goldObjectKey,
      feature_spec_key: 'feature_spec.json',
      spec: {},
    });
    mockedPredictionLogSeries.mockResolvedValue({
      points: [],
      truncated: false,
    });
    const windowMonitoring = {
      hasSchedule: jest.fn().mockResolvedValue(false),
      getInputDriftReport: jest.fn(),
    } as unknown as InferenceWindowMonitoringService;

    const service = new PredictionLogAuthorizedService(
      prisma as never,
      windowMonitoring,
    );
    await service.getInputDriftService('model-1', RANGE, ADMIN);

    expect(windowMonitoring.getInputDriftReport).not.toHaveBeenCalled();
    expect(mockedPredictionLogSeries).toHaveBeenCalled();
  });
});
