import { ModelVersionAuthorizedService } from './model-version.authorized.service';

/**
 * `renameVersionService` only. The refusals matter most: a rename that
 * gets through on a version that already served rewrites what history and
 * notifications showed under that number.
 */
function makeService(version: object | null, updatedCount = 1) {
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
      updateMany: jest.fn().mockResolvedValue({ count: updatedCount }),
    },
  };
  return {
    prisma,
    service: new ModelVersionAuthorizedService(
      prisma as never,
      { enqueueDiscrete: jest.fn() } as never,
    ),
  };
}

const staging = (over: object = {}) => ({
  id: 'v-id',
  version: 3,
  stage: 'STAGING',
  ...over,
});

const user = { id: 'u-1', role: 'USER' } as never;

describe('renameVersionService', () => {
  it('renames a STAGING version, guarding the update on stage', async () => {
    const { service, prisma } = makeService(staging());

    const res = await service.renameVersionService(user, 'm-1', 3, {
      name: 'Winter data',
    });

    expect(prisma.modelVersion.updateMany).toHaveBeenCalledWith({
      where: { id: 'v-id', stage: 'STAGING' },
      data: { name: 'Winter data' },
    });
    expect(res.data).toEqual({ id: 'v-id', version: 3, name: 'Winter data' });
  });

  it('clears the label for an empty name or null', async () => {
    const { service, prisma } = makeService(staging());

    await service.renameVersionService(user, 'm-1', 3, { name: '' });
    await service.renameVersionService(user, 'm-1', 3, { name: null });

    expect(prisma.modelVersion.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'v-id', stage: 'STAGING' },
      data: { name: null },
    });
    expect(prisma.modelVersion.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'v-id', stage: 'STAGING' },
      data: { name: null },
    });
  });

  it.each(['PRODUCTION', 'ARCHIVED'])(
    'refuses a %s version without writing',
    async (stage) => {
      const { service, prisma } = makeService(staging({ stage }));

      await expect(
        service.renameVersionService(user, 'm-1', 3, { name: 'x' }),
      ).rejects.toMatchObject({ statusCode: 422 });
      expect(prisma.modelVersion.updateMany).not.toHaveBeenCalled();
    },
  );

  it('refuses when a promote lands between the read and the update', async () => {
    // Read saw STAGING, but the stage-guarded update matched nothing.
    const { service } = makeService(staging(), 0);

    await expect(
      service.renameVersionService(user, 'm-1', 3, { name: 'x' }),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('404s for an unknown version', async () => {
    const { service, prisma } = makeService(null);

    await expect(
      service.renameVersionService(user, 'm-1', 9, { name: 'x' }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.modelVersion.updateMany).not.toHaveBeenCalled();
  });

  it('403s a VIEWER — renaming is an editor action', async () => {
    const { service, prisma } = makeService(staging());
    prisma.workspace.findFirst.mockResolvedValue(null);
    prisma.workspaceMember.findFirst.mockResolvedValue({
      role: 'VIEWER',
      permissions: [],
    });

    await expect(
      service.renameVersionService(user, 'm-1', 3, { name: 'x' }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(prisma.modelVersion.updateMany).not.toHaveBeenCalled();
  });
});
