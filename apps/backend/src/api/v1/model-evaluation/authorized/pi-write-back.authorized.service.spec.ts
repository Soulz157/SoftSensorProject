import { PiWriteBackAuthorizedService } from './pi-write-back.authorized.service';
import { ModelEvaluationAccessService } from './model-evaluation-access.service';
import { piRecorded, piWrite } from '@/lib/python-evaluation-client';
import { decryptSecret } from '@/lib/crypto';

jest.mock('@/lib/python-evaluation-client');
jest.mock('@/lib/crypto');

const mockedRecorded = piRecorded as jest.Mock;
const mockedWrite = piWrite as jest.Mock;
const mockedDecrypt = decryptSecret as jest.Mock;

function firstArg<T>(mock: jest.Mock, n = 0): T {
  return (mock.mock.calls[n] as unknown[])[0] as T;
}

beforeEach(() => {
  mockedDecrypt.mockReturnValue('s3cret');
});
afterEach(() => {
  jest.resetAllMocks();
});

const OWNER = { id: 'u1', role: 'USER' } as Auth.UserPayload;
const T1 = '2026-10-14T01:00:00.000Z';
const T2 = '2026-10-14T02:00:00.000Z';
const POINTS = [
  { timestamp: T1, value: 10 },
  { timestamp: T2, value: 20 },
];

const SOURCE = {
  id: 'src',
  name: 'Plant PI',
  type: 'aveva',
  host: 'https://pi.example',
  username: 'svc-softsensor',
  dbName: 'PIDB',
  config: null,
  secretCiphertext: 'v1:x',
};

const CONFIG = {
  modelId: 'm1',
  sourceId: 'src',
  predictionTag: 'OUT.PRED',
  labTag: 'OUT.LAB',
};

const rec = (timestamp: string, value: number | null) => ({
  timestamp,
  value,
  good: value !== null,
});
const readBack = (...pts: Array<[string, number | null]>) => ({
  tag: 'OUT.PRED',
  truncated: false,
  points: pts.map(([t, v]) => rec(t, v)),
});

type Over = {
  config?: unknown;
  schedule?: unknown;
  source?: unknown;
  member?: { role: string } | null;
  ownsWorkspace?: boolean;
  createError?: unknown;
  version?: unknown;
  targetTag?: string | null;
  baseTags?: string[];
};

