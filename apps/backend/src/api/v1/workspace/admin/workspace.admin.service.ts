import { Injectable } from '@nestjs/common';
import { AppException } from '@softsensor/common';
import { PrismaEnums, PrismaService } from '@softsensor/prisma';
import {
  AdminWorkspaceQueryDto,
  CreateWorkspaceRequestDto,
  DeleteWorkspaceRequestDto,
  UpdateWorkspaceRequestDto,
} from './dto/workspace.admin.dto';

@Injectable()
export class WorkspaceAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async listWorkspaces(args: AdminWorkspaceQueryDto) {
    const { page, limit, search } = args;
    const where = {
      deletedAt: null,
      ...(search
        ? { name: { contains: search, mode: 'insensitive' as const } }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.workspace.findMany({
        where,
        include: {
          owner: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          _count: { select: { models: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.workspace.count({ where }),
    ]);

    return {
      statusCode: 200,
      message: 'Workspaces fetched successfully',
      type: 'SUCCESS' as const,
      data: { items, total, page, limit },
    };
  }

  async createWorkspace(
    user: Auth.UserPayload,
    args: CreateWorkspaceRequestDto,
  ) {
    const { name, color, icon } = args;

    const [workspace] = await this.prisma.$transaction([
      this.prisma.workspace.create({
        data: {
          name,
          color,
          icon,
          ownerId: user.id,
          members: {
            create: {
              userId: user.id,
              role: 'OWNER',
            },
          },
        },
        select: {
          id: true,
          name: true,
          color: true,
          icon: true,
        },
      }),
    ]);

    return {
      statusCode: 201,
      message: 'สร้าง workspace สำเร็จ',
      type: 'SUCCESS' as const,
      data: workspace,
    };
  }

  async deleteWorkspace(
    user: Auth.UserPayload,
    args: DeleteWorkspaceRequestDto,
  ) {
    if (user.role !== PrismaEnums.Role.ADMIN) {
      throw new AppException({
        statusCode: 403,
        message: 'Forbidden',
        type: 'ERROR',
      });
    }
    const { workspaceId } = args;

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
    });

    if (!workspace) {
      throw new AppException({
        statusCode: 404,
        message: 'Workspace not found',
        type: 'ERROR',
      });
    }

    await this.prisma.workspace.update({
      where: { id: workspace.id },
      data: { deletedAt: new Date() },
    });

    return {
      statusCode: 200,
      message: 'Workspace deleted successfully',
      type: 'SUCCESS' as const,
    };
  }

  async updateWorkspace(
    id: string,
    user: Auth.UserPayload,
    args: UpdateWorkspaceRequestDto,
  ) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id },
      select: {
        members: {
          where: { userId: user.id },
          select: { role: true },
        },
      },
    });

    if (!workspace) {
      throw new AppException({
        statusCode: 404,
        message: 'Workspace not found',
        type: 'ERROR',
      });
    }

    const memberRole = workspace.members[0]?.role;

    if (memberRole !== PrismaEnums.WorkspaceRole.OWNER) {
      throw new AppException({
        statusCode: 403,
        message: 'Forbidden: คุณไม่มีสิทธิ์ในการแก้ไข workspace นี้',
        type: 'ERROR',
      });
    }

    const { name, color, icon } = args;

    await this.prisma.$transaction([
      this.prisma.workspace.update({
        where: { id },
        data: { name, color, icon },
      }),
      this.prisma.workspaceLog.create({
        data: {
          workspaceId: id,
          userId: user.id,
          action: 'UPDATED',
          details: `Workspace updated by ${user.firstName} ${user.lastName}`,
        },
      }),
    ]);

    return {
      statusCode: 200,
      message: 'Workspace updated successfully',
      type: 'SUCCESS' as const,
    };
  }
}
