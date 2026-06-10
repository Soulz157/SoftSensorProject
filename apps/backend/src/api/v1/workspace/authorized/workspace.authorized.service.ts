import { Injectable } from '@nestjs/common';
import { AppException } from '@softsensor/common';
import { PrismaService } from '@softsensor/prisma';
import type {
  EdgeItemDto,
  GetLogsQueryDto,
  InviteMemberDto,
  UpdateMemberRoleDto,
} from './dto/workspace.authorized.dto';
import { UpdateWorkspaceRequestDto } from '../admin/dto/workspace.admin.dto';

@Injectable()
export class WorkspaceAuthorizedService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertIsOwner(workspaceId: string, userId: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { ownerId: true },
    });

    if (!workspace) {
      throw new AppException({
        statusCode: 404,
        message: 'Workspace not found',
        type: 'ERROR',
      });
    }

    if (workspace.ownerId === userId) return;

    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { role: true },
    });

    if (!member || member.role !== 'OWNER') {
      throw new AppException({
        statusCode: 403,
        message: 'Only workspace owners can perform this action',
        type: 'ERROR',
      });
    }
  }

  private async assertHasAccess(workspaceId: string, userId: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId, deletedAt: null },
      select: { ownerId: true },
    });

    if (!workspace) {
      throw new AppException({
        statusCode: 404,
        message: 'Workspace not found',
        type: 'ERROR',
      });
    }

    if (workspace.ownerId === userId) return;

    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });

    if (!member) {
      throw new AppException({
        statusCode: 403,
        message: 'Access denied',
        type: 'ERROR',
      });
    }
  }

  private deriveNodeSummary(nodes: { data: unknown }[]): {
    nodeCount: number;
    alarmCount: number;
    status: 'normal' | 'warning' | 'alarm' | 'offline';
  } {
    const priority: Record<string, number> = {
      alarm: 3,
      offline: 2,
      warning: 1,
      normal: 0,
    };
    const statusMap: Record<
      number,
      'normal' | 'warning' | 'alarm' | 'offline'
    > = { 0: 'normal', 1: 'warning', 2: 'offline', 3: 'alarm' };
    let worst = 0;
    let alarmCount = 0;
    for (const node of nodes) {
      const data = node.data as Record<string, unknown>;
      const st = typeof data?.status === 'string' ? data.status : 'normal';
      if (st !== 'normal') alarmCount++;
      const p = priority[st] ?? 0;
      if (p > worst) worst = p;
    }
    return {
      nodeCount: nodes.length,
      alarmCount,
      status: statusMap[worst] ?? 'normal',
    };
  }

  async getAllWorkspaces(user: Auth.UserPayload) {
    const workspaces = await this.prisma.workspace.findMany({
      where: {
        deletedAt: null,
        OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }],
      },
      select: {
        id: true,
        color: true,
        name: true,
        icon: true,
        ownerId: true,
        updatedAt: true,
        _count: { select: { members: true, models: true } },
        nodes: { select: { data: true } },
      },
    });

    const data = workspaces.map(({ nodes, ...ws }) => ({
      ...ws,
      ...this.deriveNodeSummary(nodes),
    }));

    return {
      statusCode: 200,
      message: 'ดึงข้อมูล workspace สำเร็จ',
      type: 'SUCCESS',
      data,
    };
  }

  async getWorkspaceById(id: string, user: Auth.UserPayload) {
    if (!user) {
      throw new AppException({
        statusCode: 401,
        message: 'Unauthorized',
        type: 'ERROR',
      });
    }
    const workspace = await this.prisma.workspace.findUnique({
      where: { id, deletedAt: null },
      select: {
        id: true,
        color: true,
        name: true,
        icon: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { members: true, models: true } },
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
      message: 'ดึงข้อมูล workspace สำเร็จ',
      type: 'SUCCESS' as const,
      data: workspace,
    };
  }

  async getWorkspaceModels(id: string, userId: string) {
    await this.assertHasAccess(id, userId);

    const models = await this.prisma.model.findMany({
      where: { workspaceId: id },
      orderBy: { updatedAt: 'desc' },
    });

    return {
      statusCode: 200,
      message: 'Workspace models fetched successfully',
      type: 'SUCCESS' as const,
      data: models,
    };
  }

  async getWorkspaceLogs(id: string, userId: string, query: GetLogsQueryDto) {
    await this.assertHasAccess(id, userId);

    const { page, limit } = query;
    const skip = (page - 1) * limit;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.workspaceLog.findMany({
        where: { workspaceId: id },
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.workspaceLog.count({ where: { workspaceId: id } }),
    ]);

    return {
      statusCode: 200,
      message: 'Workspace logs fetched successfully',
      type: 'SUCCESS' as const,
      data: { items, total, page, limit },
    };
  }

  async deleteWorkspace(id: string, userId: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id },
      select: { ownerId: true, deletedAt: true },
    });

    if (!workspace || workspace.deletedAt !== null) {
      throw new AppException({
        statusCode: 404,
        message: 'Workspace not found',
        type: 'ERROR',
      });
    }

    if (workspace.ownerId !== userId) {
      throw new AppException({
        statusCode: 403,
        message: 'Only the workspace creator can delete this workspace',
        type: 'ERROR',
      });
    }
    await this.prisma.$transaction([
      this.prisma.workspace.update({
        where: { id },
        data: { deletedAt: new Date() },
      }),
      this.prisma.workspaceLog.create({
        data: {
          workspaceId: id,
          action: 'DELETED',
          details: `Workspace deleted by user ${userId}`,
          userId,
        },
      }),
    ]);

    return {
      statusCode: 200,
      message: 'Workspace deleted',
      type: 'SUCCESS' as const,
      data: null,
    };
  }

  async listMembers(workspaceId: string, userId: string) {
    await this.assertHasAccess(workspaceId, userId);

    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return {
      statusCode: 200,
      message: 'Members fetched successfully',
      type: 'SUCCESS' as const,
      data: members,
    };
  }

  async inviteMember(
    workspaceId: string,
    actorId: string,
    dto: InviteMemberDto,
  ) {
    await this.assertIsOwner(workspaceId, actorId);

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
      include: {
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
    actorId: string,
    dto: UpdateMemberRoleDto,
  ) {
    await this.assertIsOwner(workspaceId, actorId);

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
      include: {
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

  async listEdges(workspaceId: string, userId: string) {
    await this.assertHasAccess(workspaceId, userId);

    const edges = await this.prisma.edge.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
    });

    return {
      statusCode: 200,
      message: 'Edges fetched successfully',
      type: 'SUCCESS' as const,
      data: edges,
    };
  }

  async replaceEdges(
    workspaceId: string,
    userId: string,
    edges: EdgeItemDto[],
  ) {
    await this.assertHasAccess(workspaceId, userId);

    await this.prisma.$transaction([
      this.prisma.edge.deleteMany({ where: { workspaceId } }),
      this.prisma.edge.createMany({
        data: edges.map((e) => ({ ...e, workspaceId })),
      }),
    ]);

    const result = await this.prisma.edge.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
    });

    return {
      statusCode: 200,
      message: 'Edges replaced successfully',
      type: 'SUCCESS' as const,
      data: result,
    };
  }

  async removeMember(workspaceId: string, memberId: string, actorId: string) {
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

    if (member.userId !== actorId) {
      await this.assertIsOwner(workspaceId, actorId);
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

  async updateWorkspaceService(
    id: string,
    user: Auth.UserPayload,
    args: UpdateWorkspaceRequestDto,
  ) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id },
      select: { id: true, ownerId: true },
    });

    if (!workspace) {
      throw new AppException({
        statusCode: 404,
        message: 'Workspace not found',
        type: 'ERROR',
      });
    }

    const isAdmin = user.role === 'ADMIN';
    if (workspace.ownerId !== user.id && !isAdmin) {
      const member = await this.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: id, userId: user.id } },
      });
      if (!member || member.role === 'VIEWER') {
        throw new AppException({
          statusCode: 403,
          message: 'Only workspace editors can update this workspace',
          type: 'ERROR',
        });
      }
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
}
