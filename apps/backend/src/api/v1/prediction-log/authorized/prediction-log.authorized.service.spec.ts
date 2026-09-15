import { PredictionLogAuthorizedService } from './prediction-log.authorized.service';
import * as pythonClient from '@/lib/python-preprocess-client';
import { env } from '@/config/env.config';

jest.mock('@/lib/python-preprocess-client');
// `postToPython` is never called by getPsiService/getDriftService directly
// (both go through `readFeatureSpec`/`resolveBaseline`'s own postToPython
// call inside python-preprocess-client, already covered by the mock
// above) — mocked here only so importing '@/lib/python-client' at all
// (a transitive import of the service under test) never reaches a real
// network call during this suite.
jest.mock('@/lib/python-client', () => ({
  PYTHON_TIMEOUT: { test: 15_000, metadata: 300_000, fetch: 120_000 },
  postToPython: jest.fn(),
}));

const mockedReadFeatureSpec = pythonClient.readFeatureSpec as jest.Mock;

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
    const service = new PredictionLogAuthorizedService(prisma as never);
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
    const service = new PredictionLogAuthorizedService(prisma as never);
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
    const service = new PredictionLogAuthorizedService(prisma as never);
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

    const service = new PredictionLogAuthorizedService(prisma as never);
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

    const service = new PredictionLogAuthorizedService(prisma as never);
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

    const service = new PredictionLogAuthorizedService(prisma as never);
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

    const service = new PredictionLogAuthorizedService(prisma as never);
    const result = await service.getPsiService('model-1', RANGE, ADMIN);

    const complete = result.data.columns.find((c) => c.column === 'COMPLETE');
    const partial = result.data.columns.find((c) => c.column === 'PARTIAL');
    expect(complete?.status).toBe('OK');
    expect(partial?.status).toBe('UNKNOWN');
    expect(partial?.reason).toMatch(/no training reference/);
  });
});
