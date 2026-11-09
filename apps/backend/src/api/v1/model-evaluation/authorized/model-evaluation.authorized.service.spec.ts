import { ModelEvaluationAuthorizedService } from './model-evaluation.authorized.service';
import { evaluationFrame, piRecorded } from '@/lib/python-evaluation-client';
import { predictRows } from '@/lib/serving-client';

jest.mock('@/lib/python-evaluation-client');
jest.mock('@/lib/serving-client');

const mockedFrame = evaluationFrame as jest.Mock;
const mockedRecorded = piRecorded as jest.Mock;
const mockedPredict = predictRows as jest.Mock;

/** First argument of the n-th call, typed — jest's own `mock.calls` is `any`. */
function callArg<T>(mock: jest.Mock, n = 0): T {
  return (mock.mock.calls[n] as unknown[])[0] as T;
}

afterEach(() => {
  jest.resetAllMocks();
});

const USER = { id: 'u1', role: 'USER' } as Auth.UserPayload;
const FEATURES = ['A', 'B'];
const DTO = {
  from: '2026-10-14T00:00:00.000Z',
  to: '2026-10-14T01:00:00.000Z',
};

const good = (value: number) => ({ value, status: 'Good' as const });
const badCell = { value: null, status: 'Bad' as const };

function frame(rows: Array<{ t: string; ok: boolean }>) {
  return {
    rows: rows.map(({ t, ok }) => ({
      timestamp: t,
      usable: ok,
      cells: { A: ok ? good(1) : badCell, B: good(2), TAG_X: good(9) },
    })),
    feature_columns: FEATURES,
    display_tags: ['TAG_X'],
    unusable_rows: rows.filter((r) => !r.ok).length,
  };
}

function build(
  over: {
    schedule?: unknown;
    version?: unknown;
    source?: unknown;
    assertRead?: jest.Mock;
  } = {},
) {
  const prisma = {
    inferenceSchedule: {
      findUnique: jest.fn().mockResolvedValue(
        'schedule' in over
          ? over.schedule
          : {
              modelId: 'm1',
              sourceId: 'src',
              fetchConfig: { intervalTime: '1m' },
              truthToleranceMinutes: 30,
            },
      ),
    },
    modelVersion: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          'version' in over
            ? over.version
            : { id: 'v1', version: 3, featureSpecKey: 'spec.json' },
        ),
    },
  };
  const access = {
    assertRead: over.assertRead ?? jest.fn().mockResolvedValue({}),
  };
  const descriptor = {
    getDescriptorByVersionIdService: jest.fn().mockResolvedValue({
      data: { featureColumns: FEATURES, targetY: 'LAB.Y' },
    }),
  };
  const scheduler = {
    asFetchConfig: jest.fn().mockReturnValue({
      intervalTime: '1m',
      tags: ['A', 'B', 'LAB.Y', 'TAG_X'],
    }),
    resolveSource: jest
      .fn()
      .mockResolvedValue(
        'source' in over
          ? over.source
          : { pi: { credentials: { user: 'svc' }, tag_list: [] } },
      ),
  };
  const service = new ModelEvaluationAuthorizedService(
    prisma as never,
    access as never,
    descriptor as never,
    scheduler as never,
  );
  return { service, prisma, access, descriptor, scheduler };
}

