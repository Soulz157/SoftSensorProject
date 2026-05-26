import { Injectable } from '@nestjs/common';
import { PrismaService } from '@softsensor/prisma';
import type {
  ActivityLogQueryDto,
  PaginationQueryDto,
} from './dto/auth.admin.dto';

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
      type: 'SUCCESS' as const,
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
      type: 'SUCCESS' as const,
      data: { items, total, page, limit },
    };
  }
}
