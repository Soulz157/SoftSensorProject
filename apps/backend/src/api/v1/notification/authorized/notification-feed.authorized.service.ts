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
 * a separate control from `NotificationChannel.focusModelIds`, which picks
 * the models a channel sends for, for everyone.
 *
 * HIDING, per user: the X on a bell row writes a `NotificationDismissal`;
 * "Clear all" moves `NotificationReadMarker.clearedAt`. Both drop events
 * from this user's list AND count; the shared event rows (other members,
 * Teams/e-mail delivery history) are never deleted.
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
    return {
      workspace: this.workspaceWhere(user),
      model: { notificationUserMutes: { none: { userId: user.id } } },
      dismissals: { none: { userId: user.id } },
    };
  }

  /** The read-access rule alone (no mutes / dismissals / clear) — what an
   *  event must pass for this user to be allowed to act on it at all. */
  private workspaceWhere(
    user: Auth.UserPayload,
  ): PrismaTypes.WorkspaceWhereInput {
    return user.role === 'ADMIN'
      ? { deletedAt: null }
      : {
          deletedAt: null,
          OR: [
            { ownerId: user.id },
            { members: { some: { userId: user.id } } },
          ],
        };
  }

  private readMarker(userId: string) {
    return this.prisma.notificationReadMarker.findUnique({
      where: { userId },
      select: { lastReadAt: true, clearedAt: true },
    });
  }

  /** `?limit=` arrives as text; anything that is not a number falls back to
   *  the default instead of reaching Prisma as `take: NaN` (a 500). */
  private takeFrom(limit: number | undefined): number {
    const n =
      limit !== undefined && Number.isFinite(limit) ? limit : DEFAULT_LIMIT;
    return Math.min(Math.max(Math.trunc(n), 1), MAX_LIMIT);
  }

  /** An unparseable cursor is the caller's mistake (400), not a 500. */
  private cursorFrom(cursor: string | undefined): Date | undefined {
    if (cursor === undefined) return undefined;
    const at = new Date(cursor);
    if (Number.isNaN(at.getTime())) {
      throw new AppException({
        statusCode: 400,
        message: 'Invalid cursor',
        type: 'ERROR',
      });
    }
    return at;
  }

  async listEventsService(
    user: Auth.UserPayload,
    cursor: string | undefined,
    limit: number | undefined,
  ) {
    const take = this.takeFrom(limit);
    const before = this.cursorFrom(cursor);
    const marker = await this.readMarker(user.id);
    const createdAt: PrismaTypes.DateTimeFilter = {
      ...(marker?.clearedAt ? { gt: marker.clearedAt } : {}),
      ...(before ? { lt: before } : {}),
    };
    const where: PrismaTypes.NotificationEventWhereInput = {
      ...this.eventWhere(user),
      ...(Object.keys(createdAt).length ? { createdAt } : {}),
    };

    const events = await this.prisma.notificationEvent.findMany({
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
    });
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
    const marker = await this.readMarker(user.id);
    // Unread = newer than BOTH watermarks: a cleared event is gone, not
    // unread.
    const since = [marker?.lastReadAt, marker?.clearedAt].reduce<Date>(
      (a, b) => (b && b > a ? b : a),
      new Date(0),
    );

    const count = await this.prisma.notificationEvent.count({
      where: { ...this.eventWhere(user), createdAt: { gt: since } },
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

  /** The row's X: hide ONE event from this user's bell. Idempotent. */
  async dismissEventService(user: Auth.UserPayload, eventId: string) {
    const event = await this.prisma.notificationEvent.findFirst({
      where: { id: eventId, workspace: this.workspaceWhere(user) },
      select: { id: true },
    });
    if (!event) {
      // Same answer for "no such event" and "not yours to see".
      throw new AppException({
        statusCode: 404,
        message: 'Notification not found',
        type: 'ERROR',
      });
    }
    await this.prisma.notificationDismissal.upsert({
      where: { userId_eventId: { userId: user.id, eventId } },
      create: { userId: user.id, eventId },
      update: {},
    });
    return {
      statusCode: 200,
      message: 'Notification removed',
      type: 'SUCCESS' as const,
    };
  }

  /**
   * "Clear all": hide every event up to `upTo` (the newest one the user was
   * shown — never one that arrived after) from this user's bell. Clamped to
   * now, never moves back, and also counts as read. Per-event dismissals it
   * now covers are dropped, so that table stays small.
   */
  async clearService(user: Auth.UserPayload, upTo: string | undefined) {
    const now = new Date();
    const asked = upTo ? new Date(upTo) : now;
    const target = asked > now ? now : asked;
    const marker = await this.readMarker(user.id);
    const later = (a: Date | null | undefined) =>
      a && a > target ? a : target;

    await this.prisma.$transaction([
      this.prisma.notificationReadMarker.upsert({
        where: { userId: user.id },
        create: { userId: user.id, lastReadAt: target, clearedAt: target },
        update: {
          lastReadAt: later(marker?.lastReadAt),
          clearedAt: later(marker?.clearedAt),
        },
      }),
      this.prisma.notificationDismissal.deleteMany({
        where: {
          userId: user.id,
          event: { createdAt: { lte: later(marker?.clearedAt) } },
        },
      }),
    ]);
    return {
      statusCode: 200,
      message: 'Notifications cleared',
      type: 'SUCCESS' as const,
    };
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
