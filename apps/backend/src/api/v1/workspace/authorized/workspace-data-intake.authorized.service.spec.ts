import { WorkspaceDataIntakeAuthorizedService } from './workspace-data-intake.authorized.service';

jest.mock('@softsensor/common', () => ({
  AppException: class AppException extends Error {
    readonly statusCode: number;
    constructor(body: { statusCode: number; message: string; type: string }) {
      super(body.message);
      this.statusCode = body.statusCode;
    }
  },
}));

jest.mock('@softsensor/prisma', () => ({
  PrismaService: class {},
  // Tagged-template stand-ins: enough to see the scope fragment being added.
  PrismaTypes: {
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
      sql: strings.join('?'),
      values,
    }),
    empty: { sql: '', values: [] },
  },
}));

jest.mock('./workspace.authorized.service', () => ({
  WorkspaceAuthorizedService: class WorkspaceAuthorizedService {},
}));

const NOW = new Date('2026-11-06T12:30:00.000Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

const ADMIN = { id: 'admin-1', role: 'ADMIN' } as Auth.UserPayload;
const USER = { id: 'user-1', role: 'USER' } as Auth.UserPayload;

function makeService() {
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    workspace: {
      findFirst: jest.fn().mockResolvedValue({ id: 'ws1' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    tagObservation: { findMany: jest.fn().mockResolvedValue([]) },
    model: { findMany: jest.fn().mockResolvedValue([]) },
    datasetArtifact: { findMany: jest.fn().mockResolvedValue([]) },
    dataset: {
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
    },
  };
  const access = { assertHasAccess: jest.fn().mockResolvedValue(undefined) };
  const service = new WorkspaceDataIntakeAuthorizedService(
    prisma as never,
    access as never,
  );
  return { service, prisma, access };
}

function observation(over: Record<string, unknown> = {}) {
  return {
    tag: 'FI001.PV',
    lastValue: 3.2,
    lastStatus: 1,
    lastSeenAt: minutesAgo(5),
    lastChangedAt: minutesAgo(35),
    model: {
      id: 'm1',
      name: 'Model 1',
      workspaceId: 'ws1',
      inferenceSchedule: {
        enabled: true,
        livePredictEnabled: false,
        cadenceMinutes: 60,
      },
    },
    ...over,
  };
}

describe('WorkspaceDataIntakeAuthorizedService.getWorkspaceIntake', () => {
  it('stops at the access check for a non-member and runs no query', async () => {
    const { service, prisma, access } = makeService();
    access.assertHasAccess.mockRejectedValue(new Error('Access denied'));

    await expect(
      service.getWorkspaceIntake('ws1', USER, '24h', NOW),
    ).rejects.toThrow('Access denied');

    expect(access.assertHasAccess).toHaveBeenCalledWith(
      'ws1',
      'user-1',
      'USER',
    );
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.tagObservation.findMany).not.toHaveBeenCalled();
    expect(prisma.datasetArtifact.findMany).not.toHaveBeenCalled();
  });

  it('404s for a workspace that does not exist (admin bypasses the access check)', async () => {
    const { service, prisma } = makeService();
    prisma.workspace.findFirst.mockResolvedValue(null);

    await expect(
      service.getWorkspaceIntake('gone', ADMIN, '24h', NOW),
    ).rejects.toThrow('Workspace not found');
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('scopes every query to the workspace', async () => {
    const { service, prisma } = makeService();
    await service.getWorkspaceIntake('ws1', ADMIN, '24h', NOW);

    expect(prisma.tagObservation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { model: { workspaceId: 'ws1' } } }),
    );
    expect(prisma.model.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspaceId: 'ws1' }) as object,
      }),
    );
    expect(prisma.datasetArtifact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          objectReclaimedAt: null,
          OR: [
            { dataset: { workspaceId: 'ws1' } },
            { draft: { workspaceId: 'ws1' } },
          ],
        },
      }),
    );
    expect(prisma.dataset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: 'ws1' } }),
    );
    // both raw aggregates carry the workspace as a bound parameter
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    for (const [query] of prisma.$queryRaw.mock.calls as [
      { values: unknown[] },
    ][]) {
      // nested inside the `AND m."workspaceId" = ${id}` fragment
      expect(JSON.stringify(query.values)).toContain('"ws1"');
    }
  });

  it('builds totals, tag rows and per-dataset bytes from the stored state', async () => {
    const { service, prisma } = makeService();
    prisma.$queryRaw
      .mockResolvedValueOnce([
        { bucket: 0, workspaceId: 'ws1', rows: 100, badWeighted: 500 },
      ])
      .mockResolvedValueOnce([{ bucket: 0, workspaceId: 'ws1', rows: 20 }]);
    prisma.tagObservation.findMany.mockResolvedValue([
      observation(),
      observation({
        tag: 'TI002.PV',
        lastStatus: 0,
        model: {
          id: 'm2',
          name: 'Model 2',
          workspaceId: 'ws1',
          // schedule off → never counted as live Good
          inferenceSchedule: {
            enabled: false,
            livePredictEnabled: false,
            cadenceMinutes: 60,
          },
        },
      }),
    ]);
    prisma.model.findMany.mockResolvedValue([{ workspaceId: 'ws1' }]);
    prisma.datasetArtifact.findMany.mockResolvedValue([
      {
        objectKey: 'a',
        sizeBytes: BigInt(1000),
        datasetId: 'd1',
        draftId: null,
        dataset: { workspaceId: 'ws1' },
        draft: null,
      },
      {
        objectKey: 'b',
        sizeBytes: BigInt(40),
        datasetId: null,
        draftId: 'x',
        dataset: null,
        draft: { workspaceId: 'ws1', status: 'ABANDONED' },
      },
    ]);
    prisma.dataset.findMany.mockResolvedValue([
      {
        id: 'd1',
        name: 'Hot train',
        tags: ['FI001.PV', 'TI002.PV'],
        rowCount: 8760,
        missingPct: 1.5,
        updatedAt: minutesAgo(60),
      },
    ]);

    const res = await service.getWorkspaceIntake('ws1', ADMIN, '24h', NOW);
    const out = res.data;

    expect(out.totals.liveModels).toBe(1);
    expect(out.totals.rowsIngested).toBe(120);
    expect(out.totals.badCellPct).toBe(5);
    expect(out.totals.tags).toEqual({
      good: 0,
      bad: 1,
      questionable: 0,
      noReading: 0,
      notLive: 1,
    });
    expect(out.totals.storage).toEqual({
      savedBytes: 1000,
      activeDraftBytes: 0,
      cleanupBytes: 40,
      totalBytes: 1040,
    });
    expect(out.totals.datasetCount).toBe(1);
    expect(out.tags.map((t) => t.quality)).toEqual(['bad', 'notLive']);
    expect(out.datasets).toEqual([
      expect.objectContaining({ id: 'd1', sizeBytes: 1000, tagCount: 2 }),
    ]);
    expect(out.ingestion.length).toBeGreaterThan(20);
  });
});

