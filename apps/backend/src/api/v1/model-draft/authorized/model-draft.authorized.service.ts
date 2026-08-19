import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTypes } from '@softsensor/prisma';
import { AppException } from '@softsensor/common';
import {
  type CreateModelDraftDto,
  type PatchModelDraftDto,
} from './dto/model-draft.authorized.dto';

/**
 * ModelDraft — the Model Creation wizard's server-side owner while no
 * `Model` row exists yet (MODEL-FLOW-002, see decisions.draft_persistence
 * and CLAUDE.md §8). A training container has no browser: it authenticates
 * with a run token hashed into a `ModelTrainingRun` row, reads its spec
 * from `/claim`, and writes logs/metrics back over HTTP — none of which a
 * client-only jotai draft can serve. This is the row it reads instead.
 *
 * Mirrors `DatasetDraftAuthorizedService`'s access-control shape closely —
 * `assertModelAccess` (model-run-launch.authorized.service.ts) cannot be
 * reused here, both because it resolves through `model.workspaceId` (no
 * Model exists pre-Save) and because its own comment documents the
 * module-cycle constraint that blocks importing it directly.
 */
@Injectable()
export class ModelDraftAuthorizedService {
  constructor(private readonly prisma: PrismaService) {}

  // ── access ───────────────────────────────────────────────────────────────

  private async assertWorkspaceAccess(
    workspaceId: string,
    user: Auth.UserPayload,
  ) {
    const isAdmin = user.role === 'ADMIN';
    const workspace = await this.prisma.workspace.findFirst({
      where: {
        id: workspaceId,
        deletedAt: null,
        ...(isAdmin
          ? {}
          : {
              OR: [
                { ownerId: user.id },
                { members: { some: { userId: user.id } } },
              ],
            }),
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

  /** Owner-or-member on the draft's workspace, matching assertDraftAccess. */
  private async assertDraftAccess(draftId: string, user: Auth.UserPayload) {
    const isAdmin = user.role === 'ADMIN';
    const draft = await this.prisma.modelDraft.findFirst({
      where: {
        id: draftId,
        workspace: {
          deletedAt: null,
          ...(isAdmin
            ? {}
            : {
                OR: [
                  { ownerId: user.id },
                  { members: { some: { userId: user.id } } },
                ],
              }),
        },
      },
    });
    if (!draft) {
      throw new AppException({
        statusCode: 404,
        message: 'Model draft not found',
        type: 'ERROR',
      });
    }
    return draft;
  }

  // ── draft lifecycle ──────────────────────────────────────────────────────

  async createDraftService(user: Auth.UserPayload, dto: CreateModelDraftDto) {
    await this.assertWorkspaceAccess(dto.workspaceId, user);
    const draft = await this.prisma.modelDraft.create({
      data: {
        workspaceId: dto.workspaceId,
        name: dto.name,
        plantId: dto.plantId,
        nodeId: dto.nodeId,
        datasetId: dto.datasetId,
        createdById: user.id,
      },
    });

    return {
      statusCode: 201,
      message: 'Model draft created successfully',
      type: 'SUCCESS' as const,
      data: this.mapDraft(draft),
    };
  }

  async getDraftService(user: Auth.UserPayload, draftId: string) {
    const draft = await this.assertDraftAccess(draftId, user);
    return {
      statusCode: 200,
      message: 'Model draft fetched successfully',
      type: 'SUCCESS' as const,
      data: this.mapDraft(draft),
    };
  }

  /**
   * Whichever fields changed, not the whole config — Step 2 debounces this
   * per edit. Refuses (409) once the draft is SAVED: an already-adopted
   * draft's config must not keep drifting after the Model it fed exists.
   */
  async patchDraftService(
    user: Auth.UserPayload,
    draftId: string,
    dto: PatchModelDraftDto,
  ) {
    const existing = await this.assertDraftAccess(draftId, user);
    if (existing.status === 'SAVED') {
      throw new AppException({
        statusCode: 409,
        message:
          'Draft has already been saved as a Model — its configuration ' +
          'can no longer be edited.',
        type: 'ERROR',
      });
    }
    const draft = await this.prisma.modelDraft.update({
      where: { id: draftId },
      data: {
        name: dto.name,
        plantId: dto.plantId,
        nodeId: dto.nodeId,
        datasetId: dto.datasetId,
        targetY: dto.targetY,
        algorithm: dto.algorithm,
        hyperparameters: dto.hyperparameters as
          | PrismaTypes.InputJsonValue
          | undefined,
        splitRatio: dto.splitRatio,
      },
    });
    return {
      statusCode: 200,
      message: 'Model draft updated successfully',
      type: 'SUCCESS' as const,
      data: this.mapDraft(draft),
    };
  }

  /**
   * Abandon rather than delete: the runs the draft owns stay in Postgres —
   * only the draft's own status changes, so a stale wizard tab that keeps
   * polling gets an honest ABANDONED rather than a 404 for a row that
   * vanished under it. Mirrors abandonDraftService's own rationale.
   */
  async abandonDraftService(user: Auth.UserPayload, draftId: string) {
    await this.assertDraftAccess(draftId, user);
    const draft = await this.prisma.modelDraft.update({
      where: { id: draftId },
      data: { status: 'ABANDONED' },
    });
    return {
      statusCode: 200,
      message: 'Model draft abandoned',
      type: 'SUCCESS' as const,
      data: this.mapDraft(draft),
    };
  }

  private mapDraft(draft: {
    id: string;
    name: string | null;
    workspaceId: string;
    plantId: string | null;
    nodeId: string | null;
    datasetId: string | null;
    targetY: string | null;
    algorithm: string | null;
    hyperparameters: unknown;
    splitRatio: number | null;
    status: string;
    currentRunId: string | null;
    savedModelId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: draft.id,
      name: draft.name,
      workspaceId: draft.workspaceId,
      plantId: draft.plantId,
      nodeId: draft.nodeId,
      datasetId: draft.datasetId,
      targetY: draft.targetY,
      algorithm: draft.algorithm,
      hyperparameters: draft.hyperparameters,
      splitRatio: draft.splitRatio,
      status: draft.status,
      currentRunId: draft.currentRunId,
      savedModelId: draft.savedModelId,
      createdAt: draft.createdAt.toISOString(),
      updatedAt: draft.updatedAt.toISOString(),
    };
  }
}
