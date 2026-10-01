import { Injectable } from '@nestjs/common';
import {
  PrismaService,
  PrismaTypes,
  type PrismaModels,
} from '@softsensor/prisma';
import { AppException } from '@softsensor/common';
import { encryptSecret } from '@/lib/crypto';
import { dataSourceAccessWhere } from '@/lib/data-source-access';
import type {
  CreateDataSourceDto,
  UpdateDataSourceDto,
} from './dto/data-source.authorized.dto';

type DataSourceWithUser = PrismaModels.DataSourceModel & {
  createdBy: Pick<PrismaModels.UserModel, 'firstName' | 'lastName'>;
};

@Injectable()
export class DataSourceAuthorizedService {
  constructor(private readonly prisma: PrismaService) {}

  private mapToResponse(item: DataSourceWithUser, userId: string) {
    const canManage = item.createdById === userId;
    return {
      id: item.id,
      name: item.name,
      type: item.type,
      host: item.host,
      // A teammate can query through a shared source but never sees its
      // login — only the creator (who can edit it) gets the username back.
      username: canManage ? item.username : '',
      dbName: item.dbName,
      config: item.config ?? null,
      status: item.status,
      lastUsed: item.updatedAt.toISOString().split('T')[0] ?? '',
      createdBy:
        [item.createdBy.firstName, item.createdBy.lastName]
          .filter(Boolean)
          .join(' ') || 'Unknown',
      workspaceId: item.workspaceId,
      canManage,
    };
  }

  /** A source can only be shared into a workspace the caller belongs to. */
  private async assertWorkspaceMember(workspaceId: string, userId: string) {
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

  private toJsonInput(
    config: Record<string, unknown> | undefined,
  ): PrismaTypes.InputJsonValue | undefined {
    return config === undefined
      ? undefined
      : (config as PrismaTypes.InputJsonValue);
  }

  async listDataSourceService(userId: string, workspaceId?: string) {
    const items = await this.prisma.dataSource.findMany({
      where: {
        ...dataSourceAccessWhere(userId),
        ...(workspaceId && { workspaceId }),
      },
      include: { createdBy: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return {
      statusCode: 200,
      message: 'Data sources fetched successfully',
      type: 'SUCCESS' as const,
      data: items.map((item) => this.mapToResponse(item, userId)),
    };
  }

  async createDataSourceService(userId: string, dto: CreateDataSourceDto) {
    if (dto.workspaceId) {
      await this.assertWorkspaceMember(dto.workspaceId, userId);
    }
    const item = await this.prisma.dataSource.create({
      data: {
        name: dto.name,
        type: dto.type,
        host: dto.host ?? '',
        username: dto.username ?? '',
        // Encrypt the user-supplied secret; never store it plaintext.
        secretCiphertext: encryptSecret(dto.password ?? ''),
        dbName: dto.dbName ?? '',
        config: this.toJsonInput(dto.config),
        status: 'connected',
        createdById: userId,
        workspaceId: dto.workspaceId ?? null,
      },
      include: { createdBy: { select: { firstName: true, lastName: true } } },
    });
    return {
      statusCode: 201,
      message: 'Data source created successfully',
      type: 'SUCCESS' as const,
      data: this.mapToResponse(item, userId),
    };
  }

  async updateDataSourceService(
    userId: string,
    id: string,
    dto: UpdateDataSourceDto,
  ) {
    const existing = await this.prisma.dataSource.findUnique({ where: { id } });
    if (!existing || existing.createdById !== userId) {
      throw new AppException({
        statusCode: 404,
        message: 'Data source not found',
        type: 'ERROR',
      });
    }
    if (dto.workspaceId) {
      await this.assertWorkspaceMember(dto.workspaceId, userId);
    }
    const item = await this.prisma.dataSource.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.host !== undefined && { host: dto.host }),
        ...(dto.username !== undefined && { username: dto.username }),
        // Re-encrypt only when a new secret is provided; a blank/omitted
        // password leaves the stored ciphertext untouched.
        ...(dto.password !== undefined &&
          dto.password !== '' && {
            secretCiphertext: encryptSecret(dto.password),
          }),
        ...(dto.dbName !== undefined && { dbName: dto.dbName }),
        ...(dto.config !== undefined && {
          config: this.toJsonInput(dto.config),
        }),
        // null = stop sharing (private to the creator again).
        ...(dto.workspaceId !== undefined && {
          workspaceId: dto.workspaceId,
        }),
      },
      include: { createdBy: { select: { firstName: true, lastName: true } } },
    });
    return {
      statusCode: 200,
      message: 'Data source updated successfully',
      type: 'SUCCESS' as const,
      data: this.mapToResponse(item, userId),
    };
  }

  async deleteDataSourceService(userId: string, id: string) {
    const existing = await this.prisma.dataSource.findUnique({ where: { id } });
    if (!existing || existing.createdById !== userId) {
      throw new AppException({
        statusCode: 404,
        message: 'Data source not found',
        type: 'ERROR',
      });
    }
    await this.prisma.dataSource.delete({ where: { id } });
    return {
      statusCode: 200,
      message: 'Data source deleted successfully',
      type: 'SUCCESS' as const,
      data: null,
    };
  }
}
