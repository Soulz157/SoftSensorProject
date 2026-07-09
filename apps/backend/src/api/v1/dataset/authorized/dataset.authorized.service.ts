import { Injectable } from '@nestjs/common';
import {
  PrismaService,
  PrismaTypes,
  type PrismaModels,
} from '@softsensor/prisma';
import { AppException } from '@softsensor/common';
import type {
  CreateDatasetDto,
  UpdateDatasetDto,
} from './dto/dataset.authorized.dto';

type DatasetWithUser = PrismaModels.DatasetModel & {
  createdBy: Pick<PrismaModels.UserModel, 'firstName' | 'lastName'>;
};

@Injectable()
export class DatasetAuthorizedService {
  constructor(private readonly prisma: PrismaService) {}

  private mapToResponse(item: DatasetWithUser) {
    return {
      id: item.id,
      name: item.name,
      description: item.description,
      workspaceId: item.workspaceId,
      sourceIds: item.sourceIds,
      tags: item.tags,
      pipelineConfig: item.pipelineConfig,
      fileUrl: item.fileUrl,
      rowCount: item.rowCount,
      missingPct: item.missingPct,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      createdBy:
        [item.createdBy.firstName, item.createdBy.lastName]
          .filter(Boolean)
          .join(' ') || 'Unknown',
    };
  }

  private async assertWorkspaceAccess(workspaceId: string, userId: string) {
    const workspace = await this.prisma.workspace.findFirst({
      where: {
        id: workspaceId,
        deletedAt: null,
        OR: [{ ownerId: userId }, { members: { some: { userId } } }],
      },
      select: { id: true },
    });
    if (!workspace) {
      throw new AppException({
        statusCode: 404,
        message: 'Workspace not found',
        type: 'ERROR',
      });
    }
  }

  async listDatasetService(userId: string, workspaceId?: string) {
    const items = await this.prisma.dataset.findMany({
      where: {
        createdById: userId,
        ...(workspaceId && { workspaceId }),
      },
      include: { createdBy: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return {
      statusCode: 200,
      message: 'Datasets fetched successfully',
      type: 'SUCCESS' as const,
      data: items.map((item) => this.mapToResponse(item)),
    };
  }

  async getDatasetService(userId: string, id: string) {
    const item = await this.prisma.dataset.findUnique({
      where: { id },
      include: { createdBy: { select: { firstName: true, lastName: true } } },
    });
    if (!item || item.createdById !== userId) {
      throw new AppException({
        statusCode: 404,
        message: 'Dataset not found',
        type: 'ERROR',
      });
    }
    return {
      statusCode: 200,
      message: 'Dataset fetched successfully',
      type: 'SUCCESS' as const,
      data: this.mapToResponse(item),
    };
  }

  async createDatasetService(userId: string, dto: CreateDatasetDto) {
    await this.assertWorkspaceAccess(dto.workspaceId, userId);
    const item = await this.prisma.dataset.create({
      data: {
        name: dto.name,
        description: dto.description ?? null,
        workspaceId: dto.workspaceId,
        sourceIds: dto.sourceIds,
        tags: dto.tags,
        pipelineConfig: dto.pipelineConfig as PrismaTypes.InputJsonValue,
        fileUrl: dto.fileUrl ?? null,
        rowCount: dto.rowCount,
        missingPct: dto.missingPct,
        createdById: userId,
      },
      include: { createdBy: { select: { firstName: true, lastName: true } } },
    });
    return {
      statusCode: 201,
      message: 'Dataset created successfully',
      type: 'SUCCESS' as const,
      data: this.mapToResponse(item),
    };
  }

  async updateDatasetService(
    userId: string,
    id: string,
    dto: UpdateDatasetDto,
  ) {
    const existing = await this.prisma.dataset.findUnique({ where: { id } });
    if (!existing || existing.createdById !== userId) {
      throw new AppException({
        statusCode: 404,
        message: 'Dataset not found',
        type: 'ERROR',
      });
    }
    const item = await this.prisma.dataset.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.sourceIds !== undefined && { sourceIds: dto.sourceIds }),
        ...(dto.tags !== undefined && { tags: dto.tags }),
        ...(dto.pipelineConfig !== undefined && {
          pipelineConfig: dto.pipelineConfig as PrismaTypes.InputJsonValue,
        }),
        ...(dto.fileUrl !== undefined && { fileUrl: dto.fileUrl }),
        ...(dto.rowCount !== undefined && { rowCount: dto.rowCount }),
        ...(dto.missingPct !== undefined && { missingPct: dto.missingPct }),
      },
      include: { createdBy: { select: { firstName: true, lastName: true } } },
    });
    return {
      statusCode: 200,
      message: 'Dataset updated successfully',
      type: 'SUCCESS' as const,
      data: this.mapToResponse(item),
    };
  }

  async deleteDatasetService(userId: string, id: string) {
    const existing = await this.prisma.dataset.findUnique({ where: { id } });
    if (!existing || existing.createdById !== userId) {
      throw new AppException({
        statusCode: 404,
        message: 'Dataset not found',
        type: 'ERROR',
      });
    }
    await this.prisma.dataset.delete({ where: { id } });
    return {
      statusCode: 200,
      message: 'Dataset deleted successfully',
      type: 'SUCCESS' as const,
      data: null,
    };
  }
}
