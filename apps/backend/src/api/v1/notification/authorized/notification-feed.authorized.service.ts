import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTypes } from '@softsensor/prisma';
import { AppException } from '@softsensor/common';
import { env } from '@/config/env.config';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;

/**
 * MODEL-SERVE-022-T07/D10/D11. Read side of the in-app bell: every event a
 * `NotificationEvaluatorService` sweep or a write site wrote to
 * `NotificationEvent` (via `NotificationOutboxService.enqueueInTx`,
 * unconditionally — see its own doc comment), filtered to what THIS user
 * may read.
 *
 * ACCESS RULE, verbatim from `model-run-launch.authorized.service.ts`'s
 * `assertHasAccess` / `workspace.authorized.service.ts`'s `getAllWorkspaces`
 * where-clause (T07 audit_findings): ADMIN sees every non-deleted
 * workspace; anyone else sees a workspace they own or are ANY member of
 * (VIEWER included) — read access, not the stricter edit-only
 * `assertCanEdit` this feature's own channel-management API uses. A
 * per-user, per-model `NotificationUserMute` row removes that model's
 * events from BOTH the list and the unread count for that user only —
 * a separate control from `NotificationChannel.mutedModelIds`, which mutes
 * a channel for everyone.
 */
@Injectable()
export class NotificationFeedAuthorizedService {
  constructor(private readonly prisma: PrismaService) {}

  /** Shared by the list and the count — V08's own requirement ("the count
   *  uses the same where"), so the two can never silently disagree about
   *  what this user is allowed to see. */
  private eventWhere(
    user: Auth.UserPayload,
  ): PrismaTypes.NotificationEventWhereInput {
    const workspaceWhere: PrismaTypes.WorkspaceWhereInput =
      user.role === 'ADMIN'
        ? { deletedAt: null }
        : {
            deletedAt: null,
            OR: [
              { ownerId: user.id },
              { members: { some: { userId: user.id } } },
            ],
          };
    return {
      workspace: workspaceWhere,
      model: { notificationUserMutes: { none: { userId: user.id } } },
    };
  }

  async listEventsService(
    user: Auth.UserPayload,
    cursor: string | undefined,
    limit: number | undefined,
  ) {
    const take = Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const where: PrismaTypes.NotificationEventWhereInput = {
      ...this.eventWhere(user),
      ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
    };

    const [events, marker] = await Promise.all([
      this.prisma.notificationEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        select: {
          id: true,
          modelId: true,
          axis: true,
          kind: true,
          severity: true,
          fromStatus: true,
          toStatus: true,
          reason: true,
          createdAt: true,
          model: { select: { name: true } },
        },
      }),
      this.prisma.notificationReadMarker.findUnique({
        where: { userId: user.id },
        select: { lastReadAt: true },
      }),
    ]);
    const lastReadAt = marker?.lastReadAt ?? new Date(0);

    return {
      statusCode: 200,
      message: 'Notification events fetched',
      type: 'SUCCESS' as const,
      data: {
        items: events.map((e) => ({
          id: e.id,
          modelId: e.modelId,
          modelName: e.model.name,
          axis: e.axis,
          kind: e.kind,
          severity: e.severity,
          fromStatus: e.fromStatus,
          toStatus: e.toStatus,
          reason: e.reason,
          createdAt: e.createdAt.toISOString(),
          unread: e.createdAt > lastReadAt,
        })),
        nextCursor:
          events.length === take
            ? events[events.length - 1].createdAt.toISOString()
            : null,
      },
    };
  }

  async unreadCountService(user: Auth.UserPayload) {
    const marker = await this.prisma.notificationReadMarker.findUnique({
      where: { userId: user.id },
      select: { lastReadAt: true },
    });
    const lastReadAt = marker?.lastReadAt ?? new Date(0);

    const count = await this.prisma.notificationEvent.count({
      where: { ...this.eventWhere(user), createdAt: { gt: lastReadAt } },
    });

    return {
      statusCode: 200,
      message: 'Unread count fetched',
      type: 'SUCCESS' as const,
      // MODEL-SERVE-022-T08. `pollIntervalMs` = the evaluator's own sweep
      // interval — 001-T09's rule that anything faster than the tick that
      // produces the data is load with no information. The client is not
      // trusted to hardcode this; it reads it from here.
      data: { count, pollIntervalMs: env.NOTIFY_EVAL_INTERVAL_MS },
    };
  }

  /** Never moves the watermark BACKWARDS — a stale "mark read" retried
   *  after a newer one already advanced it must be a no-op. */
  async markReadService(user: Auth.UserPayload, upTo: string | undefined) {
    const target = upTo ? new Date(upTo) : new Date();
    const existing = await this.prisma.notificationReadMarker.findUnique({
      where: { userId: user.id },
      select: { lastReadAt: true },
    });
    if (existing && existing.lastReadAt >= target) {
      return {
        statusCode: 200,
        message: 'Already up to date',
        type: 'SUCCESS' as const,
      };
    }
    await this.prisma.notificationReadMarker.upsert({
      where: { userId: user.id },
      create: { userId: user.id, lastReadAt: target },
      update: { lastReadAt: target },
    });
    return {
      statusCode: 200,
      message: 'Marked read',
      type: 'SUCCESS' as const,
    };
  }

  private async assertModelReadable(modelId: string, user: Auth.UserPayload) {
    const model = await this.prisma.model.findUnique({
      where: { id: modelId },
      select: { workspaceId: true },
    });
    if (!model) {
      throw new AppException({
        statusCode: 404,
        message: 'Model not found',
        type: 'ERROR',
      });
    }
    if (user.role === 'ADMIN') return;
    const workspace = await this.prisma.workspace.findFirst({
      where: { id: model.workspaceId, ownerId: user.id },
      select: { id: true },
    });
    if (workspace) return;
    const member = await this.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId: model.workspaceId, userId: user.id },
      },
    });
    if (!member) {
      throw new AppException({
        statusCode: 403,
        message: 'Forbidden',
        type: 'ERROR',
      });
    }
  }

  async listMutesService(user: Auth.UserPayload) {
    const mutes = await this.prisma.notificationUserMute.findMany({
      where: { userId: user.id },
      select: { modelId: true },
    });
    return {
      statusCode: 200,
      message: 'Muted models fetched',
      type: 'SUCCESS' as const,
      data: { modelIds: mutes.map((m) => m.modelId) },
    };
  }

  async muteModelService(user: Auth.UserPayload, modelId: string) {
    await this.assertModelReadable(modelId, user);
    await this.prisma.notificationUserMute.upsert({
      where: { userId_modelId: { userId: user.id, modelId } },
      create: { userId: user.id, modelId },
      update: {},
    });
    return {
      statusCode: 200,
      message: 'Model muted',
      type: 'SUCCESS' as const,
    };
  }

  async unmuteModelService(user: Auth.UserPayload, modelId: string) {
    await this.prisma.notificationUserMute.deleteMany({
      where: { userId: user.id, modelId },
    });
    return {
      statusCode: 200,
      message: 'Model unmuted',
      type: 'SUCCESS' as const,
    };
  }
}
