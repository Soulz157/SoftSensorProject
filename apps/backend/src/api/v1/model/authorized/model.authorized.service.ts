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
  prodStatus: 'normal' | 'warning' | 'alert' | 'offline' | 'frozen';
  statusDetail?: string;
  deployedBy?: string;
  deployedAt?: string;
  lastEditedBy?: string;
  lastEditedAt?: string;
  lastEditedFields?: string[];
  editHistory: Array<{
    by: string;
    at: string;
    fields: string[];
  }>;
  logs: Array<{
    level: 'info' | 'warn' | 'error';
    message: string;
    timestamp: string;
  }>;
  /** Wizard data-source/tags/processing config — stored round-trip only. */
  config?: Record<string, unknown>;
};

function normalizeData(raw: unknown): ModelData {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    deployStatus: (r.deployStatus ??
      r.status ??
      'stopped') as ModelData['deployStatus'],
    prodStatus: (r.prodStatus ?? 'normal') as ModelData['prodStatus'],
    ...(typeof r.statusDetail === 'string' && { statusDetail: r.statusDetail }),
    ...(typeof r.deployedBy === 'string' && { deployedBy: r.deployedBy }),
    ...(typeof r.deployedAt === 'string' && { deployedAt: r.deployedAt }),
    ...(typeof r.lastEditedBy === 'string' && {
      lastEditedBy: r.lastEditedBy,
    }),
    ...(typeof r.lastEditedAt === 'string' && {
      lastEditedAt: r.lastEditedAt,
    }),
    ...(Array.isArray(r.lastEditedFields) && {
      lastEditedFields: r.lastEditedFields as string[],
    }),
    editHistory: Array.isArray(r.editHistory)
      ? (r.editHistory as ModelData['editHistory'])
      : [],
    logs: Array.isArray(r.logs) ? (r.logs as ModelData['logs']) : [],
    ...(r.config && typeof r.config === 'object'
      ? { config: r.config as Record<string, unknown> }
      : {}),
  };
}

/**
 * MODEL-FLOW-016-T12. Config keys DERIVED SERVER-SIDE at Save Model, which no
 * client can author: `saveDraftService` reads them off the adopted training
 * run, and `buildModelConfig` (apps/client/lib/model-config.ts) has no field
 * for either — it assembles config from wizard atoms alone.
 *
 * That combination is a real data-loss bug, not a hypothetical: edit mode
 * ("Save Changes") sends a freshly-built config, and the merge below replaces
 * `config` wholesale — so before this const existed, renaming a saved model
 * silently dropped `frameworkVersions` (MODEL-FLOW-007-T11's provenance) from
 * the row. T11 guarded the SIBLING-key case via `normalizeData`'s top-level
 * whitelist; this is the second, uncovered one.
 *
 * Deliberately a NAMED LIST rather than a blanket `{...current, ...incoming}`
 * merge: a blanket merge would resurrect keys the user actually cleared (an
 * emptied description makes `buildModelConfig` omit `description` entirely,
 * and the old value would come back). Only keys the client cannot express are
 * preserved.
 */
const SERVER_DERIVED_CONFIG_KEYS = [
  'frameworkVersions',
  'crossValidation',
] as const;

/** Carry the server-derived provenance keys forward onto an incoming config
 *  that does not mention them. An incoming config that DOES carry a key wins,
 *  so a future server-side writer can still update one. */