function build(over: Over = {}) {
  const calls: string[] = [];
  const batchRow = {
    id: 'b1',
    modelId: 'm1',
    sourceId: 'src',
    kind: 'PREDICTION',
    tag: 'OUT.PRED',
    rangeFrom: new Date(T1),
    rangeTo: new Date(T2),
    pointCount: 2,
    status: 'WRITING',
    modelVersionId: null,
    rollbackOfId: null,
    createdById: 'u1',
    piAccount: 'svc-softsensor',
    error: null,
    createdAt: new Date('2026-10-14T03:00:00Z'),
    finishedAt: null,
  };
  const prisma = {
    model: {
      findUnique: jest.fn().mockResolvedValue({ id: 'm1', workspaceId: 'w1' }),
    },
    workspace: {
      findFirst: jest
        .fn()
        .mockResolvedValue(over.ownsWorkspace === false ? null : { id: 'w1' }),
    },
    workspaceMember: {
      findFirst: jest.fn().mockResolvedValue(over.member ?? null),
    },
    modelWriteBackConfig: {
      findUnique: jest
        .fn()
        .mockResolvedValue('config' in over ? over.config : CONFIG),
    },
    inferenceSchedule: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          'schedule' in over
            ? over.schedule
            : { sourceId: 'src', fetchConfig: {} },
        ),
    },
    dataSource: {
      findUnique: jest
        .fn()
        .mockResolvedValue('source' in over ? over.source : SOURCE),
    },
    modelVersion: {
      findFirst: jest.fn().mockResolvedValue(over.version ?? { id: 'v1' }),
    },
    piWriteBatch: {
      create: jest.fn().mockImplementation(() => {
        calls.push('claim');
        return over.createError
          ? Promise.reject(
              over.createError instanceof Error
                ? over.createError
                : Object.assign(new Error('unique'), over.createError),
            )
          : Promise.resolve(batchRow);
      }),
      update: jest
        .fn()
        .mockImplementation(({ data }: { data: { status: string } }) => {
          calls.push(`finish:${data.status}`);
          return Promise.resolve({ ...batchRow, ...data });
        }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    piWriteValue: {
      createMany: jest.fn().mockImplementation(() => {
        calls.push('persist-snapshot');
        return Promise.resolve({ count: 2 });
      }),
      update: jest.fn().mockImplementation((arg: unknown) => arg),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn().mockImplementation((ops: unknown[]) => {
      calls.push('record-results');
      return Promise.all(ops);
    }),
  };
  const scheduler = {
    asFetchConfig: jest.fn().mockReturnValue({
      intervalTime: '1m',
      tags: over.baseTags ?? ['TI202.PV', 'LAB.Y'],
    }),
  };
  const config = {
    targetTagOf: jest
      .fn()
      .mockResolvedValue('targetTag' in over ? over.targetTag : 'LAB.Y'),
  };
  const access = new ModelEvaluationAccessService(prisma as never);
  const service = new PiWriteBackAuthorizedService(
    prisma as never,
    access,
    config as never,
    scheduler as never,
  );
  mockedRecorded.mockImplementation(() => {
    calls.push('piRecorded');
    return Promise.resolve(readBack());
  });
  mockedWrite.mockImplementation(() => {
    calls.push('piWrite');
    return Promise.resolve({
      tag: 'OUT.PRED',
      update_option: 'Replace',
      results: POINTS.map((p) => ({
        timestamp: p.timestamp,
        ok: true,
        error: null,
      })),
    });
  });
  return { service, prisma, calls };
}

const WRITE = { kind: 'PREDICTION' as const, points: POINTS };

describe('PiWriteBackAuthorizedService.writeService', () => {
  it('claims, snapshots, persists the snapshot, THEN writes, then reads back', async () => {
    const { service, calls } = build();
    // snapshot: PI holds 7 at T1 and nothing at T2; read-back: both stored.
    // (Once-values bypass the default impl, so each logs itself.)
    const logged = (value: ReturnType<typeof readBack>) => () => {
      calls.push('piRecorded');
      return Promise.resolve(value);
    };
    mockedRecorded
      .mockImplementationOnce(logged(readBack([T1, 7])))
      .mockImplementationOnce(logged(readBack([T1, 10], [T2, 20])));

    const { data } = await service.writeService('m1', WRITE, OWNER);

    expect(calls).toEqual([
      'claim',
      'piRecorded',
      'persist-snapshot',
      'piWrite',
      'piRecorded',
      'record-results',
      'finish:SUCCEEDED',
    ]);
    expect(data.dryRun).toBe(false);
    if (data.dryRun) throw new Error('unreachable');
    expect(data.batch).toMatchObject({
      status: 'SUCCEEDED',
      okCount: 2,
      failedCount: 0,
      piAccount: 'svc-softsensor',
      tag: 'OUT.PRED',
    });
  });

  it('records what PI held BEFORE: existed+value for T1, not-existed for T2', async () => {
    const { service, prisma } = build();
    mockedRecorded
      .mockResolvedValueOnce(readBack([T1, 7]))
      .mockResolvedValueOnce(readBack([T1, 10], [T2, 20]));

    await service.writeService('m1', WRITE, OWNER);

    const rows = firstArg<{
      data: Array<{
        beforeExisted: boolean;
        beforeValue: number | null;
        sentValue: number;
      }>;
    }>(prisma.piWriteValue.createMany).data;
    expect(
      rows.map((r) => [r.beforeExisted, r.beforeValue, r.sentValue]),
    ).toEqual([
      [true, 7, 10],
      [false, null, 20],
    ]);
  });

  it('sends the tag from CONFIG, the batch UTC points, explicit Replace, config source creds', async () => {
    const { service } = build();
    await service.writeService('m1', WRITE, OWNER);

    const sent = firstArg<{
      tag: string;
      update_option: string;
      points: Array<{ timestamp: string; value: number }>;
      credentials: Record<string, unknown>;
    }>(mockedWrite);
    expect(sent.tag).toBe('OUT.PRED');
    expect(sent.update_option).toBe('Replace');
    expect(sent.points).toEqual([
      { timestamp: T1, value: 10 },
      { timestamp: T2, value: 20 },
    ]);
    expect(sent.credentials).toEqual({
      api_server: 'https://pi.example',
      pi_server: 'PIDB',
      user: 'svc-softsensor',
      password: 's3cret',
    });
  });

  it('writes lab values to the LAB tag', async () => {
    const { service } = build();
    await service.writeService('m1', { ...WRITE, kind: 'LAB' }, OWNER);
    expect(firstArg<{ tag: string }>(mockedWrite).tag).toBe('OUT.LAB');
  });

  describe('dry run', () => {
    it('counts overwrites vs new points and writes/claims nothing', async () => {
      const { service, prisma } = build();
      mockedRecorded.mockResolvedValueOnce(readBack([T1, 7]));

      const { data } = await service.writeService(
        'm1',
        { ...WRITE, dryRun: true },
        OWNER,
      );

      expect(data).toMatchObject({
        dryRun: true,
        tag: 'OUT.PRED',
        pointCount: 2,
        overwriteCount: 1,
        newCount: 1,
        piAccount: 'svc-softsensor',
        sourceName: 'Plant PI',
        busy: false,
      });
      expect(prisma.piWriteBatch.create).not.toHaveBeenCalled();
      expect(prisma.piWriteValue.createMany).not.toHaveBeenCalled();
      expect(mockedWrite).not.toHaveBeenCalled();
    });

    it('reports busy when another write is open on the tag', async () => {
      const { service, prisma } = build();
      prisma.piWriteBatch.findFirst.mockResolvedValue({ id: 'other' });
      const { data } = await service.writeService(
        'm1',
        { ...WRITE, dryRun: true },
        OWNER,
      );
      expect(data).toMatchObject({ busy: true });
    });
  });

  describe('failure handling', () => {
    it('409 when another write holds the tag; nothing snapshotted or written', async () => {
      const { service, prisma } = build({ createError: { code: 'P2002' } });
      await expect(
        service.writeService('m1', WRITE, OWNER),
      ).rejects.toMatchObject({
        statusCode: 409,
        message: expect.stringMatching(
          /Another write to OUT\.PRED is in progress/,
        ) as string,
      });
      expect(mockedRecorded).not.toHaveBeenCalled();
      expect(prisma.piWriteValue.createMany).not.toHaveBeenCalled();
      expect(mockedWrite).not.toHaveBeenCalled();
    });

    it('rethrows an unrelated database error from the claim', async () => {
      const { service } = build({ createError: new Error('db down') });
      await expect(service.writeService('m1', WRITE, OWNER)).rejects.toThrow(
        'db down',
      );
      expect(mockedWrite).not.toHaveBeenCalled();
    });

    it('refuses before writing when an existing value is a non-numeric system state', async () => {
      const { service, calls } = build();
      mockedRecorded.mockResolvedValueOnce(readBack([T1, null]));

      await expect(
        service.writeService('m1', WRITE, OWNER),
      ).rejects.toMatchObject({
        statusCode: 422,
        message: expect.stringMatching(/non-numeric system states/) as string,
      });
      expect(mockedWrite).not.toHaveBeenCalled();
      expect(calls).toContain('finish:FAILED'); // the claim is released
    });

    it('refuses before writing when the range is too dense to snapshot', async () => {
      const { service, calls } = build();
      mockedRecorded.mockResolvedValueOnce({ ...readBack(), truncated: true });

      await expect(
        service.writeService('m1', WRITE, OWNER),
      ).rejects.toMatchObject({
        statusCode: 422,
        message: expect.stringMatching(/too many events/) as string,
      });
      expect(mockedWrite).not.toHaveBeenCalled();
      expect(calls).toContain('finish:FAILED');
    });

    it('a failed write request still reads back and records the truth, status FAILED, rollback noted', async () => {
      const { service, prisma } = build();
      mockedRecorded
        .mockResolvedValueOnce(readBack())
        .mockResolvedValueOnce(readBack([T1, 10])); // half landed before the error
      mockedWrite.mockRejectedValue(new Error('HTTP 503'));

      const { data } = await service.writeService('m1', WRITE, OWNER);

      if (data.dryRun) throw new Error('unreachable');
      expect(data.batch.status).toBe('FAILED');
      expect(data.batch.error).toMatch(
        /PI write failed: HTTP 503.*Rollback is available/,
      );
      // afterValue captured for the point that did land
      const updates = (
        prisma.piWriteValue.update.mock.calls as Array<
          [
            {
              where: unknown;
              data: { afterValue: number | null; itemOk: boolean };
            },
          ]
        >
      ).map((c) => c[0].data);
      expect(updates.map((u) => u.afterValue)).toEqual([10, null]);
      expect(updates.every((u) => u.itemOk === false)).toBe(true);
    });

    it("one point PI rejected is PARTIAL and carries PI's reason", async () => {
      const { service, prisma } = build();
      mockedRecorded
        .mockResolvedValueOnce(readBack())
        .mockResolvedValueOnce(readBack([T1, 10]));
      mockedWrite.mockResolvedValue({
        tag: 'OUT.PRED',
        update_option: 'Replace',
        results: [
          { timestamp: T1, ok: true, error: null },
          { timestamp: T2, ok: false, error: 'Value out of range' },
        ],
      });

      const { data } = await service.writeService('m1', WRITE, OWNER);

      if (data.dryRun) throw new Error('unreachable');
      expect(data.batch).toMatchObject({
        status: 'PARTIAL',
        okCount: 1,
        failedCount: 1,
      });
      const errors = (
        prisma.piWriteValue.update.mock.calls as Array<
          [{ data: { itemError: string | null } }]
        >
      ).map((c) => c[0].data.itemError);
      expect(errors).toEqual([null, 'Value out of range']);
    });

    it('PI accepting a write that stored nothing is a failure, not success', async () => {
      const { service } = build();
      mockedRecorded
        .mockResolvedValueOnce(readBack())
        .mockResolvedValueOnce(readBack()); // nothing stored
      const { data } = await service.writeService('m1', WRITE, OWNER);
      if (data.dryRun) throw new Error('unreachable');
      expect(data.batch.status).toBe('FAILED');
    });

    it('a failed read-back leaves items unverified and says so', async () => {
      const { service } = build();
      mockedRecorded
        .mockResolvedValueOnce(readBack())
        .mockRejectedValueOnce(new Error('PI read timeout'));

      const { data } = await service.writeService('m1', WRITE, OWNER);

      if (data.dryRun) throw new Error('unreachable');
      expect(data.batch.status).toBe('FAILED');
      expect(data.batch.error).toMatch(
        /could not be verified: PI read timeout/,
      );
    });
  });

  describe('refusals before any claim', () => {
    const refusedWith = async (
      over: Over,
      status: number,
      text: RegExp,
      dto = WRITE,
    ) => {
      const { service, prisma } = build(over);
      await expect(
        service.writeService('m1', dto, OWNER),
      ).rejects.toMatchObject({
        statusCode: status,
        message: expect.stringMatching(text) as string,
      });
      expect(prisma.piWriteBatch.create).not.toHaveBeenCalled();
      expect(mockedWrite).not.toHaveBeenCalled();
    };

    it('403 for STAFF', () =>
      refusedWith(
        { ownsWorkspace: false, member: { role: 'STAFF' } },
        403,
        /workspace owner or an admin/,
      ));

    it('403 for a VIEWER', () =>
      refusedWith(
        { ownsWorkspace: false, member: { role: 'VIEWER' } },
        403,
        /workspace owner or an admin/,
      ));

    it('422 when no output tag is configured for that kind', () =>
      refusedWith(
        { config: { ...CONFIG, predictionTag: null } },
        422,
        /No prediction output tag/,
      ));

    it('422 when there is no config at all', () =>
      refusedWith({ config: null }, 422, /No prediction output tag/));

    it('409 when the schedule source changed after the config was saved', () =>
      refusedWith(
        { schedule: { sourceId: 'other', fetchConfig: {} } },
        409,
        /source changed/,
      ));

    it('422 for a non-PI source', () =>
      refusedWith(
        { source: { ...SOURCE, type: 'sql' } },
        422,
        /not an available PI source/,
      ));

    it('422 when the config is no longer valid (output tag became an input)', () =>
      refusedWith(
        { baseTags: ['TI202.PV', 'OUT.PRED'] },
        422,
        /no longer valid.*input tags/,
      ));

    it('422 for a future timestamp', () =>
      refusedWith({}, 422, /in the future/, {
        kind: 'PREDICTION',
        points: [{ timestamp: '2999-01-01T00:00:00.000Z', value: 1 }],
      }));

    it("422 for a version that is not this model's", async () => {
      const { service, prisma } = build();
      prisma.modelVersion.findFirst.mockResolvedValue(null);
      await expect(
        service.writeService(
          'm1',
          { ...WRITE, modelVersionId: '11111111-1111-4111-8111-111111111111' },
          OWNER,
        ),
      ).rejects.toMatchObject({ statusCode: 422 });
      expect(prisma.piWriteBatch.create).not.toHaveBeenCalled();
    });
  });

  it('stores the version and the user on the batch', async () => {
    const { service, prisma } = build();
    await service.writeService(
      'm1',
      { ...WRITE, modelVersionId: '11111111-1111-4111-8111-111111111111' },
      OWNER,
    );
    expect(
      firstArg<{ data: Record<string, unknown> }>(prisma.piWriteBatch.create)
        .data,
    ).toMatchObject({
      modelId: 'm1',
      sourceId: 'src',
      kind: 'PREDICTION',
      tag: 'OUT.PRED',
      status: 'WRITING',
      createdById: 'u1',
      piAccount: 'svc-softsensor',
      modelVersionId: '11111111-1111-4111-8111-111111111111',
      pointCount: 2,
    });
  });
});

describe('PiWriteBackAuthorizedService.onModuleInit', () => {
  it('sweeps every open batch to FAILED with a rollback hint', async () => {
    const { service, prisma } = build();
    prisma.piWriteBatch.updateMany.mockResolvedValue({ count: 2 });
    await service.onModuleInit();
    const arg = firstArg<{
      where: { status: { in: string[] } };
      data: { status: string; error: string };
    }>(prisma.piWriteBatch.updateMany);
    expect(arg.where.status.in).toEqual(['PENDING', 'WRITING']);
    expect(arg.data.status).toBe('FAILED');
    expect(arg.data.error).toMatch(/rollback is available/);
  });
});

describe('history', () => {
  const row = (id: string, minute: number) => ({
    id,
    modelId: 'm1',
    sourceId: 'src',
    kind: 'PREDICTION',
    tag: 'OUT.PRED',
    rangeFrom: new Date(T1),
    rangeTo: new Date(T2),
    pointCount: 2,
    status: 'SUCCEEDED',
    modelVersionId: null,
    rollbackOfId: null,
    createdById: 'u1',
    piAccount: 'svc',
    error: null,
    createdAt: new Date(Date.UTC(2026, 9, 14, 3, minute)),
    finishedAt: null,
    createdBy: { id: 'u1', email: 'a@b.c', firstName: 'Ada', lastName: 'L' },
  });

  it('pages with a cursor and reports per-batch ok / failed counts', async () => {
    const { service, prisma } = build({
      ownsWorkspace: false,
      member: { role: 'VIEWER', permissions: ['MONITORING_VIEW'] } as never,
    });
    prisma.piWriteBatch.findMany.mockResolvedValue([
      row('b3', 3),
      row('b2', 2),
      row('b1', 1),
    ]);
    prisma.piWriteValue.groupBy.mockResolvedValue([
      { batchId: 'b3', itemOk: true, _count: { _all: 2 } },
      { batchId: 'b2', itemOk: true, _count: { _all: 1 } },
      { batchId: 'b2', itemOk: false, _count: { _all: 1 } },
    ]);

    const { data } = await service.listHistoryService(
      'm1',
      { limit: 2 },
      OWNER,
    );

    expect(data.batches.map((b) => b.id)).toEqual(['b3', 'b2']);
    expect(data.nextCursor).toBe('b2');
    expect(data.batches[1]).toMatchObject({
      okCount: 1,
      failedCount: 1,
      createdBy: 'Ada L',
    });
    expect(firstArg<{ take: number }>(prisma.piWriteBatch.findMany).take).toBe(
      3,
    );
  });

  it('no cursor when the page is the last one', async () => {
    const { service, prisma } = build();
    prisma.piWriteBatch.findMany.mockResolvedValue([row('b1', 1)]);
    const { data } = await service.listHistoryService(
      'm1',
      { limit: 20 },
      OWNER,
    );
    expect(data.nextCursor).toBeNull();
  });

  it('getBatch: 404 for a batch of another model', async () => {
    const { service, prisma } = build();
    prisma.piWriteBatch.findFirst.mockResolvedValue(null);
    await expect(
      service.getBatchService('m1', 'zzz', OWNER),
    ).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(
      firstArg<{ where: { id: string; modelId: string } }>(
        prisma.piWriteBatch.findFirst,
      ).where,
    ).toEqual({ id: 'zzz', modelId: 'm1' });
  });

  it('getBatch: returns the before / sent / after values for the batch', async () => {
    const { service, prisma } = build();
    prisma.piWriteBatch.findFirst.mockResolvedValue({
      ...row('b1', 1),
      values: [
        {
          timestamp: new Date(T1),
          beforeExisted: true,
          beforeValue: 7,
          sentValue: 10,
          afterValue: 10,
          itemOk: true,
          itemError: null,
        },
      ],
      rollbacks: [],
    });
    const { data } = await service.getBatchService('m1', 'b1', OWNER);
    expect(data.values).toEqual([
      {
        timestamp: T1,
        beforeExisted: true,
        beforeValue: 7,
        sentValue: 10,
        afterValue: 10,
        itemOk: true,
        itemError: null,
      },
    ]);
    expect(data.batch).toMatchObject({
      okCount: 1,
      failedCount: 0,
      createdBy: 'Ada L',
    });
  });
});
