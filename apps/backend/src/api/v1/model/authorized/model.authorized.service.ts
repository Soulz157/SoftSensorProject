import { Injectable } from '@nestjs/common';
import { AppException } from '@softsensor/common';
import { PrismaService } from '@softsensor/prisma';
import { z } from 'zod';
import {
  AppendLogSchema,
  CreateModelSchema,
  UpdateModelSchema,
} from './dto/model.authorized.dto';

type ModelData = {
  deployStatus: 'stopped' | 'running' | 'error' | 'initializing';
  prodStatus: 'normal' | 'warning' | 'alert' | 'offline';
  logs: Array<{
    level: 'info' | 'warn' | 'error';
    message: string;
    timestamp: string;
  }>;
};

function normalizeData(raw: unknown): ModelData {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    deployStatus: (r.deployStatus ??
      r.status ??
      'stopped') as ModelData['deployStatus'],
    prodStatus: (r.prodStatus ?? 'normal') as ModelData['prodStatus'],
    logs: Array.isArray(r.logs) ? (r.logs as ModelData['logs']) : [],
  };
}

const NODE_INCLUDE = {
  nodes: {
    select: {
      id: true,
      data: true,
      planId: true,
      plan: { select: { id: true, name: true } },
    },
  },
} as const;

@Injectable()
export class ModelAuthorizedService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertHasAccess(
    workspaceId: string,
    userId: string,
    userRole: string,
  ) {
    if (userRole === 'ADMIN') return;

    const workspace = await this.prisma.workspace.findFirst({
      where: { id: workspaceId, ownerId: userId },
      select: { id: true },
    });
    if (workspace) return;
    const member = await this.prisma.workspaceMember.findFirst({
      where: { workspaceId, userId },
    });
    if (!member)
      throw new AppException({
        statusCode: 403,
        message: 'Forbidden',
        type: 'ERROR',
      });
  }

  private async assertCanEdit(workspaceId: string, userId: string) {
    const workspace = await this.prisma.workspace.findFirst({
      where: { id: workspaceId, ownerId: userId },
      select: { id: true },
    });
    if (workspace) return;
    const member = await this.prisma.workspaceMember.findFirst({
      where: { workspaceId, userId },
    });
    if (!member || member.role === 'VIEWER')
      throw new AppException({
        statusCode: 403,
        message: 'Forbidden: editor access required',
        type: 'ERROR',
      });
  }

  async getModelsService(
    workspaceId: string,
    userId: string,
    userRole: string,
  ) {
    await this.assertHasAccess(workspaceId, userId, userRole);
    const models = await this.prisma.model.findMany({
      where: { workspaceId },
      include: NODE_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return {
      statusCode: 200,
      message: 'Models fetched',
      type: 'SUCCESS' as const,
      data: models,
    };
  }

  async createModelService(
    dto: z.infer<typeof CreateModelSchema>,
    userId: string,
  ) {
    await this.assertCanEdit(dto.workspaceId, userId);
    if (dto.nodeId) {
      const node = await this.prisma.nodes.findFirst({
        where: { id: dto.nodeId, workspaceId: dto.workspaceId },
      });
      if (!node)
        throw new AppException({
          statusCode: 404,
          message: 'Node not found',
          type: 'ERROR',
        });
    }
    const initData: ModelData = {
      deployStatus: 'stopped',
      prodStatus: 'normal',
      logs: [],
    };
    const model = await this.prisma.model.create({
      data: {
        workspaceId: dto.workspaceId,
        name: dto.name,
        nodesId: dto.nodeId ?? null,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: JSON.parse(JSON.stringify(initData)),
      },
      include: NODE_INCLUDE,
    });
    return {
      statusCode: 201,
      message: 'Model created',
      type: 'SUCCESS' as const,
      data: model,
    };
  }

  async updateModelService(
    modelId: string,
    dto: z.infer<typeof UpdateModelSchema>,
    userId: string,
  ) {
    const existing = await this.prisma.model.findUnique({
      where: { id: modelId },
    });
    if (!existing)
      throw new AppException({
        statusCode: 404,
        message: 'Model not found',
        type: 'ERROR',
      });
    await this.assertCanEdit(existing.workspaceId, userId);

    const current = normalizeData(existing.data);
    const newData: ModelData = {
      ...current,
      ...(dto.deployStatus && { deployStatus: dto.deployStatus }),
      ...(dto.prodStatus && { prodStatus: dto.prodStatus }),
    };

    const updated = await this.prisma.model.update({
      where: { id: modelId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...('nodeId' in dto && { nodesId: dto.nodeId ?? null }),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: JSON.parse(JSON.stringify(newData)),
      },
      include: NODE_INCLUDE,
    });
    return {
      statusCode: 200,
      message: 'Model updated',
      type: 'SUCCESS' as const,
      data: updated,
    };
  }

  async appendLogService(
    modelId: string,
    dto: z.infer<typeof AppendLogSchema>,
    userId: string,
  ) {
    const existing = await this.prisma.model.findUnique({
      where: { id: modelId },
    });
    if (!existing)
      throw new AppException({
        statusCode: 404,
        message: 'Model not found',
        type: 'ERROR',
      });
    await this.assertCanEdit(existing.workspaceId, userId);

    const current = normalizeData(existing.data);
    const entry = {
      level: dto.level,
      message: dto.message,
      timestamp: new Date().toISOString(),
    };
    const logs = [...current.logs, entry].slice(-200);
    const newData: ModelData = { ...current, logs };

    const updated = await this.prisma.model.update({
      where: { id: modelId },
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      data: { data: JSON.parse(JSON.stringify(newData)) },
      include: NODE_INCLUDE,
    });
    return {
      statusCode: 200,
      message: 'Log appended',
      type: 'SUCCESS' as const,
      data: updated,
    };
  }

  async deleteModelService(modelId: string, userId: string) {
    const existing = await this.prisma.model.findUnique({
      where: { id: modelId },
    });
    if (!existing)
      throw new AppException({
        statusCode: 404,
        message: 'Model not found',
        type: 'ERROR',
      });
    await this.assertCanEdit(existing.workspaceId, userId);
    await this.prisma.model.delete({ where: { id: modelId } });
    return {
      statusCode: 200,
      message: 'Model deleted',
      type: 'SUCCESS' as const,
      data: null,
    };
  }
}
