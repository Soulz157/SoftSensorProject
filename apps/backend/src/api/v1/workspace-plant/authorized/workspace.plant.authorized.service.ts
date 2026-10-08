import { Injectable } from '@nestjs/common';
import { deriveNodeSummary, type NodeSummary } from '@/lib/node-summary';
import { AppException } from '@softsensor/common';
import { PrismaService } from '@softsensor/prisma';
import type {
  CreateWorkspacePlantDto,
  UpdateWorkspacePlantDto,
  WorkspacePlantQueryDto,
  DeleteWorkspacePlantDto,
} from './dto/workspace.plant.authorized.dto';

@Injectable()
export class WorkspacePlantAuthorizedService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertHasAccess(
    workspaceId: string,
    userId: string,
    userRole: string,
  ) {
    if (userRole === 'ADMIN') return;

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

  private async assertIsOwnerOrStaff(workspaceId: string, userId: string) {
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
      select: { role: true },
    });

    if (!member || member.role === 'VIEWER') {
      throw new AppException({
        statusCode: 403,
        message: 'Only workspace owners or staff can perform this action',
        type: 'ERROR',
      });
    }
  }

  private async assertIsOwner(workspaceId: string, userId: string) {
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

  private deriveNodeSummary(nodes: { data: unknown }[]): NodeSummary {
    return deriveNodeSummary(nodes);
  }

  async getPlants(
    query: WorkspacePlantQueryDto,
    userId: string,
    userRole: string,
  ) {
    await this.assertHasAccess(query.workspaceId, userId, userRole);

    const plants = await this.prisma.workspacePlant.findMany({
      where: { workspaceId: query.workspaceId },
      include: { nodes: { select: { data: true } } },
      orderBy: { createdAt: 'asc' },
    });

    const data = plants.map(({ nodes, ...plant }) => ({
      ...plant,
      ...this.deriveNodeSummary(nodes),
    }));

    return {
      statusCode: 200,
      message: 'Plants fetched successfully',
      type: 'SUCCESS' as const,
      data,
    };
  }

  async createPlant(
    workspaceId: string,
    dto: CreateWorkspacePlantDto,
    userId: string,
  ) {
    await this.assertIsOwnerOrStaff(workspaceId, userId);

    const plan = await this.prisma.workspacePlant.create({
      data: { workspaceId, ...dto },
    });

    return {
      statusCode: 201,
      message: 'Plant created successfully',
      type: 'SUCCESS' as const,
      data: {
        ...plan,
        nodeCount: 0,
        alarmCount: 0,
        warningCount: 0,
        offlineCount: 0,
        status: 'normal' as const,
      },
    };
  }

  async updatePlant(
    planId: string,
    dto: UpdateWorkspacePlantDto,
    userId: string,
  ) {
    const plan = await this.prisma.workspacePlant.findUnique({
      where: { id: planId },
      select: { workspaceId: true },
    });

    if (!plan) {
      throw new AppException({
        statusCode: 404,
        message: 'Plant not found',
        type: 'ERROR',
      });
    }

    await this.assertIsOwnerOrStaff(plan.workspaceId, userId);

    const updated = await this.prisma.workspacePlant.update({
      where: { id: planId },
      data: dto,
      include: { nodes: { select: { data: true } } },
    });

    const { nodes, ...rest } = updated;
    return {
      statusCode: 200,
      message: 'Plant updated successfully',
      type: 'SUCCESS' as const,
      data: { ...rest, ...this.deriveNodeSummary(nodes) },
    };
  }

  async deletePlant(dto: DeleteWorkspacePlantDto, userId: string) {
    const plan = await this.prisma.workspacePlant.findUnique({
      where: { id: dto.plantId },
      select: { workspaceId: true },
    });

    if (!plan) {
      throw new AppException({
        statusCode: 404,
        message: 'Plant not found',
        type: 'ERROR',
      });
    }

    await this.assertIsOwner(plan.workspaceId, userId);

    await this.prisma.workspacePlant.delete({ where: { id: dto.plantId } });

    return {
      statusCode: 200,
      message: 'Plant deleted successfully',
      type: 'SUCCESS' as const,
      data: null,
    };
  }
}
