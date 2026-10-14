import { PiRollbackAuthorizedService } from './pi-rollback.authorized.service';
import { PiWriteBackAuthorizedService } from './pi-write-back.authorized.service';
import { ModelEvaluationAccessService } from './model-evaluation-access.service';
import { piRecorded, piWrite } from '@/lib/python-evaluation-client';
import { decryptSecret } from '@/lib/crypto';

jest.mock('@/lib/python-evaluation-client');
jest.mock('@/lib/crypto');

const mockedRecorded = piRecorded as jest.Mock;
const mockedWrite = piWrite as jest.Mock;

function argOf<T>(mock: jest.Mock, n = 0): T {
  return (mock.mock.calls[n] as unknown[])[0] as T;
}

beforeEach(() => {
  (decryptSecret as jest.Mock).mockReturnValue('s3cret');
});
afterEach(() => {
  jest.resetAllMocks();
});

const OWNER = { id: 'u1', role: 'USER' } as Auth.UserPayload;
const T1 = '2026-10-14T01:00:00.000Z';
const T2 = '2026-10-14T02:00:00.000Z';

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

/** Original batch: T1 held 7 before and we wrote 10; T2 did not exist, we wrote 20. */
function originalBatch(over: Record<string, unknown> = {}) {
  return {
    id: 'orig-1',
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
    piAccount: 'svc-softsensor',
    error: null,
    createdAt: new Date('2026-10-14T03:00:00Z'),
    finishedAt: new Date('2026-10-14T03:00:05Z'),
    values: [
      {
        timestamp: new Date(T1),
        beforeExisted: true,
        beforeValue: 7,
        sentValue: 10,
        afterValue: 10,
        itemOk: true,
      },
      {
        timestamp: new Date(T2),
        beforeExisted: false,
        beforeValue: null,
        sentValue: 20,
        afterValue: 20,
        itemOk: true,
      },
    ],
    ...over,
  };
}

const rec = (...pts: Array<[string, number | null]>) => ({
  tag: 'OUT.PRED',
  truncated: false,
  points: pts.map(([timestamp, value]) => ({
    timestamp,
    value,
    good: value !== null,
  })),
});

type Over = {
  original?: unknown;
  blocking?: unknown;
  member?: { role: string } | null;
  ownsWorkspace?: boolean;
  source?: unknown;
  createError?: unknown;
};

function build(over: Over = {}) {
  const calls: string[] = [];
  const rollbackRow = (data: Record<string, unknown> = {}) => ({
    id: 'rb-1',
    modelId: 'm1',
    sourceId: 'src',
    kind: 'ROLLBACK',
    tag: 'OUT.PRED',
    rangeFrom: new Date(T1),
    rangeTo: new Date(T2),
    pointCount: 2,
    status: 'WRITING',
    modelVersionId: null,
    rollbackOfId: 'orig-1',
    createdById: 'u1',
    piAccount: 'svc-softsensor',
    error: null,
    createdAt: new Date('2026-10-14T04:00:00Z'),
    finishedAt: null,
    ...data,
  });
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
    dataSource: {
      findUnique: jest
        .fn()
        .mockResolvedValue('source' in over ? over.source : SOURCE),
    },
    piWriteBatch: {
      // `load` asks for values; `findBlocking` asks for a select.
      findFirst: jest
        .fn()
        .mockImplementation((arg: { include?: unknown }) =>
          Promise.resolve(
            arg.include
              ? 'original' in over
                ? over.original
                : originalBatch()
              : (over.blocking ?? null),
          ),
        ),
      create: jest.fn().mockImplementation(() => {
        calls.push('claim');
        return over.createError
          ? Promise.reject(Object.assign(new Error('unique'), over.createError))
          : Promise.resolve(rollbackRow());
      }),
      update: jest
        .fn()
        .mockImplementation(
          ({
            where,
            data,
          }: {
            where: { id: string };
            data: Record<string, unknown>;
          }) => {
            calls.push(`update:${where.id}:${String(data.status)}`);
            return Promise.resolve(
              where.id === 'rb-1'
                ? rollbackRow(data)
                : { ...originalBatch(), ...data },
            );
          },
        ),
    },
    piWriteValue: {
      createMany: jest.fn().mockImplementation(() => {
        calls.push('persist-plan');
        return Promise.resolve({ count: 2 });
      }),
      update: jest.fn().mockImplementation((arg: unknown) => arg),
    },
    $transaction: jest
      .fn()
      .mockImplementation((ops: unknown[]) => Promise.all(ops)),
  };
  const access = new ModelEvaluationAccessService(prisma as never);
  const writer = new PiWriteBackAuthorizedService(
    prisma as never,
    access,
    {} as never,
    {} as never,
  );
  const service = new PiRollbackAuthorizedService(
    prisma as never,
    access,
    writer,
  );
  mockedWrite.mockImplementation(
    (arg: { points: Array<{ timestamp: string }> }) => {
      calls.push('piWrite');
      return Promise.resolve({
        tag: 'OUT.PRED',
        update_option: 'x',
        results: arg.points.map((p) => ({
          timestamp: p.timestamp,
          ok: true,
          error: null,
        })),
      });
    },
  );
  return { service, prisma, calls };
}

