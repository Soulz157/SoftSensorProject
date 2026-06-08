import { Injectable } from '@nestjs/common';
import { AppException } from '@softsensor/common';
import { PrismaEnums, PrismaService } from '@softsensor/prisma';
import { z } from 'zod';
import { NodeDataSchema } from './dto/nodes.authorized.dto';

@Injectable()
export class NodesAuthorizedService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertHasAccess(workspaceId: string, userId: string) {
    const workspace = await this.prisma.workspace.findFirst({
      where: { id: workspaceId, ownerId: userId },
      select: { id: true },
    });

    if (workspace) return;

    const member = await this.prisma.workspaceMember.findFirst({
      where: { workspaceId, userId },
    });

    if (!member) {
      throw new AppException({
        statusCode: 403,
        message: 'Forbidden',
        type: 'ERROR',
      });
    }
  }

  private async assertCanEditCanvas(workspaceId: string, userId: string) {
    const workspace = await this.prisma.workspace.findFirst({
      where: { id: workspaceId, ownerId: userId },
      select: { id: true },
    });

    if (workspace) return;

    const member = await this.prisma.workspaceMember.findFirst({
      where: { workspaceId, userId },
    });

    if (!member || member.role === 'VIEWER') {
      throw new AppException({
        statusCode: 403,
        message: 'Forbidden: editor access required',
        type: 'ERROR',
      });
    }
  }

  async listByWorkspace(workspaceId: string, userId: string) {
    await this.assertHasAccess(workspaceId, userId);

    const nodes = await this.prisma.nodes.findMany({
      where: { workspaceId },
      include: { models: true },
      orderBy: { createdAt: 'asc' },
    });

    return {
      statusCode: 200,
      message: 'Nodes fetched successfully',
      type: 'SUCCESS' as const,
      data: nodes,
    };
  }

  async createNodeService(
    workspaceId: string,
    userId: string,
    data: z.infer<typeof NodeDataSchema>,
  ) {
    await this.assertCanEditCanvas(workspaceId, userId);

    const node = await this.prisma.nodes.create({
      data: { workspaceId, data },
      include: { models: true },
    });

    return {
      statusCode: 201,
      message: 'Node created successfully',
      type: 'SUCCESS' as const,
      data: node,
    };
  }

  async updateNodeService(
    nodeId: string,
    userId: string,
    data:
      | z.infer<typeof NodeDataSchema>
      | Partial<z.infer<typeof NodeDataSchema>>,
  ) {
    const existing = await this.prisma.nodes.findUnique({
      where: { id: nodeId },
    });

    if (!existing) {
      throw new AppException({
        statusCode: 404,
        message: 'Node not found',
        type: 'ERROR',
      });
    }

    await this.assertCanEditCanvas(existing.workspaceId, userId);

    const existingData = (existing.data ?? {}) as Record<string, unknown>;
    const merged = { ...existingData, ...data };

    const updated = await this.prisma.nodes.update({
      where: { id: nodeId },
      data: { data: merged },
      include: { models: true },
    });

    return {
      statusCode: 200,
      message: 'Node updated successfully',
      type: 'SUCCESS' as const,
      data: updated,
    };
  }

  async deleteNodeService(nodeId: string, userId: string) {
    const existing = await this.prisma.nodes.findUnique({
      where: { id: nodeId },
    });

    if (!existing) {
      throw new AppException({
        statusCode: 404,
        message: 'Node not found',
        type: 'ERROR',
      });
    }

    await this.assertCanEditCanvas(existing.workspaceId, userId);

    await this.prisma.nodes.delete({ where: { id: nodeId } });
    await this.prisma.workspaceLog.create({
      data: {
        workspaceId: existing.workspaceId,
        userId,
        action: PrismaEnums.WorkspaceAction.DELETED,
        details: { nodeId },
      },
    });

    return {
      statusCode: 200,
      message: 'Node deleted successfully',
      type: 'SUCCESS' as const,
      data: null,
    };
  }
}
