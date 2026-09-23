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
  // DS-LAKE-017-T03: the lineage-root BRONZE, if DS-LAKE-017-T01/T02 has
  // adopted one AND its bytes have not been reclaimed. `currentArtifactId`
  // above stays FINAL-only (ONE POINTER, NOT TWO — see T01) so the client
  // needs this separate field to know whether edit-mode hydration has raw
  // rows available at all, without a second round trip. `take: 1` is
  // defensive, not load-bearing: exactly one row can ever match, since a
  // dataset has one lineage-root per current version and T01/T02 only ever
  // adopt that one.
  artifacts: {
    where: { type: 'BRONZE', objectReclaimedAt: null },
    select: { id: true },
    take: 1,
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

/**
 * DS-LAKE-030-T01. One model affected by deleting a dataset.
 *
 * MODULE SCOPE, AND EXPORTED, deliberately: this is the return type of a
 * PUBLIC method, and `nest build` emits declarations. Declared inside the
 * method body it compiled under `tsc --noEmit` and then failed the real
 * build with TS4055 ("has or is using private name"), which left dist stale
 * and the server unable to start.
 */
export interface DatasetDependentModel {
  id: string;
  name: string;
  scheduleEnabled: boolean;
  hasProductionVersion: boolean;
  viaCurrentPointer: boolean;
  viaPinnedVersion: boolean;
}

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
      // DS-LAKE-017-T03. Null means exactly one of: not yet backfilled
      // (T02), reclaimed (`objectReclaimedAt` set), or a legacy dataset with
      // no lineage at all — the client cannot and does not need to tell
      // those apart, all three fall back to today's FINAL hydration.
      adoptedBronzeArtifactId: item.artifacts[0]?.id ?? null,
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

  /**
   * DS-LAKE-030-T01. Which models would be affected by deleting this
   * dataset — read-only, and deliberately NOT a gate: `deleteDatasetService`
   * below still deletes whatever it is asked to (D01). A dependent model
   * keeps serving after the delete; what it loses is the LINK back here, and
   * this endpoint exists so the confirm dialog can say so by name instead of
   * the user finding out afterwards.
   *
   * TWO SOURCES, UNIONED BY MODEL (D03). `Model.datasetId` alone
   * under-reports: it is the model's CURRENT pointer, it is nullable, and a
   * retrained model can point somewhere else entirely while its PRODUCTION
   * version stays pinned to THIS dataset through
   * `ModelVersion.sourceDatasetId` (schema.prisma:1989 draws exactly that
   * distinction). That second path has no FK at all — it is a plain String —
   * so those rows are neither cascaded nor nulled by the delete; they simply
   * survive holding an id that no longer resolves. Listing only the current
   * pointer would omit the model a user most needs to see.
   *
   * ONE ROW PER MODEL, never one per version, with `via*` naming which path
   * found it — a model pinned through five versions is one line in a dialog,
   * not five.
   */
  async listDatasetDependentsService(user: Auth.UserPayload, id: string) {
    const dataset = await this.prisma.dataset.findUnique({
      where: { id, createdById: user.id },
      select: { id: true },
    });
    if (!dataset) {
      throw new AppException({
        statusCode: 404,
        message: 'Dataset not found',
        type: 'ERROR',
      });
    }

    const [byPointer, byVersion] = await Promise.all([
      this.prisma.model.findMany({
        where: { datasetId: id },
        select: {
          id: true,
          name: true,
          inferenceSchedule: { select: { enabled: true } },
          // `stage`, not `status` — ModelVersionStage is STAGING /
          // PRODUCTION / ARCHIVED.
          versions: { where: { stage: 'PRODUCTION' }, select: { id: true } },
        },
      }),
      // No relation to traverse — `sourceDatasetId` is an unconstrained
      // String, so the model is reached through the version's own `model`.
      this.prisma.modelVersion.findMany({
        where: { sourceDatasetId: id },
        select: {
          model: {
            select: {
              id: true,
              name: true,
              inferenceSchedule: { select: { enabled: true } },
              versions: {
                where: { stage: 'PRODUCTION' },
                select: { id: true },
              },
            },
          },
        },
      }),
    ]);

    const merged = new Map<string, DatasetDependentModel>();

    const upsert = (
      model: {
        id: string;
        name: string;
        inferenceSchedule: { enabled: boolean } | null;
        versions: { id: string }[];
      },
      via: 'viaCurrentPointer' | 'viaPinnedVersion',
    ) => {
      const existing = merged.get(model.id);
      if (existing) {
        existing[via] = true;
        return;
      }
      merged.set(model.id, {
        id: model.id,
        name: model.name,
        scheduleEnabled: model.inferenceSchedule?.enabled ?? false,
        hasProductionVersion: model.versions.length > 0,
        viaCurrentPointer: via === 'viaCurrentPointer',
        viaPinnedVersion: via === 'viaPinnedVersion',
      });
    };

    for (const model of byPointer) upsert(model, 'viaCurrentPointer');
    for (const row of byVersion) {
      if (row.model) upsert(row.model, 'viaPinnedVersion');
    }

    const models = [...merged.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    );

    return {
      statusCode: 200,
      message: 'Dataset dependents fetched',
      type: 'SUCCESS' as const,
      data: { models },
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
