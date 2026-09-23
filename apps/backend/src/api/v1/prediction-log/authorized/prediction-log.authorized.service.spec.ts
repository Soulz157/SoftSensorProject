import { PredictionLogAuthorizedService } from './prediction-log.authorized.service';
import { resetColumnBaselineCacheForTests } from '@/lib/artifact-baseline';
import * as pythonClient from '@/lib/python-preprocess-client';
import { env } from '@/config/env.config';
import type { InferenceWindowMonitoringService } from '@/api/v1/inference-window/authorized/inference-window-monitoring.authorized.service';

jest.mock('@/lib/python-preprocess-client');
// `postToPython` is never called by getPsiService/getDriftService directly
// (both go through `readFeatureSpec`/`resolveColumnBaseline`'s own
// postToPython call inside python-preprocess-client/lib/artifact-baseline,
// already covered by the mock above) — mocked here only so importing
// '@/lib/python-client' at all (a transitive import of the service under
// test) never reaches a real network call during this suite.
jest.mock('@/lib/python-client', () => ({
  PYTHON_TIMEOUT: { test: 15_000, metadata: 300_000, fetch: 120_000 },
  postToPython: jest.fn(),
}));

const mockedReadFeatureSpec = pythonClient.readFeatureSpec as jest.Mock;

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
  getDriftReport: jest.fn(),
  getPsiReport: jest.fn(),
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
    // MODEL-SERVE-008-T03/T06. Both the live-drift readout and the
    // prediction series read this row now; `null` is the honest default —
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
  // `resolveColumnBaseline`'s cache is MODULE-LEVEL and outlives per-test
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

// ── getPsiService ───────────────────────────────────────────────────────

