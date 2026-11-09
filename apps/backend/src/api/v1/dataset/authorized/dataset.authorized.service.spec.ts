/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- jest mocks are `any` by design */
import { DatasetAuthorizedService } from './dataset.authorized.service';

const USER = { id: 'user-1', role: 'USER' } as Auth.UserPayload;

function makePrisma(datasetOverrides: Record<string, unknown> = {}) {
  return {
    dataset: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'ds-1',
        name: 'ds',
        description: null,
        workspaceId: 'ws-1',
        sourceIds: [],
        tags: [],
        pipelineConfig: {},
        fileUrl: null,
        rowCount: 0,
        missingPct: 0,
        currentVersionId: 'v-1',
        currentArtifactId: 'final-1',
        currentArtifact: { type: 'FINAL' },
        artifacts: [],
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
        createdById: 'user-1',
        createdBy: { firstName: 'A', lastName: 'B' },
        workspace: { ownerId: 'ws-owner', members: [] },
        ...datasetOverrides,
      }),
    },
  };
}

describe('DatasetAuthorizedService — adoptedBronzeArtifactId (DS-LAKE-017-T03)', () => {
  it('surfaces the adopted, unreclaimed BRONZE id when one exists', async () => {
    const prisma = makePrisma({ artifacts: [{ id: 'bronze-1' }] });
    const service = new DatasetAuthorizedService(prisma as never);

    const res = await service.getDatasetService(USER, 'ds-1');

    expect(res.data.adoptedBronzeArtifactId).toBe('bronze-1');
    // currentArtifactId stays FINAL-only — ONE POINTER, NOT TWO (T01).
    expect(res.data.currentArtifactId).toBe('final-1');
  });

  it('is null when no BRONZE has been adopted (not backfilled / reclaimed / legacy)', async () => {
    const prisma = makePrisma({ artifacts: [] });
    const service = new DatasetAuthorizedService(prisma as never);

    const res = await service.getDatasetService(USER, 'ds-1');

    expect(res.data.adoptedBronzeArtifactId).toBeNull();
  });

  it('queries only an unreclaimed BRONZE artifact, scoped by type and objectReclaimedAt', async () => {
    const prisma = makePrisma();
    const service = new DatasetAuthorizedService(prisma as never);

    await service.getDatasetService(USER, 'ds-1');

    expect(prisma.dataset.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          artifacts: {
            where: { type: 'BRONZE', objectReclaimedAt: null },
            select: { id: true },
            take: 1,
          },
        }),
      }),
    );
  });
});

