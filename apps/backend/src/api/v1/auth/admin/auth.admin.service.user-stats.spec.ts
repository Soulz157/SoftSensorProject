import { AuthAdminService } from './auth.admin.service';
import type { PrismaService } from '@softsensor/prisma';

jest.mock('@softsensor/common', () => ({
  AppException: class AppException extends Error {},
}));
jest.mock('@softsensor/prisma', () => ({ PrismaService: class {} }));

describe('AuthAdminService.listUserStats — soft-deleted users', () => {
  const build = () => {
    const prisma = {
      user: {
        findMany: jest.fn().mockReturnValue('FIND'),
        count: jest.fn().mockReturnValue('COUNT'),
      },
      authLog: { groupBy: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn().mockResolvedValue([[], 0]),
    };
    return {
      prisma,
      service: new AuthAdminService(prisma as unknown as PrismaService),
    };
  };

  it('neither lists nor counts accounts with deletedAt set', async () => {
    const { prisma, service } = build();
    await service.listUserStats({ page: 1, limit: 1 });
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deletedAt: null } }),
    );
    expect(prisma.user.count).toHaveBeenCalledWith({
      where: { deletedAt: null },
    });
  });

  it('reports the total from the filtered count', async () => {
    const { prisma, service } = build();
    prisma.$transaction.mockResolvedValue([[], 38]);
    const res = await service.listUserStats({ page: 1, limit: 1 });
    expect(res.data.total).toBe(38);
  });
});