/** Queue `recorded` reads: preflight, post-claim, read-back. */
function reads(...queue: Array<ReturnType<typeof rec> | Error>) {
  for (const r of queue) {
    if (r instanceof Error) mockedRecorded.mockRejectedValueOnce(r);
    else mockedRecorded.mockResolvedValueOnce(r);
  }
}

const NOW_AS_WRITTEN = () => rec([T1, 10], [T2, 20]);
const RESTORED = () => rec([T1, 7]); // T1 back to 7, T2 removed

const GO = {};

describe('PiRollbackAuthorizedService.rollbackService', () => {
  it('restores the old value, removes the point the batch created, verifies, retires the original', async () => {
    const { service, prisma, calls } = build();
    reads(NOW_AS_WRITTEN(), NOW_AS_WRITTEN(), RESTORED());

    const { data } = await service.rollbackService('m1', 'orig-1', GO, OWNER);

    // Replace T1 -> 7 (its original), Remove T2 (it did not exist before).
    expect(mockedWrite).toHaveBeenCalledTimes(2);
    expect(argOf<Record<string, unknown>>(mockedWrite, 0)).toMatchObject({
      tag: 'OUT.PRED',
      update_option: 'Replace',
      points: [{ timestamp: T1, value: 7 }],
    });
    const removeCall = argOf<{
      update_option: string;
      points: Array<Record<string, unknown>>;
    }>(mockedWrite, 1);
    expect(removeCall.update_option).toBe('Remove');
    expect(removeCall.points).toEqual([{ timestamp: T2 }]); // no value sent

    if (data.dryRun) throw new Error('unreachable');
    expect(data.batch).toMatchObject({
      kind: 'ROLLBACK',
      status: 'SUCCEEDED',
      okCount: 2,
      rollbackOfId: 'orig-1',
    });
    expect(data.original.status).toBe('ROLLED_BACK');
    expect(calls).toEqual([
      'claim',
      'persist-plan',
      'piWrite',
      'piWrite',
      'update:rb-1:SUCCEEDED',
      'update:orig-1:ROLLED_BACK',
    ]);
    expect(
      argOf<{ data: Record<string, unknown> }>(prisma.piWriteBatch.create).data,
    ).toMatchObject({
      kind: 'ROLLBACK',
      rollbackOfId: 'orig-1',
      createdById: 'u1',
      status: 'WRITING',
    });
  });

  it("records the rollback's own before/after rows (what PI held before the undo, what was sent)", async () => {
    const { service, prisma } = build();
    reads(NOW_AS_WRITTEN(), NOW_AS_WRITTEN(), RESTORED());

    await service.rollbackService('m1', 'orig-1', GO, OWNER);

    const rows = argOf<{ data: Array<Record<string, unknown>> }>(
      prisma.piWriteValue.createMany,
    ).data;
    expect(
      rows.map((r) => [r.beforeExisted, r.beforeValue, r.sentValue]),
    ).toEqual([
      [true, 10, 7], // held 10, restored to 7
      [true, 20, null], // held 20, removed => nothing sent
    ]);
  });

  it("reads and writes the BATCH's own source and tag, not whatever the config says now", async () => {
    const { service, prisma } = build();
    reads(NOW_AS_WRITTEN(), NOW_AS_WRITTEN(), RESTORED());
    await service.rollbackService('m1', 'orig-1', GO, OWNER);
    expect(
      argOf<{ where: { id: string } }>(prisma.dataSource.findUnique).where.id,
    ).toBe('src');
    expect(argOf<{ tag: string }>(mockedRecorded).tag).toBe('OUT.PRED');
  });

  describe('refusals', () => {
    it('LIFO: a later overlapping batch blocks it, naming that batch; nothing is claimed or written', async () => {
      const { service, prisma } = build({
        blocking: {
          id: 'later-batch-9999',
          kind: 'LAB',
          status: 'SUCCEEDED',
          createdAt: new Date('2026-10-14T05:00:00Z'),
          rangeFrom: new Date(T1),
          rangeTo: new Date(T2),
        },
      });
      reads(NOW_AS_WRITTEN());

      await expect(
        service.rollbackService('m1', 'orig-1', GO, OWNER),
      ).rejects.toMatchObject({
        statusCode: 409,
        message: expect.stringMatching(
          /later lab write.*later-ba.*Roll that one back first/,
        ) as string,
      });
      expect(prisma.piWriteBatch.create).not.toHaveBeenCalled();
      expect(mockedWrite).not.toHaveBeenCalled();

      // The blocker query itself: later, same tag, overlapping, not undone, not a ROLLBACK.
      const where = (
        prisma.piWriteBatch.findFirst.mock.calls as Array<
          [{ where: Record<string, unknown>; include?: unknown }]
        >
      )
        .map((c) => c[0])
        .find((a) => !a.include)!.where;
      expect(where).toMatchObject({
        sourceId: 'src',
        tag: 'OUT.PRED',
        id: { not: 'orig-1' },
        kind: { not: 'ROLLBACK' },
        status: { not: 'ROLLED_BACK' },
      });
      expect(where.createdAt).toEqual({ gt: new Date('2026-10-14T03:00:00Z') });
    });

    it('LIFO is never overridden by force', async () => {
      const { service } = build({
        blocking: {
          id: 'later',
          kind: 'PREDICTION',
          status: 'SUCCEEDED',
          createdAt: new Date(),
          rangeFrom: new Date(T1),
          rangeTo: new Date(T2),
        },
      });
      reads(NOW_AS_WRITTEN());
      await expect(
        service.rollbackService('m1', 'orig-1', { force: true }, OWNER),
      ).rejects.toMatchObject({ statusCode: 409 });
      expect(mockedWrite).not.toHaveBeenCalled();
    });

    it('DRIFT: someone changed a value since; 409 lists it and nothing is claimed', async () => {
      const { service, prisma } = build();
      reads(rec([T1, 99], [T2, 20]));

      await expect(
        service.rollbackService('m1', 'orig-1', GO, OWNER),
      ).rejects.toMatchObject({
        statusCode: 409,
        message: expect.stringMatching(
          /1 point\(s\).*expected 10, found 99.*Retry with force/,
        ) as string,
      });
      expect(prisma.piWriteBatch.create).not.toHaveBeenCalled();
      expect(mockedWrite).not.toHaveBeenCalled();
    });

    it('DRIFT with force proceeds and still restores the original', async () => {
      const { service } = build();
      reads(rec([T1, 99], [T2, 20]), rec([T1, 99], [T2, 20]), RESTORED());

      const { data } = await service.rollbackService(
        'm1',
        'orig-1',
        { force: true },
        OWNER,
      );

      expect(
        argOf<{ points: Array<{ value: number }> }>(mockedWrite, 0).points[0]
          .value,
      ).toBe(7);
      if (data.dryRun) throw new Error('unreachable');
      expect(data.batch.status).toBe('SUCCEEDED');
    });

    it('drift that appears only AFTER the claim is caught: the claim is released, nothing written', async () => {
      const { service, calls } = build();
      reads(NOW_AS_WRITTEN(), rec([T1, 99], [T2, 20])); // clean preflight, drifted post-claim

      await expect(
        service.rollbackService('m1', 'orig-1', GO, OWNER),
      ).rejects.toMatchObject({ statusCode: 409 });

      expect(mockedWrite).not.toHaveBeenCalled();
      expect(calls).toContain('update:rb-1:FAILED');
    });

    it('409 when another write holds the tag', async () => {
      const { service } = build({ createError: { code: 'P2002' } });
      reads(NOW_AS_WRITTEN());
      await expect(
        service.rollbackService('m1', 'orig-1', GO, OWNER),
      ).rejects.toMatchObject({
        statusCode: 409,
        message: expect.stringMatching(/in progress/) as string,
      });
      expect(mockedWrite).not.toHaveBeenCalled();
    });

    it.each([
      [
        'a rollback batch',
        { kind: 'ROLLBACK' },
        422,
        /cannot itself be rolled back/,
      ],
      [
        'one already rolled back',
        { status: 'ROLLED_BACK' },
        409,
        /already been rolled back/,
      ],
      ['one still writing', { status: 'WRITING' }, 409, /still being written/],
      [
        'one refused before it changed PI (no snapshot)',
        { values: [], status: 'FAILED' },
        422,
        /no snapshot exists/,
      ],
    ])('refuses %s without reading PI', async (_l, patch, status, text) => {
      const { service, prisma } = build({ original: originalBatch(patch) });
      await expect(
        service.rollbackService('m1', 'orig-1', GO, OWNER),
      ).rejects.toMatchObject({
        statusCode: status,
        message: expect.stringMatching(text) as string,
      });
      expect(mockedRecorded).not.toHaveBeenCalled();
      expect(prisma.piWriteBatch.create).not.toHaveBeenCalled();
    });

    it("404 for a batch that is not this model's", async () => {
      const { service } = build({ original: null });
      await expect(
        service.rollbackService('m1', 'nope', GO, OWNER),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('422 when the source the batch used is gone or no longer PI', async () => {
      const { service } = build({ source: { ...SOURCE, type: 'sql' } });
      await expect(
        service.rollbackService('m1', 'orig-1', GO, OWNER),
      ).rejects.toMatchObject({
        statusCode: 422,
        message: expect.stringMatching(
          /no longer an available PI source/,
        ) as string,
      });
    });

    it.each([
      ['STAFF', { member: { role: 'STAFF' } }],
      ['a VIEWER', { member: { role: 'VIEWER' } }],
      ['a non-member', { member: null }],
    ])('403 for %s, before anything is loaded', async (_l, patch) => {
      const { service, prisma } = build({ ownsWorkspace: false, ...patch });
      await expect(
        service.rollbackService('m1', 'orig-1', GO, OWNER),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(prisma.piWriteBatch.findFirst).not.toHaveBeenCalled();
      expect(mockedWrite).not.toHaveBeenCalled();
    });
  });

  describe('outcomes', () => {
    it('SKIPs a point already in its original state (a retry) and sends only the rest, without calling it drift', async () => {
      const { service } = build();
      // T1 was already restored to 7 by an earlier partial rollback.
      reads(rec([T1, 7], [T2, 20]), rec([T1, 7], [T2, 20]), rec([T1, 7]));

      const { data } = await service.rollbackService('m1', 'orig-1', GO, OWNER);

      expect(mockedWrite).toHaveBeenCalledTimes(1);
      expect(argOf<{ update_option: string }>(mockedWrite).update_option).toBe(
        'Remove',
      );
      if (data.dryRun) throw new Error('unreachable');
      expect(data.batch.status).toBe('SUCCEEDED');
    });

    it('PI accepted the restore but still holds the written value: not ok, original is NOT retired', async () => {
      const { service, calls } = build();
      reads(NOW_AS_WRITTEN(), NOW_AS_WRITTEN(), rec([T1, 10])); // T1 unchanged, T2 gone

      const { data } = await service.rollbackService('m1', 'orig-1', GO, OWNER);

      if (data.dryRun) throw new Error('unreachable');
      expect(data.batch).toMatchObject({
        status: 'PARTIAL',
        okCount: 1,
        failedCount: 1,
      });
      expect(data.batch.error).toMatch(
        /1 point\(s\) could not be restored.*again/,
      );
      expect(data.original.status).toBe('SUCCEEDED');
      expect(calls).not.toContain('update:orig-1:ROLLED_BACK');
    });

    it('a failed PI request leaves the original in place and says to run it again', async () => {
      const { service, calls } = build();
      reads(NOW_AS_WRITTEN(), NOW_AS_WRITTEN(), NOW_AS_WRITTEN());
      mockedWrite.mockRejectedValue(new Error('HTTP 503'));

      const { data } = await service.rollbackService('m1', 'orig-1', GO, OWNER);

      if (data.dryRun) throw new Error('unreachable');
      expect(data.batch.status).toBe('FAILED');
      expect(data.batch.error).toMatch(
        /PI restore failed \(Replace: HTTP 503; Remove: HTTP 503\).*run rollback again/,
      );
      expect(calls).not.toContain('update:orig-1:ROLLED_BACK');
    });

    it('a failed read-back is not a verified rollback', async () => {
      const { service, calls } = build();
      reads(NOW_AS_WRITTEN(), NOW_AS_WRITTEN(), new Error('PI read timeout'));

      const { data } = await service.rollbackService('m1', 'orig-1', GO, OWNER);

      if (data.dryRun) throw new Error('unreachable');
      expect(data.batch.status).toBe('FAILED');
      expect(data.batch.error).toMatch(
        /could not be verified: PI read timeout/,
      );
      expect(calls).not.toContain('update:orig-1:ROLLED_BACK');
    });

    it('never overwrites a non-numeric system state, even when forced: that point fails, batch PARTIAL', async () => {
      const { service } = build();
      reads(
        rec([T1, null], [T2, 20]),
        rec([T1, null], [T2, 20]),
        rec([T1, null]),
      );

      const { data } = await service.rollbackService(
        'm1',
        'orig-1',
        { force: true },
        OWNER,
      );

      // Only the Remove for T2 is ever sent; T1 (system state) is untouched.
      expect(mockedWrite).toHaveBeenCalledTimes(1);
      expect(argOf<{ update_option: string }>(mockedWrite).update_option).toBe(
        'Remove',
      );
      if (data.dryRun) throw new Error('unreachable');
      expect(data.batch).toMatchObject({ status: 'PARTIAL', okCount: 1 });
    });
  });

  describe('dry run', () => {
    it('reports counts and changes nothing', async () => {
      const { service, prisma } = build();
      reads(NOW_AS_WRITTEN());

      const { data } = await service.rollbackService(
        'm1',
        'orig-1',
        { dryRun: true },
        OWNER,
      );

      expect(data).toMatchObject({
        dryRun: true,
        tag: 'OUT.PRED',
        piAccount: 'svc-softsensor',
        replaceCount: 1,
        removeCount: 1,
        skipCount: 0,
        blockedCount: 0,
        driftCount: 0,
        blockedBy: null,
        canProceed: true,
        canForce: false,
      });
      expect(prisma.piWriteBatch.create).not.toHaveBeenCalled();
      expect(mockedWrite).not.toHaveBeenCalled();
    });

    it('reports drift as forceable but not proceedable without force', async () => {
      const { service } = build();
      reads(rec([T1, 99], [T2, 20]));
      const { data } = await service.rollbackService(
        'm1',
        'orig-1',
        { dryRun: true },
        OWNER,
      );
      expect(data).toMatchObject({
        driftCount: 1,
        canProceed: false,
        canForce: true,
      });
      if (!data.dryRun) throw new Error('unreachable');
      expect(data.drift).toEqual([{ timestamp: T1, expected: 10, actual: 99 }]);
    });

    it('reports a LIFO block as not forceable, and does not throw', async () => {
      const { service } = build({
        blocking: {
          id: 'later',
          kind: 'PREDICTION',
          status: 'PARTIAL',
          createdAt: new Date('2026-10-14T05:00:00Z'),
          rangeFrom: new Date(T1),
          rangeTo: new Date(T2),
        },
      });
      reads(NOW_AS_WRITTEN());
      const { data } = await service.rollbackService(
        'm1',
        'orig-1',
        { dryRun: true, force: true },
        OWNER,
      );
      expect(data).toMatchObject({ canProceed: false, canForce: false });
      if (!data.dryRun) throw new Error('unreachable');
      expect(data.blockedBy).toMatchObject({
        id: 'later',
        kind: 'PREDICTION',
        status: 'PARTIAL',
      });
    });
  });
});