describe('DatasetAuthorizedService — workspace-wide read access', () => {
  const memberScope = {
    workspace: {
      deletedAt: null,
      OR: [{ ownerId: 'user-1' }, { members: { some: { userId: 'user-1' } } }],
    },
  };

  it('get scopes by workspace owner-or-member, not by creator', async () => {
    const prisma = makePrisma();
    const service = new DatasetAuthorizedService(prisma as never);

    await service.getDatasetService(USER, 'ds-1');

    const where = prisma.dataset.findFirst.mock.calls[0][0].where;
    expect(where).toEqual({ id: 'ds-1', ...memberScope });
    expect(where).not.toHaveProperty('createdById');
  });

  it("list returns teammates' datasets in the requested workspace", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new DatasetAuthorizedService({
      dataset: { findMany },
    } as never);

    await service.listDatasetService(USER, 'ws-1');

    expect(findMany.mock.calls[0][0].where).toEqual({
      ...memberScope,
      workspaceId: 'ws-1',
    });
  });

  it('ADMIN bypasses membership but still excludes deleted workspaces', async () => {
    const prisma = makePrisma();
    const service = new DatasetAuthorizedService(prisma as never);

    await service.getDatasetService(
      { id: 'admin-1', role: 'ADMIN' } as Auth.UserPayload,
      'ds-1',
    );

    expect(prisma.dataset.findFirst.mock.calls[0][0].where).toEqual({
      id: 'ds-1',
      workspace: { deletedAt: null },
    });
  });

  const canManageOf = async (over: Record<string, unknown>) =>
    (
      await new DatasetAuthorizedService(
        makePrisma(over) as never,
      ).getDatasetService(USER, 'ds-1')
    ).data.canManage;

  it('canManage: the creator, whatever their role', async () => {
    expect(await canManageOf({})).toBe(true);
    expect(
      await canManageOf({
        workspace: { ownerId: 'ws-owner', members: [{ role: 'VIEWER' }] },
      }),
    ).toBe(true);
  });

  it("canManage: workspace OWNER/STAFF manage a teammate's dataset", async () => {
    for (const role of ['OWNER', 'STAFF']) {
      expect(
        await canManageOf({
          createdById: 'someone-else',
          workspace: { ownerId: 'ws-owner', members: [{ role }] },
        }),
      ).toBe(true);
    }
  });

  it('canManage: the workspace creator manages any dataset', async () => {
    expect(
      await canManageOf({
        createdById: 'someone-else',
        workspace: { ownerId: 'user-1', members: [] },
      }),
    ).toBe(true);
  });

  it("canManage is false for a VIEWER on a teammate's dataset", async () => {
    expect(
      await canManageOf({
        createdById: 'someone-else',
        workspace: { ownerId: 'ws-owner', members: [{ role: 'VIEWER' }] },
      }),
    ).toBe(false);
  });
});

