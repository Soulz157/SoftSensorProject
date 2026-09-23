import { DatasetAuthorizedService } from './dataset.authorized.service';

function makePrisma(datasetOverrides: Record<string, unknown> = {}) {
  return {
    dataset: {
      findUnique: jest.fn().mockResolvedValue({
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
        createdBy: { firstName: 'A', lastName: 'B' },
        ...datasetOverrides,
      }),
    },
  };
}

describe('DatasetAuthorizedService — adoptedBronzeArtifactId (DS-LAKE-017-T03)', () => {
  it('surfaces the adopted, unreclaimed BRONZE id when one exists', async () => {
    const prisma = makePrisma({ artifacts: [{ id: 'bronze-1' }] });
    const service = new DatasetAuthorizedService(prisma as never);

    const res = await service.getDatasetService('user-1', 'ds-1');

    expect(res.data.adoptedBronzeArtifactId).toBe('bronze-1');
    // currentArtifactId stays FINAL-only — ONE POINTER, NOT TWO (T01).
    expect(res.data.currentArtifactId).toBe('final-1');
  });

  it('is null when no BRONZE has been adopted (not backfilled / reclaimed / legacy)', async () => {
    const prisma = makePrisma({ artifacts: [] });
    const service = new DatasetAuthorizedService(prisma as never);

    const res = await service.getDatasetService('user-1', 'ds-1');

    expect(res.data.adoptedBronzeArtifactId).toBeNull();
  });

  it('queries only an unreclaimed BRONZE artifact, scoped by type and objectReclaimedAt', async () => {
    const prisma = makePrisma();
    const service = new DatasetAuthorizedService(prisma as never);

    await service.getDatasetService('user-1', 'ds-1');

    expect(prisma.dataset.findUnique).toHaveBeenCalledWith(
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

describe('DatasetAuthorizedService — dataset dependents (DS-LAKE-030-T01)', () => {
  function makeDependentsPrisma(
    byPointer: unknown[],
    byVersion: unknown[],
    dataset: unknown = { id: 'ds-1' },
  ) {
    return {
      dataset: { findUnique: jest.fn().mockResolvedValue(dataset) },
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

  it('404s on a dataset the caller does not own, without querying models', async () => {
    const prisma = makeDependentsPrisma([], [], null);
    const service = new DatasetAuthorizedService(prisma as never);

    await expect(
      service.listDatasetDependentsService({ id: 'user-1' } as never, 'ds-1'),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.model.findMany).not.toHaveBeenCalled();
  });
});