describe('ModelEvaluationAuthorizedService.compareService', () => {
  it('scores usable rows only, leaves a Bad row as a named gap, and returns lab beside it', async () => {
    mockedFrame.mockResolvedValue(
      frame([
        { t: '2026-10-14T00:00:00.000Z', ok: true },
        { t: '2026-10-14T00:01:00.000Z', ok: false },
        { t: '2026-10-14T00:02:00.000Z', ok: true },
      ]),
    );
    mockedPredict.mockResolvedValue({ predictions: [10, 30] });
    mockedRecorded.mockResolvedValue({
      tag: 'LAB.Y',
      truncated: false,
      points: [
        { timestamp: '2026-10-14T00:00:30.000Z', value: 7, good: true },
        { timestamp: '2026-10-14T00:10:00.000Z', value: 8, good: false },
      ],
    });
    const { service } = build();

    const { data } = await service.compareService('m1', DTO, USER);

    expect(mockedPredict).toHaveBeenCalledTimes(1);
    expect(callArg<{ rows: unknown[] }>(mockedPredict).rows).toEqual([
      { A: 1, B: 2 },
      { A: 1, B: 2 },
    ]);
    expect(data.points.map((p) => p.predicted)).toEqual([10, null, 30]);
    expect(data.points[1].skippedReason).toMatch(/A did not report Good/);
    expect(data.counts).toEqual({ rows: 3, scored: 2, skipped: 1 });
    expect(data.lab).toEqual({
      supported: true,
      events: [{ t: '2026-10-14T00:00:30.000Z', value: 7 }],
      truncated: false,
      error: null,
    });
    expect(data.targetTag).toBe('LAB.Y');
    expect(data.toleranceMinutes).toBe(30);
    // X series align to the row grid; the Bad cell is a gap, not a 0.
    expect(data.features).toEqual({
      A: [1, null, 1],
      B: [2, 2, 2],
      TAG_X: [9, 9, 9],
    });
  });

  it('sends the X tags (minus the lab target) and a UTC window to python', async () => {
    mockedFrame.mockResolvedValue(frame([]));
    mockedPredict.mockResolvedValue({ predictions: [] });
    mockedRecorded.mockResolvedValue({
      tag: 'LAB.Y',
      truncated: false,
      points: [],
    });
    const { service } = build();

    await service.compareService('m1', DTO, USER);

    const sent = callArg<{
      display_tags: string[];
      window_start: string;
      window_end: string;
      max_rows: number;
    }>(mockedFrame);
    expect(sent.display_tags).toEqual(['A', 'B', 'TAG_X']);
    expect(sent.window_start).toBe('2026-10-14T00:00:00.000Z');
    expect(sent.window_end).toBe('2026-10-14T01:00:00.000Z');
    expect(sent.max_rows).toBe(2000);
    expect(callArg<{ tag: string }>(mockedRecorded).tag).toBe('LAB.Y');
  });

  it('does not call the model when nothing is usable', async () => {
    mockedFrame.mockResolvedValue(
      frame([{ t: '2026-10-14T00:00:00.000Z', ok: false }]),
    );
    mockedRecorded.mockResolvedValue({
      tag: 'LAB.Y',
      truncated: false,
      points: [],
    });
    const { service } = build();

    const { data } = await service.compareService('m1', DTO, USER);

    expect(mockedPredict).not.toHaveBeenCalled();
    expect(data.points[0].predicted).toBeNull();
  });

  it('chunks scoring so one request never carries the whole range', async () => {
    const rows = Array.from({ length: 450 }, (_, i) => ({
      t: new Date(Date.UTC(2026, 9, 14, 0, i)).toISOString(),
      ok: true,
    }));
    mockedFrame.mockResolvedValue(frame(rows));
    mockedPredict.mockImplementation(({ rows: r }: { rows: unknown[] }) =>
      Promise.resolve({ predictions: r.map(() => 1) }),
    );
    mockedRecorded.mockResolvedValue({
      tag: 'LAB.Y',
      truncated: false,
      points: [],
    });
    const { service } = build();

    const { data } = await service.compareService(
      'm1',
      { from: '2026-10-14T00:00:00.000Z', to: '2026-10-14T07:30:00.000Z' },
      USER,
    );

    expect(
      mockedPredict.mock.calls.map(
        (_c, i) => callArg<{ rows: unknown[] }>(mockedPredict, i).rows.length,
      ),
    ).toEqual([200, 200, 50]);
    expect(data.counts.scored).toBe(450);
  });

  it('fails soft on a lab read error: predictions still return, the reason is stated', async () => {
    mockedFrame.mockResolvedValue(
      frame([{ t: '2026-10-14T00:00:00.000Z', ok: true }]),
    );
    mockedPredict.mockResolvedValue({ predictions: [5] });
    mockedRecorded.mockRejectedValue(new Error('PI down'));
    const { service } = build();

    const { data } = await service.compareService('m1', DTO, USER);

    expect(data.points[0].predicted).toBe(5);
    expect(data.lab.events).toEqual([]);
    expect(data.lab.error).toMatch(
      /Could not read lab values for LAB\.Y: PI down/,
    );
  });

  it('does not invent lab values for a non-PI source', async () => {
    mockedFrame.mockResolvedValue(
      frame([{ t: '2026-10-14T00:00:00.000Z', ok: true }]),
    );
    mockedPredict.mockResolvedValue({ predictions: [5] });
    const { service } = build({ source: { sql: { query: {} } } });

    const { data } = await service.compareService('m1', DTO, USER);

    expect(mockedRecorded).not.toHaveBeenCalled();
    expect(data.lab.supported).toBe(false);
    expect(data.lab.error).toMatch(/not PI/);
  });

  it('lets a serving failure surface rather than charting partial predictions', async () => {
    mockedFrame.mockResolvedValue(
      frame([{ t: '2026-10-14T00:00:00.000Z', ok: true }]),
    );
    mockedPredict.mockRejectedValue(
      new Error('Serving /predict failed: HTTP 503'),
    );
    const { service } = build();

    await expect(service.compareService('m1', DTO, USER)).rejects.toThrow(
      /503/,
    );
  });

  describe('refusals (all before any fetch)', () => {
    it('refuses without read access and does nothing else', async () => {
      const assertRead = jest.fn().mockRejectedValue(new Error('Forbidden'));
      const { service, prisma } = build({ assertRead });

      await expect(service.compareService('m1', DTO, USER)).rejects.toThrow(
        'Forbidden',
      );
      expect(prisma.inferenceSchedule.findUnique).not.toHaveBeenCalled();
      expect(mockedFrame).not.toHaveBeenCalled();
    });

    it('422 when the model has no schedule (no data source)', async () => {
      const { service } = build({ schedule: null });
      await expect(
        service.compareService('m1', DTO, USER),
      ).rejects.toMatchObject({
        statusCode: 422,
        message: expect.stringMatching(/no production data source/) as string,
      });
      expect(mockedFrame).not.toHaveBeenCalled();
    });

    it('422 when there is no PRODUCTION version', async () => {
      const { service } = build({ version: null });
      await expect(
        service.compareService('m1', DTO, USER),
      ).rejects.toMatchObject({
        statusCode: 422,
        message: expect.stringMatching(/PRODUCTION/) as string,
      });
    });

    it('422 over 31 days', async () => {
      const { service } = build();
      await expect(
        service.compareService(
          'm1',
          { from: '2026-09-01T00:00:00.000Z', to: '2026-10-14T00:00:00.000Z' },
          USER,
        ),
      ).rejects.toMatchObject({
        statusCode: 422,
        message: expect.stringMatching(/31 days/) as string,
      });
      expect(mockedFrame).not.toHaveBeenCalled();
    });

    it('422 over the row cap, before python is asked', async () => {
      const { service } = build();
      await expect(
        service.compareService(
          'm1',
          { from: '2026-10-14T00:00:00.000Z', to: '2026-10-16T00:00:00.000Z' }, // 2880 rows @1m
          USER,
        ),
      ).rejects.toMatchObject({
        statusCode: 422,
        message: expect.stringMatching(/2880 rows/) as string,
      });
      expect(mockedFrame).not.toHaveBeenCalled();
    });

    it('422 when the source cannot be opened', async () => {
      const { service, scheduler } = build();
      scheduler.resolveSource.mockRejectedValue(
        new Error('DataSource src not found.'),
      );
      await expect(
        service.compareService('m1', DTO, USER),
      ).rejects.toMatchObject({
        statusCode: 422,
        message: expect.stringMatching(
          /Could not open the data source/,
        ) as string,
      });
    });
  });
});
