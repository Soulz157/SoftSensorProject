import { LivePredictDriverService } from './live-predict-driver.service';
import {
  materializeInferenceWindow,
  readArtifactRows,
} from '@/lib/python-preprocess-client';
import { predictRows } from '@/lib/serving-client';

jest.mock('@/lib/python-preprocess-client');
jest.mock('@/lib/serving-client');

afterEach(() => {
  jest.clearAllMocks();
});

const FEATURES = ['TI202.PV', 'TI203.PV'];

function schedule(overrides: Record<string, unknown> = {}) {
  return {
    modelId: 'model-1',
    sourceId: 'src-a',
    enabled: false, // the SCHEDULED plane is off — the driver must not care
    livePredictEnabled: true,
    livePredictCadenceMinutes: 10,
    livePredictLastRunAt: null,
    lagMinutes: 15,
    fetchConfig: { type: 'pi', intervalTime: '1m' },
    ...overrides,
  };
}

function buildPrisma(schedules: Array<ReturnType<typeof schedule>>) {
  const one = schedules[0] ?? null;
  return {
    inferenceSchedule: {
      findMany: jest.fn().mockResolvedValue(schedules),
      findUnique: jest.fn().mockResolvedValue(one),
      update: jest.fn().mockResolvedValue({}),
    },
    modelVersion: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: 'version-1', featureSpecKey: 'spec.json' }),
    },
  };
}

function buildDescriptor() {
  return {
    getDescriptorByVersionIdService: jest
      .fn()
      .mockResolvedValue({ data: { featureColumns: FEATURES } }),
  };
}

function buildScheduler() {
  return {
    asFetchConfig: jest.fn().mockReturnValue({ intervalTime: '1m' }),
    resolveSource: jest.fn().mockResolvedValue({ pi: { tag_list: FEATURES } }),
  };
}

function makeService(prisma: ReturnType<typeof buildPrisma>) {
  return new LivePredictDriverService(
    prisma as never,
    buildDescriptor() as never,
    buildScheduler() as never,
  );
}

/** A materialize result with `n` usable rows. */
function materialized(rows: number) {
  return {
    object_key: 'inference/model-1/live/input.parquet',
    checksum: 'abc',
    // `row_count` is what the source RETURNED; `scored_rows` what survived
    // cleaning. Both are on the real contract, so the fixture carries both
    // — a fixture missing a field the type requires type-checks as a lie
    // even while jest happily accepts it.
    row_count: rows,
    scored_rows: rows,
    missing_pct: 0,
    feature_histograms: null,
    feature_stats: null,
    // MODEL-SERVE-009-T02 added this to the materialize contract. The
    // driver ignores it (the SCHEDULER owns the TagObservation write), but
    // the fixture carries it because the type requires it — a fixture short
    // of a required field type-checks as a lie even while jest runs it.
    tag_observations: {},
  };
}

function page(cells: Record<string, { value: number; status: string }>) {
  return {
    source_key: 'inference/model-1/live/input.parquet',
    total_row_count: 1,
    offset: 0,
    rows: [{ timestamp: '2026-09-17T02:30:00.000Z', cells }],
  };
}

const GOOD = {
  'TI202.PV': { value: 41.5, status: 'Good' },
  'TI203.PV': { value: 12.25, status: 'Good' },
};

