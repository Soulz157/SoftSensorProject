import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTypes } from '@softsensor/prisma';
import type {
  ActivityLogQueryDto,
  AdminUserQueryDto,
  PaginationQueryDto,
  UpdateUserRoleDto,
} from './dto/auth.admin.dto';
import { AppException } from '@softsensor/common';

type AuthLogActionFilter = 'LOGIN' | 'LOGOUT';

@Injectable()
export class AuthAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async listActivityLog(args: ActivityLogQueryDto) {
    const { page, limit, action, userId } = args;

    const where: {
      action?: AuthLogActionFilter;
      userId?: string;
    } = {
      ...(action ? { action } : {}),
      ...(userId ? { userId } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.authLog.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.authLog.count({ where }),
    ]);

    return {
      statusCode: 200,
      message: 'Activity log fetched',
      type: 'SUCCESS',
      data: { items, total, page, limit },
    };
  }

  async listUserStats(args: PaginationQueryDto) {
    const { page, limit } = args;

    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          role: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.user.count(),
    ]);

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const countMap = new Map<string, number>();

    if (users.length > 0) {
      const groups = await this.prisma.authLog.groupBy({
        by: ['userId'],
        where: {
          action: 'LOGIN',
          createdAt: { gte: sevenDaysAgo },
          userId: { in: users.map((u) => u.id) },
        },
        _count: { id: true },
      });

      for (const g of groups) {
        countMap.set(g.userId, g._count.id);
      }
    }

    const items = users.map((u) => ({
      ...u,
      logins7d: countMap.get(u.id) ?? 0,
    }));

    return {
      statusCode: 200,
      message: 'User stats fetched',
      type: 'SUCCESS',
      data: { items, total, page, limit },
    };
  }

  async listUsers(args: AdminUserQueryDto) {
    const { page, limit, search, role, status } = args;

    const where: PrismaTypes.UserWhereInput = {
      ...(search
        ? {
            OR: [
              { email: { contains: search, mode: 'insensitive' } },
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(role ? { role } : {}),
      ...(status === 'blocked'
        ? { blockedAt: { not: null }, deletedAt: null }
        : status === 'deleted'
          ? { deletedAt: { not: null } }
          : status === 'active'
            ? { blockedAt: null, deletedAt: null }
            : { deletedAt: null }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          company: true,
          role: true,
          createdAt: true,
          blockedAt: true,
          deletedAt: true,
          _count: { select: { workspaces: true } },
          subscriptions: {
            where: { status: 'ACTIVE' },
            include: { plan: { select: { id: true, name: true } } },
            take: 1,
            orderBy: { createdAt: 'desc' },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      statusCode: 200,
      message: 'Users fetched successfully',
      type: 'SUCCESS',
      data: { items, total, page, limit },
    };
  }

  async updateUserRole(
    actorId: string,
    targetId: string,
    args: UpdateUserRoleDto,
  ) {
    if (actorId === targetId) {
      throw new AppException({
        statusCode: 400,
        message: 'Cannot change your own role',
        type: 'ERROR',
      });
    }
    const user = await this.prisma.user.update({
      where: { id: targetId },
      data: { role: args.role },
      select: { id: true, email: true, role: true },
    });
    return {
      statusCode: 200,
      message: 'User role updated',
      type: 'SUCCESS',
      data: user,
    };
  }

  async toggleBlockUser(actorId: string, targetId: string) {
    const current = await this.prisma.user.findUniqueOrThrow({
      where: { id: targetId },
      select: { blockedAt: true, deletedAt: true },
    });

    if (current.deletedAt) {
      throw new AppException({
        statusCode: 400,
        message: 'Cannot block a deleted user',
        type: 'ERROR',
      });
    }

    const user = await this.prisma.user.update({
      where: { id: targetId },
      data: { blockedAt: current.blockedAt ? null : new Date() },
      select: { id: true, email: true, blockedAt: true },
    });

    return {
      statusCode: 200,
      message: user.blockedAt ? 'User blocked' : 'User unblocked',
      type: 'SUCCESS',
    };
  }

  async softDeleteUser(actorId: string, targetId: string) {
    const currentUser = await this.prisma.user.findUniqueOrThrow({
      where: { id: targetId },
      select: { deletedAt: true, email: true },
    });
    if (currentUser.deletedAt) {
      throw new AppException({
        statusCode: 400,
        message: 'User already deleted',
        type: 'ERROR',
      });
    }
    const scrambledEmail = `${currentUser.email}.deleted.${Date.now()}`;

    await this.prisma.user.update({
      where: { id: targetId },
      data: { deletedAt: new Date(), email: scrambledEmail },
      select: { id: true, email: true, deletedAt: true },
    });

    //TODO

    return {
      statusCode: 200,
      message: 'User deleted',
      type: 'SUCCESS',
    };
  }
}
