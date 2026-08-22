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
