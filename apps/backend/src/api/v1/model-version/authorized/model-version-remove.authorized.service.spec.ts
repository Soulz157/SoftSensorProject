import { ModelVersionAuthorizedService } from './model-version.authorized.service';

/**
 * MODEL-SERVE-017-T01. `removeVersionService` only. The cases that matter
 * are the REFUSALS: a delete that gets through when it should not is either
 * an outage (PRODUCTION), a silently re-pointed rollback (a version that
 * once served), or a foreign-key error surfaced as a 500.
 */
function makeService(
  version: object | null,
  counts: { jobs?: number; logs?: number; windows?: number } = {},
) {
  const prisma = {
    model: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'm-1', workspaceId: 'w-1' }),
    },
    workspace: { findFirst: jest.fn().mockResolvedValue({ id: 'w-1' }) },
    workspaceMember: { findFirst: jest.fn().mockResolvedValue(null) },
    modelVersion: {
      findFirst: jest.fn().mockResolvedValue(version),
      delete: jest.fn().mockResolvedValue({ id: 'v-id' }),
    },
    predictionJob: {
      count: jest.fn().mockResolvedValue(counts.jobs ?? 0),
    },
    predictionLog: {
      count: jest.fn().mockResolvedValue(counts.logs ?? 0),
    },
    inferenceWindow: {
      count: jest.fn().mockResolvedValue(counts.windows ?? 0),
    },
  };
  return {
    prisma,
    service: new ModelVersionAuthorizedService(prisma as never),
  };
}

const staging = (over: object = {}) => ({
  id: 'v-id',
  version: 3,
  stage: 'STAGING',
  promotedAt: null,
  ...over,
});

const user = { id: 'u-1', role: 'USER' } as never;

describe('removeVersionService (MODEL-SERVE-017-V01)', () => {
  it('deletes a STAGING version nothing references', async () => {
    const { service, prisma } = makeService(staging());

    const res = await service.removeVersionService(user, 'm-1', 3);

    expect(prisma.modelVersion.delete).toHaveBeenCalledWith({
      where: { id: 'v-id' },
    });
    expect(res.data).toEqual({ id: 'v-id', version: 3 });
  });

  it('refuses the version serving production', async () => {
    const { service, prisma } = makeService(
      staging({ stage: 'PRODUCTION', promotedAt: new Date() }),
    );

    await expect(
      service.removeVersionService(user, 'm-1', 3),
    ).rejects.toMatchObject({ statusCode: 422 });
    expect(prisma.modelVersion.delete).not.toHaveBeenCalled();
  });

  it('refuses an ARCHIVED version that once served — it is rollback’s target', async () => {
    // The exact regression this guard exists for: deleting the most
    // recently archived promoted version re-points `rollbackService` at an
    // older one with no error anywhere.
    const { service, prisma } = makeService(
      staging({
        stage: 'ARCHIVED',
        promotedAt: new Date('2026-09-01T00:00:00.000Z'),
      }),
    );

    await expect(
      service.removeVersionService(user, 'm-1', 3),
    ).rejects.toMatchObject({ statusCode: 422 });
    expect(prisma.modelVersion.delete).not.toHaveBeenCalled();
  });

  it('refuses, naming what holds it, when inference rows still point at it', async () => {
    // Without this count the delete reaches a NoAction FK and the user sees
    // a constraint name instead of a sentence.
    const { service, prisma } = makeService(staging(), { windows: 4 });

    const err = await service
      .removeVersionService(user, 'm-1', 3)
      .then(() => null)
      .catch((e: { statusCode: number; message: string }) => e);

    expect(err?.statusCode).toBe(422);
    expect(err?.message).toContain('4 inference window(s)');
    expect(prisma.modelVersion.delete).not.toHaveBeenCalled();
  });

  it('404s for a version number this model does not have', async () => {
    const { service } = makeService(null);

    await expect(
      service.removeVersionService(user, 'm-1', 99),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('refuses a VIEWER — removal is a write, not a read', async () => {
    const { service, prisma } = makeService(staging());
    prisma.workspace.findFirst.mockResolvedValue(null);
    prisma.workspaceMember.findFirst.mockResolvedValue({ role: 'VIEWER' });

    await expect(
      service.removeVersionService(user, 'm-1', 3),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(prisma.modelVersion.delete).not.toHaveBeenCalled();
  });
});