describe('response envelope', () => {
  // The client reads `res.data` (fetchClient returns the body as-is, and every
  // sibling service wraps in { statusCode, message, type, data }). A bare
  // object left `res.data` undefined and crashed the page.
  it('wraps both responses in the { type, data } envelope', async () => {
    const { service } = makeService();

    const one = await service.getWorkspaceIntake('ws1', ADMIN, '24h', NOW);
    expect(one).toMatchObject({ statusCode: 200, type: 'SUCCESS' });
    expect(one.data.scope).toBe('workspace');

    const all = await service.getAllIntake('24h', NOW);
    expect(all).toMatchObject({ statusCode: 200, type: 'SUCCESS' });
    expect(all.data.scope).toBe('all');
  });
});

describe('WorkspaceDataIntakeAuthorizedService.getAllIntake', () => {
  it('runs unscoped queries and returns one row per workspace', async () => {
    const { service, prisma } = makeService();
    prisma.workspace.findMany.mockResolvedValue([
      { id: 'ws1', name: 'Alpha' },
      { id: 'ws2', name: 'Beta' },
    ]);
    prisma.$queryRaw
      .mockResolvedValueOnce([
        { bucket: 0, workspaceId: 'ws1', rows: 10, badWeighted: 0 },
        { bucket: 0, workspaceId: 'ws2', rows: 30, badWeighted: 0 },
      ])
      .mockResolvedValueOnce([]);
    prisma.tagObservation.findMany.mockResolvedValue([observation()]);
    prisma.model.findMany.mockResolvedValue([{ workspaceId: 'ws1' }]);
    prisma.datasetArtifact.findMany.mockResolvedValue([
      {
        objectKey: 'a',
        sizeBytes: BigInt(700),
        datasetId: 'd1',
        draftId: null,
        dataset: { workspaceId: 'ws2' },
        draft: null,
      },
    ]);
    prisma.dataset.groupBy.mockResolvedValue([
      { workspaceId: 'ws2', _count: { _all: 3 } },
    ]);

    const out = (await service.getAllIntake('24h', NOW)).data;

    expect(prisma.tagObservation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: undefined }),
    );
    expect(out.workspaces).toEqual([
      expect.objectContaining({
        id: 'ws1',
        liveModels: 1,
        rowsIngested: 10,
        storageBytes: 0,
        datasetCount: 0,
        tags: expect.objectContaining({ bad: 1 }) as object,
      }),
      expect.objectContaining({
        id: 'ws2',
        liveModels: 0,
        rowsIngested: 30,
        storageBytes: 700,
        datasetCount: 3,
      }),
    ]);
    expect(out.totals.rowsIngested).toBe(40);
    expect(out.totals.storage.totalBytes).toBe(700);
    expect(out.totals.datasetCount).toBe(3);
    expect(out.totals.tags.bad).toBe(1);
  });
});