describe('LivePredictDriverService (MODEL-SERVE-008-T02)', () => {
  it('scores the newest materialized row through /predict, pre-scale and unaltered', async () => {
    jest.mocked(materializeInferenceWindow).mockResolvedValue(materialized(10));
    jest.mocked(readArtifactRows).mockResolvedValue(page(GOOD) as never);
    jest.mocked(predictRows).mockResolvedValue({
      predictions: [42.1],
      modelId: 'model-1',
      version: 1,
      inputTagCheck: {
        requiredColumns: FEATURES,
        receivedColumns: FEATURES,
        unusedColumns: [],
      },
    });
    const prisma = buildPrisma([schedule()]);

    await makeService(prisma).tick();

    // The VALUES reach serving exactly as the artifact carried them — no
    // scaling, which is the serving process's job and nobody else's.
    expect(predictRows).toHaveBeenCalledWith({
      modelId: 'model-1',
      rows: [{ 'TI202.PV': 41.5, 'TI203.PV': 12.25 }],
    });
  });

  it('NEVER scores a row whose required column is not Good — a Bad cell is not a measurement', async () => {
    jest.mocked(materializeInferenceWindow).mockResolvedValue(materialized(10));
    jest.mocked(readArtifactRows).mockResolvedValue(
      page({
        'TI202.PV': { value: 41.5, status: 'Good' },
        // A Bad cell still carries a NUMBER. Scoring it would publish a
        // confident prediction over a value nobody measured.
        'TI203.PV': { value: 0, status: 'Bad' },
      }) as never,
    );
    const prisma = buildPrisma([schedule()]);

    await makeService(prisma).tick();

    expect(predictRows).not.toHaveBeenCalled();
    // Still marked as run: a broken source must not become a hot loop.
    expect(prisma.inferenceSchedule.update).toHaveBeenCalled();
  });

  it('runs on livePredictEnabled ALONE — a stopped schedule does not stop the live chart', async () => {
    jest.mocked(materializeInferenceWindow).mockResolvedValue(materialized(5));
    jest.mocked(readArtifactRows).mockResolvedValue(page(GOOD) as never);
    jest.mocked(predictRows).mockResolvedValue({
      predictions: [1],
      modelId: 'model-1',
      version: 1,
      inputTagCheck: {
        requiredColumns: FEATURES,
        receivedColumns: FEATURES,
        unusedColumns: [],
      },
    });
    const prisma = buildPrisma([schedule({ enabled: false })]);

    await makeService(prisma).tick();

    expect(prisma.inferenceSchedule.findMany).toHaveBeenCalledWith({
      where: { livePredictEnabled: true },
    });
    expect(predictRows).toHaveBeenCalled();
  });

  it('skips a model whose cadence has not elapsed, and does not re-score it', async () => {
    const prisma = buildPrisma([
      schedule({
        livePredictCadenceMinutes: 10,
        // Ran one minute ago — eight minutes short of due.
        livePredictLastRunAt: new Date(Date.now() - 60_000),
      }),
    ]);

    await makeService(prisma).tick();

    expect(materializeInferenceWindow).not.toHaveBeenCalled();
    expect(predictRows).not.toHaveBeenCalled();
  });

  it('does not catch up after an outage — one score for the current moment, not a burst', async () => {
    jest.mocked(materializeInferenceWindow).mockResolvedValue(materialized(5));
    jest.mocked(readArtifactRows).mockResolvedValue(page(GOOD) as never);
    jest.mocked(predictRows).mockResolvedValue({
      predictions: [1],
      modelId: 'model-1',
      version: 1,
      inputTagCheck: {
        requiredColumns: FEATURES,
        receivedColumns: FEATURES,
        unusedColumns: [],
      },
    });
    // Two days of missed ticks — 288 cadences' worth at 10 minutes.
    const prisma = buildPrisma([
      schedule({
        livePredictLastRunAt: new Date(Date.now() - 48 * 60 * 60_000),
      }),
    ]);

    await makeService(prisma).tick();

    expect(predictRows).toHaveBeenCalledTimes(1);
  });

  it('writes NO InferenceWindow and spawns NO container — the planes stay separate', async () => {
    jest.mocked(materializeInferenceWindow).mockResolvedValue(materialized(5));
    jest.mocked(readArtifactRows).mockResolvedValue(page(GOOD) as never);
    jest.mocked(predictRows).mockResolvedValue({
      predictions: [1],
      modelId: 'model-1',
      version: 1,
      inputTagCheck: {
        requiredColumns: FEATURES,
        receivedColumns: FEATURES,
        unusedColumns: [],
      },
    });
    const prisma = buildPrisma([schedule()]);

    await makeService(prisma).tick();

    // The driver has no inferenceWindow accessor at all: if it ever grew
    // one, this mock would have to as well, and that is the point.
    expect((prisma as Record<string, unknown>).inferenceWindow).toBeUndefined();
  });

  it('scores nothing when the source returned no usable rows — a quiet plant is not an incident', async () => {
    jest.mocked(materializeInferenceWindow).mockResolvedValue(materialized(0));
    const prisma = buildPrisma([schedule()]);

    await makeService(prisma).tick();

    expect(readArtifactRows).not.toHaveBeenCalled();
    expect(predictRows).not.toHaveBeenCalled();
  });

  it('marks the run even when scoring THROWS, so a failing source is not retried every tick', async () => {
    jest
      .mocked(materializeInferenceWindow)
      .mockRejectedValue(new Error('Cannot reach the data connector service.'));
    const prisma = buildPrisma([schedule()]);

    // The sweep swallows it — a missing point on a live chart is not an
    // incident, and this driver owns no failure row to write.
    await expect(makeService(prisma).tick()).resolves.toBeUndefined();
    expect(prisma.inferenceSchedule.update).toHaveBeenCalledWith({
      where: { modelId: 'model-1' },
      data: { livePredictLastRunAt: expect.any(Date) },
    });
  });

  it('does not score a model with no PRODUCTION version — saved but never promoted is legitimate', async () => {
    const prisma = buildPrisma([schedule()]);
    prisma.modelVersion.findFirst.mockResolvedValue(null);

    await makeService(prisma).tick();

    expect(materializeInferenceWindow).not.toHaveBeenCalled();
    expect(predictRows).not.toHaveBeenCalled();
  });
});