describe('DatasetAuthorizedService — write access (creator or OWNER/STAFF)', () => {
  const manageRow = (over: Record<string, unknown> = {}) => ({
    id: 'ds-1',
    createdById: 'someone-else',
    workspace: { ownerId: 'ws-owner', members: [{ role: 'STAFF' }] },
    ...over,
  });

  function makeWritePrisma(row: unknown) {
    return {
      dataset: {
        findFirst: jest.fn().mockResolvedValue(row),
        update: jest.fn().mockResolvedValue({
          ...(makeUpdated() as object),
        }),
        delete: jest.fn().mockResolvedValue({}),
      },
    };
  }

  function makeUpdated() {
    // `update` re-selects the full response shape.
    return {
      id: 'ds-1',
      name: 'renamed',
      description: null,
      workspaceId: 'ws-1',
      sourceIds: [],
      tags: [],
      pipelineConfig: {},
      fileUrl: null,
      rowCount: 0,
      missingPct: 0,
      currentVersionId: null,
      currentArtifactId: null,
      currentArtifact: null,
      artifacts: [],
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
      createdById: 'someone-else',
      createdBy: { firstName: 'A', lastName: 'B' },
      workspace: { ownerId: 'ws-owner', members: [{ role: 'STAFF' }] },
    };
  }

  it('STAFF who did not create the dataset can rename it', async () => {
    const prisma = makeWritePrisma(manageRow());
    const service = new DatasetAuthorizedService(prisma as never);

    await service.updateDatasetService(USER, 'ds-1', { name: 'renamed' });

    expect(prisma.dataset.update).toHaveBeenCalled();
  });

  it('STAFF who did not create the dataset can delete it', async () => {
    const prisma = makeWritePrisma(manageRow());
    const service = new DatasetAuthorizedService(prisma as never);

    await service.deleteDatasetService(USER, 'ds-1');

    expect(prisma.dataset.delete).toHaveBeenCalledWith({
      where: { id: 'ds-1' },
    });
  });

  it('a VIEWER who did not create it gets 403 on update and delete, nothing written', async () => {
    const row = manageRow({
      workspace: { ownerId: 'ws-owner', members: [{ role: 'VIEWER' }] },
    });
    const prisma = makeWritePrisma(row);
    const service = new DatasetAuthorizedService(prisma as never);

    await expect(
      service.updateDatasetService(USER, 'ds-1', { name: 'x' }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      service.deleteDatasetService(USER, 'ds-1'),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(prisma.dataset.update).not.toHaveBeenCalled();
    expect(prisma.dataset.delete).not.toHaveBeenCalled();
  });

  it('a caller outside the workspace gets 404, not 403', async () => {
    const prisma = makeWritePrisma(null);
    const service = new DatasetAuthorizedService(prisma as never);

    await expect(
      service.deleteDatasetService(USER, 'ds-1'),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.dataset.findFirst.mock.calls[0][0].where).toMatchObject({
      id: 'ds-1',
      workspace: { deletedAt: null },
    });
  });
});

describe('DatasetAuthorizedService — dataset dependents (DS-LAKE-030-T01)', () => {
  function makeDependentsPrisma(
    byPointer: unknown[],
    byVersion: unknown[],
    dataset: unknown = {
      id: 'ds-1',
      createdById: 'user-1',
      workspace: { ownerId: 'ws-owner', members: [] },
    },
  ) {
    return {
      dataset: { findFirst: jest.fn().mockResolvedValue(dataset) },
      model: { findMany: jest.fn().mockResolvedValue(byPointer) },
      modelVersion: { findMany: jest.fn().mockResolvedValue(byVersion) },
    };
  }

  const model = (id: string, name: string, over: object = {}) => ({
    id,
    name,
    inferenceSchedule: { enabled: false },
    versions: [],
    ...over,
  });

  it('V01: lists a model reachable ONLY through a pinned ModelVersion', async () => {
    // The case `Model.datasetId` alone misses: the model has been retrained
    // onto another dataset, but a saved version — here the PRODUCTION one —
    // is still pinned to the dataset being deleted.
    const prisma = makeDependentsPrisma(
      [],
      [{ model: model('m-1', 'Steam Temp', { versions: [{ id: 'v-9' }] }) }],
    );
    const service = new DatasetAuthorizedService(prisma as never);

    const res = await service.listDatasetDependentsService(
      { id: 'user-1' } as never,
      'ds-1',
    );

    expect(res.data.models).toHaveLength(1);
    expect(res.data.models[0]).toMatchObject({
      id: 'm-1',
      viaCurrentPointer: false,
      viaPinnedVersion: true,
      hasProductionVersion: true,
    });
  });

  it('V02: a model found through BOTH paths is returned once, carrying both flags', async () => {
    const prisma = makeDependentsPrisma(
      [model('m-1', 'Steam Temp')],
      [{ model: model('m-1', 'Steam Temp') }],
    );
    const service = new DatasetAuthorizedService(prisma as never);

    const res = await service.listDatasetDependentsService(
      { id: 'user-1' } as never,
      'ds-1',
    );

    expect(res.data.models).toHaveLength(1);
    expect(res.data.models[0]).toMatchObject({
      viaCurrentPointer: true,
      viaPinnedVersion: true,
    });
  });

  it('reports a running schedule, and sorts by name', async () => {
    const prisma = makeDependentsPrisma(
      [
        model('m-2', 'Zulu', { inferenceSchedule: { enabled: true } }),
        model('m-1', 'Alpha', { inferenceSchedule: null }),
      ],
      [],
    );
    const service = new DatasetAuthorizedService(prisma as never);

    const res = await service.listDatasetDependentsService(
      { id: 'user-1' } as never,
      'ds-1',
    );

    expect(res.data.models.map((m) => m.name)).toEqual(['Alpha', 'Zulu']);
    // A model with no schedule row at all is not "running" — never undefined.
    expect(res.data.models[0]?.scheduleEnabled).toBe(false);
    expect(res.data.models[1]?.scheduleEnabled).toBe(true);
  });

  it('404s on a dataset the caller cannot reach, without querying models', async () => {
    const prisma = makeDependentsPrisma([], [], null);
    const service = new DatasetAuthorizedService(prisma as never);

    await expect(
      service.listDatasetDependentsService({ id: 'user-1' } as never, 'ds-1'),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.model.findMany).not.toHaveBeenCalled();
  });
});
