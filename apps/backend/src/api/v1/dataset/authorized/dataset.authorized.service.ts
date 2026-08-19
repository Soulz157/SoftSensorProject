import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTypes } from '@softsensor/prisma';
import { AppException } from '@softsensor/common';
import type {
  CreateDatasetDto,
  UpdateDatasetDto,
} from './dto/dataset.authorized.dto';
import { Prisma } from 'node_modules/@softsensor/prisma/dist/src/generated/client/client';

const datasetSelect = {
  id: true,
  name: true,
  description: true,
  workspaceId: true,
  sourceIds: true,
  tags: true,
  pipelineConfig: true,
  fileUrl: true,
  rowCount: true,
  missingPct: true,
  currentVersionId: true,
  /**
   * The BRONZE artifact the wizard hydrates rows from (DS-LAKE-004).
   *
   * Both pointers ship during the transition: `currentVersionId` is the only
   * one legacy datasets have, and the client cannot choose a branch without
   * seeing both.
   */
  currentArtifactId: true,
  // The pointer above is stage-polymorphic: `createRaw` points it at a
  // BRONZE artifact, Save-Dataset repoints it at FINAL, and a post-save
  // preprocessing job can repoint it again. The client cannot label what
  // it is showing (raw vs. already-processed) without knowing the stage,
  // so the type ships alongside the id rather than requiring a second
  // round trip to look it up.
  currentArtifact: {
    select: { type: true },
  },
  createdAt: true,
  updatedAt: true,
  createdBy: {
    select: { firstName: true, lastName: true },
  },
} satisfies Prisma.DatasetSelect;

type DatasetResponsePayload = Prisma.DatasetGetPayload<{
  select: typeof datasetSelect;
}>;

@Injectable()
export class DatasetAuthorizedService {
  constructor(private readonly prisma: PrismaService) {}

  private mapToResponse(item: DatasetResponsePayload) {
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
      // Null on every dataset created before the versioning slice, and on any
      // whose raw artifact has not been materialised yet. The client branches
      // on exactly this: hydrate from the version, or take the backfill path.
      // Sending the pointer here saves a /versions round trip per card, and
      // `currentVersionId` is the authoritative one — "the newest version" is
      // not the same thing.
      currentVersionId: item.currentVersionId,
      currentArtifactId: item.currentArtifactId,
      // See the `currentArtifact` select comment above — null only when
      // `currentArtifactId` itself is null (no artifact select fires).
      currentArtifactType: item.currentArtifact?.type ?? null,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      createdBy:
        [item.createdBy.firstName, item.createdBy.lastName]
          .filter(Boolean)
          .join(' ') || 'Unknown',
    };
  }

  private async assertWorkspaceAccess(
    workspaceId: string,
    userId: string,
    role?: string,
  ) {
    const isAdmin = role === 'ADMIN';
    const workspace = await this.prisma.workspace.findFirst({
      where: {
        id: workspaceId,
        deletedAt: null,
        ...(isAdmin
          ? {}
          : { OR: [{ ownerId: userId }, { members: { some: { userId } } }] }),
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
      select: datasetSelect,
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
      where: { id, createdById: userId },
      select: datasetSelect,
    });

    if (!item) {
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

  async createDatasetService(user: Auth.UserPayload, dto: CreateDatasetDto) {
    await this.assertWorkspaceAccess(dto.workspaceId, user.id, user.role);
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
        createdById: user.id,
      },
      select: datasetSelect,
    });
    return {
      statusCode: 201,
      message: 'Dataset created successfully',
      type: 'SUCCESS' as const,
      data: this.mapToResponse(item),
    };
  }

  async updateDatasetService(
    user: Auth.UserPayload,
    id: string,
    dto: UpdateDatasetDto,
  ) {
    const existing = await this.prisma.dataset.findFirst({
      where: { id, createdById: user.id },
      select: { id: true },
    });

    if (!existing) {
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
      select: datasetSelect,
    });
    return {
      statusCode: 200,
      message: 'Dataset updated successfully',
      type: 'SUCCESS' as const,
      data: this.mapToResponse(item),
    };
  }

  async deleteDatasetService(user: Auth.UserPayload, id: string) {
    const existing = await this.prisma.dataset.findUnique({
      where: { id, createdById: user.id },
      select: { id: true },
    });
    if (!existing) {
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