function preserveServerDerivedConfig(
  incoming: Record<string, unknown>,
  current: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!current) return incoming;
  const preserved: Record<string, unknown> = {};
  for (const key of SERVER_DERIVED_CONFIG_KEYS) {
    if (!(key in incoming) && key in current) preserved[key] = current[key];
  }
  return Object.keys(preserved).length > 0
    ? { ...incoming, ...preserved }
    : incoming;
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
    userRole: string,
  ) {
    if (userRole !== 'ADMIN') {
      await this.assertCanEdit(dto.workspaceId, userId);
    }

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

    const existingName = await this.prisma.model.findFirst({
      where: {
        workspaceId: dto.workspaceId,
        name: { equals: dto.name, mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (existingName)
      throw new AppException({
        statusCode: 400,
        message: 'A model with this name already exists in this location.',
        type: 'ERROR',
      });

    const initData: ModelData = {
      deployStatus: 'stopped',
      prodStatus: 'normal',
      editHistory: [],
      logs: [],
      ...(dto.config && { config: dto.config }),
    };
    const model = await this.prisma.model.create({
      data: {
        workspaceId: dto.workspaceId,
        name: dto.name,
        nodesId: dto.nodeId ?? null,
        datasetId: dto.datasetId ?? null,
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
    userRole: string,
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

    if (userRole !== 'ADMIN') {
      await this.assertCanEdit(existing.workspaceId, userId);
    } else {
      await this.assertHasAccess(existing.workspaceId, userId, userRole);
    }

    if (dto.name !== undefined) {
      const clash = await this.prisma.model.findFirst({
        where: {
          workspaceId: existing.workspaceId,
          name: { equals: dto.name, mode: 'insensitive' },
          id: { not: modelId },
        },
        select: { id: true },
      });
      if (clash)
        throw new AppException({
          statusCode: 400,
          message: 'A model with this name already exists in this location.',
          type: 'ERROR',
        });
    }

    const current = normalizeData(existing.data);

    const editedLabels: string[] = [];
    if (dto.name !== undefined) editedLabels.push('Name');
    if ('nodeId' in dto) editedLabels.push('Assigned node');
    if ('datasetId' in dto) editedLabels.push('Dataset');
    if (dto.prodStatus !== undefined) editedLabels.push('Production status');
    if (dto.statusDetail !== undefined) editedLabels.push('Status detail');
    if (dto.config !== undefined) editedLabels.push('Configuration');

    let editorName = '';
    if (dto.deployStatus === 'running' || editedLabels.length > 0) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { firstName: true, lastName: true },
      });
      editorName = [user?.firstName, user?.lastName]
        .filter(Boolean)
        .join(' ')
        .trim();
    }

    let deployFields: Partial<ModelData> = {};
    if (dto.deployStatus === 'running') {
      deployFields = {
        deployedAt: new Date().toISOString(),
        ...(editorName && { deployedBy: editorName }),
      };
    }

    const editFields: Partial<ModelData> =
      editedLabels.length > 0
        ? {
            lastEditedAt: new Date().toISOString(),
            lastEditedFields: editedLabels,
            ...(editorName && { lastEditedBy: editorName }),
            editHistory: [
              ...current.editHistory,
              {
                by: editorName || 'Unknown user',
                at: new Date().toISOString(),
                fields: editedLabels,
              },
            ].slice(-200),
          }
        : {};

    const newData: ModelData = {
      ...current,
      ...(dto.deployStatus && { deployStatus: dto.deployStatus }),
      ...(dto.prodStatus && { prodStatus: dto.prodStatus }),
      ...(dto.statusDetail !== undefined && {
        statusDetail: dto.statusDetail ?? undefined,
      }),
      ...(dto.config !== undefined && {
        config: preserveServerDerivedConfig(dto.config, current.config),
      }),
      ...deployFields,
      ...editFields,
    };

    const updated = await this.prisma.model.update({
      where: { id: modelId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...('nodeId' in dto && { nodesId: dto.nodeId ?? null }),
        ...('datasetId' in dto && { datasetId: dto.datasetId ?? null }),
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

  async deleteModelService(modelId: string, userId: string, userRole: string) {
    const existing = await this.prisma.model.findUnique({
      where: { id: modelId },
    });
    if (!existing)
      throw new AppException({
        statusCode: 404,
        message: 'Model not found',
        type: 'ERROR',
      });
    if (userRole !== 'ADMIN') {
      await this.assertCanEdit(existing.workspaceId, userId);
    }
    await this.prisma.model.delete({ where: { id: modelId } });
    return {
      statusCode: 200,
      message: 'Model deleted',
      type: 'SUCCESS' as const,
      data: null,
    };
  }
}
