import { Injectable } from '@nestjs/common';
import { AppException } from '@softsensor/common';
import { PrismaService } from '@softsensor/prisma';
import {
  AdminInviteMemberDto,
  AdminMoveMemberDto,
  AdminUpdateMemberRoleDto,
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

  async getWorkspaceById(id: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id, deletedAt: null },
      select: {
        id: true,
        name: true,
        icon: true,
        color: true,
        description: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { members: true, models: true } },
        members: {
          select: {
            id: true,
            userId: true,
            role: true,
            createdAt: true,
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
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

    return {
      statusCode: 200,
      message: 'Workspace fetched successfully',
      type: 'SUCCESS' as const,
      data: workspace,
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
            create: { userId: user.id, role: 'OWNER' },
          },
        },
        select: { id: true, name: true, color: true, icon: true },
      }),
    ]);

    return {
      statusCode: 201,
      message: 'สร้าง workspace สำเร็จ',
      type: 'SUCCESS' as const,
      data: workspace,
    };
  }

  async updateWorkspace(
    id: string,
    user: Auth.UserPayload,
    args: UpdateWorkspaceRequestDto,
  ) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!workspace) {
      throw new AppException({
        statusCode: 404,
        message: 'Workspace not found',
        type: 'ERROR',
      });
    }

    const { name, color, icon, description } = args;

    await this.prisma.$transaction([
      this.prisma.workspace.update({
        where: { id },
        data: {
          ...(name !== undefined && { name }),
          ...(color !== undefined && { color }),
          ...(icon !== undefined && { icon }),
          ...(description !== undefined && { description }),
        },
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

  async deleteWorkspace(
    user: Auth.UserPayload,
    args: DeleteWorkspaceRequestDto,
  ) {
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

  async inviteMember(workspaceId: string, dto: AdminInviteMemberDto) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!workspace) {
      throw new AppException({
        statusCode: 404,
        message: 'Workspace not found',
        type: 'ERROR',
      });
    }

    const target = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });
    if (!target) {
      throw new AppException({
        statusCode: 404,
        message: 'User not found',
        type: 'ERROR',
      });
    }

    const existing = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: target.id } },
    });
    if (existing) {
      throw new AppException({
        statusCode: 409,
        message: 'User is already a member',
        type: 'ERROR',
      });
    }

    const member = await this.prisma.workspaceMember.create({
      data: { workspaceId, userId: target.id, role: dto.role },
      select: {
        id: true,
        userId: true,
        role: true,
        createdAt: true,
        user: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });

    return {
      statusCode: 201,
      message: 'Member invited successfully',
      type: 'SUCCESS' as const,
      data: member,
    };
  }

  async updateMemberRole(
    workspaceId: string,
    memberId: string,
    dto: AdminUpdateMemberRoleDto,
  ) {
    const member = await this.prisma.workspaceMember.findFirst({
      where: { id: memberId, workspaceId },
    });
    if (!member) {
      throw new AppException({
        statusCode: 404,
        message: 'Member not found',
        type: 'ERROR',
      });
    }

    if (member.role === 'OWNER' && dto.role !== 'OWNER') {
      const ownerCount = await this.prisma.workspaceMember.count({
        where: { workspaceId, role: 'OWNER' },
      });
      if (ownerCount <= 1) {
        throw new AppException({
          statusCode: 400,
          message: 'Cannot demote the last owner',
          type: 'ERROR',
        });
      }
    }

    const updated = await this.prisma.workspaceMember.update({
      where: { id: memberId },
      data: { role: dto.role },
      select: {
        id: true,
        userId: true,
        role: true,
        createdAt: true,
        user: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });

    return {
      statusCode: 200,
      message: 'Member role updated',
      type: 'SUCCESS' as const,
      data: updated,
    };
  }

  async removeMember(workspaceId: string, memberId: string) {
    const member = await this.prisma.workspaceMember.findFirst({
      where: { id: memberId, workspaceId },
    });
    if (!member) {
      throw new AppException({
        statusCode: 404,
        message: 'Member not found',
        type: 'ERROR',
      });
    }

    if (member.role === 'OWNER') {
      const ownerCount = await this.prisma.workspaceMember.count({
        where: { workspaceId, role: 'OWNER' },
      });
      if (ownerCount <= 1) {
        throw new AppException({
          statusCode: 400,
          message: 'Cannot remove the last owner',
          type: 'ERROR',
        });
      }
    }

    await this.prisma.workspaceMember.delete({ where: { id: memberId } });

    return {
      statusCode: 200,
      message: 'Member removed',
      type: 'SUCCESS' as const,
      data: null,
    };
  }

  async moveMember(
    sourceWorkspaceId: string,
    memberId: string,
    dto: AdminMoveMemberDto,
  ) {
    const { targetWorkspaceId } = dto;

    const member = await this.prisma.workspaceMember.findFirst({
      where: { id: memberId, workspaceId: sourceWorkspaceId },
    });
    if (!member) {
      throw new AppException({
        statusCode: 404,
        message: 'Member not found',
        type: 'ERROR',
      });
    }

    if (targetWorkspaceId === sourceWorkspaceId) {
      throw new AppException({
        statusCode: 400,
        message: 'Member is already in this workspace',
        type: 'ERROR',
      });
    }

    const targetWorkspace = await this.prisma.workspace.findUnique({
      where: { id: targetWorkspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!targetWorkspace) {
      throw new AppException({
        statusCode: 404,
        message: 'Target workspace not found',
        type: 'ERROR',
      });
    }

    const existing = await this.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: targetWorkspaceId,
          userId: member.userId,
        },
      },
    });
    if (existing) {
      throw new AppException({
        statusCode: 409,
        message: 'User is already a member of the target workspace',
        type: 'ERROR',
      });
    }

    if (member.role === 'OWNER') {
      const ownerCount = await this.prisma.workspaceMember.count({
        where: { workspaceId: sourceWorkspaceId, role: 'OWNER' },
      });
      if (ownerCount <= 1) {
        throw new AppException({
          statusCode: 400,
          message: 'Cannot move the last owner',
          type: 'ERROR',
        });
      }
    }

    const moved = await this.prisma.workspaceMember.update({
      where: { id: memberId },
      data: { workspaceId: targetWorkspaceId },
      select: {
        id: true,
        userId: true,
        role: true,
        createdAt: true,
        user: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });

    return {
      statusCode: 200,
      message: 'Member moved',
      type: 'SUCCESS' as const,
      data: moved,
    };
  }
}