describe('PredictionLogAuthorizedService.getPsiService', () => {
  it('refuses (404) when the model has no PRODUCTION version', async () => {
    const prisma = makePrisma({ productionVersion: null });
    const service = new PredictionLogAuthorizedService(
      prisma as never,
      mockWindowMonitoring,
    );
    await expect(
      service.getPsiService('model-1', RANGE, ADMIN),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('pools PredictionLog.featureHistograms and computes PSI against the resolved reference', async () => {
    const prisma = makePrisma({
      predictionLogs: [
        { featureHistograms: { X: { counts: [200], below: 0, above: 0 } } },
        { featureHistograms: { X: { counts: [200], below: 0, above: 0 } } },
      ],
    });
    mockedReadFeatureSpec.mockResolvedValue({
      source_key: PRODUCTION_VERSION.goldObjectKey,
      feature_spec_key: 'feature_spec.json',
      spec: {
        psiRefEdges: { X: [0, 1] },
        psiBinCount: { X: 1 },
        psiBinMode: { X: 'continuous' },
        psiRefCounts: { X: [400] },
      },
    });

    const service = new PredictionLogAuthorizedService(
      prisma as never,
      mockWindowMonitoring,
    );
    const result = await service.getPsiService('model-1', RANGE, ADMIN);

    expect(mockedReadFeatureSpec).toHaveBeenCalledWith(
      PRODUCTION_VERSION.goldObjectKey,
    );
    expect(result.data.columns[0]).toMatchObject({
      column: 'X',
      status: 'OK',
    });
    expect(result.data.columns[0].psi).toBeCloseTo(0, 5);
    expect(result.data.basis).toMatchObject({
      modelVersionId: PRODUCTION_VERSION.id,
      version: PRODUCTION_VERSION.version,
      sampleRequests: 2,
      // T16: both rows carried a histogram, so the honest count equals the
      // raw row count here — the two only diverge once a null row exists
      // (see the null-filtering test below).
      histogramRequests: 2,
      thresholds: { warn: 0.1, critical: 0.25, minSamplesPerBin: 20 },
    });
    expect(result.data.basis.epsilon).toBeGreaterThan(0);
    // The disclaimer text reads these numbers rather than a literal — they
    // must be the SAME thresholds `computePsi` was actually called with,
    // not merely present.
    expect(result.data.basis.thresholds.warn).toBe(env.PSI_WARN);
    expect(result.data.basis.thresholds.critical).toBe(env.PSI_CRITICAL);
    expect(result.data.basis.thresholds.minSamplesPerBin).toBe(
      env.PSI_MIN_SAMPLES_PER_BIN,
    );
  });

  it('filters out a row-level null featureHistograms before pooling, without throwing', async () => {
    const prisma = makePrisma({
      predictionLogs: [
        { featureHistograms: null }, // a request logged before T13
        { featureHistograms: { X: { counts: [500], below: 0, above: 0 } } },
      ],
    });
    mockedReadFeatureSpec.mockResolvedValue({
      source_key: PRODUCTION_VERSION.goldObjectKey,
      feature_spec_key: 'feature_spec.json',
      spec: {
        psiRefEdges: { X: [0, 1] },
        psiBinCount: { X: 1 },
        psiBinMode: { X: 'continuous' },
        psiRefCounts: { X: [500] },
      },
    });

    const service = new PredictionLogAuthorizedService(
      prisma as never,
      mockWindowMonitoring,
    );
    const result = await service.getPsiService('model-1', RANGE, ADMIN);

    expect(result.data.columns[0].status).toBe('OK');
    expect(result.data.basis.sampleRequests).toBe(2); // total rows, not filtered count
    // T16: `histogramRequests` is the HONEST figure — one row's histogram
    // was null and never fed `poolHistograms`. `sampleRequests` overstates
    // this by construction (captured before the filter); the two must
    // diverge here or the distinction has no test coverage at all.
    expect(result.data.basis.histogramRequests).toBe(1);
    expect(result.data.basis.histogramRequests).toBeLessThanOrEqual(
      result.data.basis.sampleRequests,
    );
  });

  it('reports every column UNKNOWN, never throws, when feature_spec.json is unavailable', async () => {
    const prisma = makePrisma({
      predictionLogs: [
        { featureHistograms: { X: { counts: [500], below: 0, above: 0 } } },
      ],
    });
    mockedReadFeatureSpec.mockRejectedValue(new Error('object not found'));

    const service = new PredictionLogAuthorizedService(
      prisma as never,
      mockWindowMonitoring,
    );
    const result = await service.getPsiService('model-1', RANGE, ADMIN);

    expect(result.data.columns[0].status).toBe('UNKNOWN');
    expect(result.data.columns[0].reason).toMatch(/no training reference/);
  });

  it('skips a tag whose reference is missing any of the four required fields', async () => {
    const prisma = makePrisma({
      predictionLogs: [
        {
          featureHistograms: {
            COMPLETE: { counts: [500], below: 0, above: 0 },
            PARTIAL: { counts: [500], below: 0, above: 0 },
          },
        },
      ],
    });
    mockedReadFeatureSpec.mockResolvedValue({
      source_key: PRODUCTION_VERSION.goldObjectKey,
      feature_spec_key: 'feature_spec.json',
      spec: {
        psiRefEdges: { COMPLETE: [0, 1], PARTIAL: [0, 1] },
        psiBinCount: { COMPLETE: 1, PARTIAL: 1 },
        psiBinMode: { COMPLETE: 'continuous' }, // PARTIAL missing here
        psiRefCounts: { COMPLETE: [500], PARTIAL: [500] },
      },
    });

    const service = new PredictionLogAuthorizedService(
      prisma as never,
      mockWindowMonitoring,
    );
    const result = await service.getPsiService('model-1', RANGE, ADMIN);

    const complete = result.data.columns.find((c) => c.column === 'COMPLETE');
    const partial = result.data.columns.find((c) => c.column === 'PARTIAL');
    expect(complete?.status).toBe('OK');
    expect(partial?.status).toBe('UNKNOWN');
    expect(partial?.reason).toMatch(/no training reference/);
  });
});

// ── MODEL-SERVE-001-T17: plane dispatch ────────────────────────────────────

describe('PredictionLogAuthorizedService plane dispatch', () => {
  it('getDriftService delegates to the window plane when a schedule exists, and never touches PredictionLog', async () => {
    const prisma = makePrisma({});
    const windowMonitoring = {
      hasSchedule: jest.fn().mockResolvedValue(true),
      getDriftReport: jest.fn().mockResolvedValue({
        statusCode: 200,
        message: 'Drift report fetched',
        type: 'SUCCESS',
        data: { status: 'OK', columns: [], basis: { plane: 'window' } },
      }),
      getPsiReport: jest.fn(),
    } as unknown as InferenceWindowMonitoringService;

    const service = new PredictionLogAuthorizedService(
      prisma as never,
      windowMonitoring,
    );
    const result = await service.getDriftService('model-1', RANGE, ADMIN);

    expect(windowMonitoring.getDriftReport).toHaveBeenCalledWith(
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

  it('getPsiService stays on the /predict plane when no schedule exists', async () => {
    const prisma = makePrisma({ predictionLogs: [] });
    mockedReadFeatureSpec.mockResolvedValue({
      source_key: PRODUCTION_VERSION.goldObjectKey,
      feature_spec_key: 'feature_spec.json',
      spec: {},
    });
    const windowMonitoring = {
      hasSchedule: jest.fn().mockResolvedValue(false),
      getDriftReport: jest.fn(),
      getPsiReport: jest.fn(),
    } as unknown as InferenceWindowMonitoringService;

    const service = new PredictionLogAuthorizedService(
      prisma as never,
      windowMonitoring,
    );
    await service.getPsiService('model-1', RANGE, ADMIN);

    expect(windowMonitoring.getPsiReport).not.toHaveBeenCalled();
    expect(prisma.predictionLog.findMany).toHaveBeenCalled();
  });

  // The drift basis echoes the thresholds `computeDrift` actually ran
  // with, exactly as the PSI basis above already does. The panel's status
  // tooltip reads THESE to explain a verdict, and the client type makes
  // them optional — so a service that silently stopped sending them would
  // degrade every tooltip to no criteria at all with nothing failing
  // anywhere. This is that failure.
  it('getDriftService publishes the thresholds the comparison used', async () => {
    const prisma = makePrisma({ predictionLogs: [] });
    const service = new PredictionLogAuthorizedService(
      prisma as never,
      mockWindowMonitoring,
    );

    const result = await service.getDriftService('model-1', RANGE, ADMIN);

    expect(result.data.basis.thresholds).toEqual({
      warnSd: env.DRIFT_WARN_SD,
      criticalSd: env.DRIFT_CRITICAL_SD,
    });
  });
});

// ── MODEL-SERVE-008-T03: the dense live-drift readout ──────────────────────

/**
 * The consecutive-breach RULE itself is exhaustively covered in
 * `lib/prediction-drift.spec.ts` (10 cases, including every UNKNOWN path).
 * These tests own the part only the service can get wrong: bucketing the
 * dense stream at the model's own live cadence, leaving `/drift`'s plane
 * dispatch alone, and labelling the basis so a caller cannot render this
 * readout as the other one.
 */
describe('PredictionLogAuthorizedService.getLiveDriftService (MODEL-SERVE-008-T03)', () => {
  const stats = (mean: number) => ({
    X: { n: 10, sum: mean * 10, sumsq: mean * mean * 10, min: mean, max: mean },
  });

  it('buckets the dense stream at the live cadence — four rows ten minutes apart are four buckets, not one pool', async () => {
    const prisma = makePrisma({
      schedule: { livePredictEnabled: true, livePredictCadenceMinutes: 10 },
      predictionLogs: [
        {
          featureStats: stats(1),
          requestedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        {
          featureStats: stats(1),
          requestedAt: new Date('2026-01-01T00:10:00.000Z'),
        },
        {
          featureStats: stats(1),
          requestedAt: new Date('2026-01-01T00:20:00.000Z'),
        },
        {
          featureStats: stats(1),
          requestedAt: new Date('2026-01-01T00:30:00.000Z'),
        },
      ],
    });
    const service = new PredictionLogAuthorizedService(
      prisma as never,
      mockWindowMonitoring,
    );

    const result = await service.getLiveDriftService('model-1', RANGE, ADMIN);

    // Pooling the range would report ONE bucket and make "sustained right
    // now" unanswerable — which is the whole reason this route exists.
    expect(result.data.bucketsEvaluated).toBe(4);
    expect(result.data.basis.bucketMinutes).toBe(10);
  });

  it('pools rows that fall INSIDE one cadence into a single bucket', async () => {
    const prisma = makePrisma({
      schedule: { livePredictEnabled: true, livePredictCadenceMinutes: 10 },
      predictionLogs: [
        {
          featureStats: stats(1),
          requestedAt: new Date('2026-01-01T00:01:00.000Z'),
        },
        {
          featureStats: stats(1),
          requestedAt: new Date('2026-01-01T00:02:00.000Z'),
        },
        {
          featureStats: stats(1),
          requestedAt: new Date('2026-01-01T00:03:00.000Z'),
        },
      ],
    });
    const service = new PredictionLogAuthorizedService(
      prisma as never,
      mockWindowMonitoring,
    );

    const result = await service.getLiveDriftService('model-1', RANGE, ADMIN);

    expect(result.data.bucketsEvaluated).toBe(1);
    expect(result.data.basis.sampleRequests).toBe(3);
  });

  it('NEVER dispatches to the window plane, even when a schedule exists — this route is the dense one by definition', async () => {
    const prisma = makePrisma({
      schedule: { livePredictEnabled: true, livePredictCadenceMinutes: 10 },
      predictionLogs: [
        {
          featureStats: stats(1),
          requestedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
    });
    const windowMonitoring = {
      hasSchedule: jest.fn().mockResolvedValue(true),
      getDriftReport: jest.fn(),
      getPsiReport: jest.fn(),
    } as unknown as InferenceWindowMonitoringService;
    const service = new PredictionLogAuthorizedService(
      prisma as never,
      windowMonitoring,
    );

    const result = await service.getLiveDriftService('model-1', RANGE, ADMIN);

    // /drift keeps T17's dispatch; this route must not inherit it, or the
    // dense signal would silently become the hourly one.
    expect(windowMonitoring.getDriftReport).not.toHaveBeenCalled();
    expect(result.data.basis.plane).toBe('predict-live');
  });

  it('labels a THIRD plane, never reusing the /drift predict label', async () => {
    const prisma = makePrisma({
      schedule: { livePredictEnabled: true, livePredictCadenceMinutes: 10 },
      predictionLogs: [
        {
          featureStats: stats(1),
          requestedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
    });
    const service = new PredictionLogAuthorizedService(
      prisma as never,
      mockWindowMonitoring,
    );

    const result = await service.getLiveDriftService('model-1', RANGE, ADMIN);

    // Same ROWS as /drift's predict plane, different cadence and rule — a
    // caller that cannot tell them apart will render one as the other.
    expect(result.data.basis.plane).not.toBe('predict');
    expect(result.data.basis.plane).not.toBe('window');
  });

  it('echoes the rule in force and whether the driver is even on', async () => {
    const prisma = makePrisma({
      schedule: { livePredictEnabled: false, livePredictCadenceMinutes: 10 },
      predictionLogs: [],
    });
    const service = new PredictionLogAuthorizedService(
      prisma as never,
      mockWindowMonitoring,
    );

    const result = await service.getLiveDriftService('model-1', RANGE, ADMIN);

    expect(result.data.consecutiveRequired).toBe(
      env.LIVE_DRIFT_CONSECUTIVE_BREACHES,
    );
    // Lets a reader tell "no breach" from "this readout is describing
    // nothing because the driver is off".
    expect(result.data.basis.livePredictEnabled).toBe(false);
  });

  it('reports UNKNOWN on an empty range rather than OK — health is never claimed from no data', async () => {
    const prisma = makePrisma({ predictionLogs: [] });
    const service = new PredictionLogAuthorizedService(
      prisma as never,
      mockWindowMonitoring,
    );

    const result = await service.getLiveDriftService('model-1', RANGE, ADMIN);

    expect(result.data.status).toBe('UNKNOWN');
    expect(result.data.bucketsEvaluated).toBe(0);
  });

  it('404s with no PRODUCTION version — nothing to compare live traffic against', async () => {
    const prisma = makePrisma({ productionVersion: null });
    const service = new PredictionLogAuthorizedService(
      prisma as never,
      mockWindowMonitoring,
    );

    await expect(
      service.getLiveDriftService('model-1', RANGE, ADMIN),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('falls back to a 10-minute bucket when the model has no schedule row at all', async () => {
    const prisma = makePrisma({
      predictionLogs: [
        {
          featureStats: stats(1),
          requestedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
    });
    const service = new PredictionLogAuthorizedService(
      prisma as never,
      mockWindowMonitoring,
    );

    const result = await service.getLiveDriftService('model-1', RANGE, ADMIN);

    expect(result.data.basis.bucketMinutes).toBe(10);
    expect(result.data.basis.livePredictEnabled).toBe(false);
  });
});
