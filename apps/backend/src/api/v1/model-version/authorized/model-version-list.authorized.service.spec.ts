import { ModelVersionAuthorizedService } from './model-version.authorized.service';

/**
 * MODEL-SERVE-016-T01. `listVersionsService` only — the promote/rollback
 * half of this service predates it and is covered elsewhere.
 */
function makeService(versions: unknown[]) {
  const prisma = {
    model: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'm-1', workspaceId: 'w-1' }),
    },
    workspace: { findFirst: jest.fn().mockResolvedValue({ id: 'w-1' }) },
    workspaceMember: { findFirst: jest.fn().mockResolvedValue(null) },
    modelVersion: { findMany: jest.fn().mockResolvedValue(versions) },
  };
  return {
    prisma,
    service: new ModelVersionAuthorizedService(prisma as never),
  };
}

const row = (over: object = {}) => ({
  id: 'v-id',
  version: 1,
  stage: 'ARCHIVED',
  algorithm: 'xgboost',
  metrics: { rmse: 1.5, r2: 0.9, mae: 1.1 },
  retrainStrategy: null,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  archivedAt: null,
  ...over,
});

const user = { id: 'u-1', role: 'USER' } as never;

describe('listVersionsService — training metrics (MODEL-SERVE-016-V01)', () => {
  it('yields nulls, never 0, for a version with no metrics at all', async () => {
    // A legacy row predating the metrics snapshot. 0 would read as a
    // PERFECT rmse/mae on screen — the opposite of "unknown".
    const { service } = makeService([row({ metrics: null })]);

    const res = await service.listVersionsService(user, 'm-1');

    expect(res.data.versions[0]?.metrics).toEqual({
      rmse: null,
      r2: null,
      mae: null,
    });
  });

  it('resolves each key independently, so a partial object keeps what it has', async () => {
    const { service } = makeService([row({ metrics: { rmse: 2.5 } })]);

    const res = await service.listVersionsService(user, 'm-1');

    expect(res.data.versions[0]?.metrics).toEqual({
      rmse: 2.5,
      r2: null,
      mae: null,
    });
  });

  it('treats a non-finite score as absent', async () => {
    // Reachable for real: an R2 over a constant target divides by zero, and
    // JSON serializes both NaN and Infinity to null anyway.
    const { service } = makeService([
      row({
        metrics: { rmse: 1, r2: Number.NaN, mae: Number.POSITIVE_INFINITY },
      }),
    ]);

    const res = await service.listVersionsService(user, 'm-1');

    expect(res.data.versions[0]?.metrics).toEqual({
      rmse: 1,
      r2: null,
      mae: null,
    });
  });

  it('ignores a metrics blob that is not an object', async () => {
    const { service } = makeService([row({ metrics: 'r2=0.9' })]);

    const res = await service.listVersionsService(user, 'm-1');

    expect(res.data.versions[0]?.metrics.r2).toBeNull();
  });
});

describe('listVersionsService — ordering and stage (MODEL-SERVE-016-V02)', () => {
  it('asks for newest-first and carries each stage through', async () => {
    const { service, prisma } = makeService([
      row({ id: 'v3', version: 3, stage: 'PRODUCTION' }),
      row({ id: 'v2', version: 2, stage: 'ARCHIVED' }),
      row({ id: 'v1', version: 1, stage: 'STAGING' }),
    ]);

    const res = await service.listVersionsService(user, 'm-1');

    expect(prisma.modelVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { modelId: 'm-1' },
        orderBy: { version: 'desc' },
      }),
    );
    expect(res.data.versions.map((v) => v.version)).toEqual([3, 2, 1]);
    expect(res.data.versions.map((v) => v.stage)).toEqual([
      'PRODUCTION',
      'ARCHIVED',
      'STAGING',
    ]);
    // Serialized for the wire, not handed over as a Date.
    expect(typeof res.data.versions[0]?.createdAt).toBe('string');
  });

  it('404s for a model the caller cannot reach, without listing versions', async () => {
    const { service, prisma } = makeService([]);
    prisma.model.findUnique.mockResolvedValue(null);

    await expect(
      service.listVersionsService(user, 'm-1'),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.modelVersion.findMany).not.toHaveBeenCalled();
  });
});
