import { Injectable } from '@nestjs/common';
import { AppException } from '@softsensor/common';
import { PrismaService } from '@softsensor/prisma';

@Injectable()
export class NodesAuthorizedService {
  constructor(private readonly prisma: PrismaService) {}

  async listByWorkspace(workspaceId: string) {
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

  async create(workspaceId: string, data: object) {
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

  async update(nodeId: string, data: object) {
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

    const merged = { ...(existing.data as object), ...data };

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

  async remove(nodeId: string) {
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

    await this.prisma.nodes.delete({ where: { id: nodeId } });

    return {
      statusCode: 200,
      message: 'Node deleted successfully',
      type: 'SUCCESS' as const,
      data: null,
    };
  }
}
