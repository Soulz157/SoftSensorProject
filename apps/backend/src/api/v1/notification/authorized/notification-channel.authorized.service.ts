import { Injectable } from '@nestjs/common';
import { PrismaService } from '@softsensor/prisma';
import { AppException } from '@softsensor/common';
import { encryptSecret } from '@/lib/crypto';
import {
  DEFAULT_ON_EVENT_KINDS,
  NOTIFICATION_EVENT_KINDS,
} from '@/lib/notification-events';
import { buildNotificationMessage } from '@/lib/notification-message';
import { NotificationDeliveryService } from '../core/notification-delivery.service';
import type {
  CreateNotificationChannelDto,
  UpdateNotificationChannelDto,
} from './dto/notification-channel.authorized.dto';

/**
 * MODEL-SERVE-022-T04. Minimal channel API for this pass — the full
 * settings UI (event defaults per row, delivery-history filters, "why can't
 * this alert fire yet" copy) is T05, not built here. Every mutating route
 * is OWNER-only (D-user-decision, 2026-09-29); the two READ routes (list
 * channels, delivery history) also admit STAFF (`assertCanView`, 2026-10-01).
 * `assertIsOwner` below is a
 * COPY of `workspace.authorized.service.ts`'s own private helper, verbatim
 * down to not special-casing ADMIN — this codebase's own existing
 * convention at all 3 of that helper's call sites, followed rather than a
 * new bypass invented for this feature.
 */
@Injectable()
export class NotificationChannelAuthorizedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly delivery: NotificationDeliveryService,
  ) {}

  private async assertIsOwner(workspaceId: string, userId: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { ownerId: true },
    });
    if (!workspace) {
      throw new AppException({
        statusCode: 404,
        message: 'Workspace not found',
        type: 'ERROR',
      });
    }
    if (workspace.ownerId === userId) return;
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { role: true },
    });
    if (!member || member.role !== 'OWNER') {
      throw new AppException({
        statusCode: 403,
        message: 'Only workspace owners can perform this action',
        type: 'ERROR',
      });
    }
  }

  /**
   * READ access to a workspace's channels and delivery history: the owner, or
   * a member with role OWNER or STAFF (user's call, 2026-10-01 — staff see
   * their own workspace's notifications). VIEWER stays out: channel rows name
   * recipients and targets. Every MUTATING route keeps `assertIsOwner`. Same
   * not-special-casing-ADMIN convention as `assertIsOwner` above.
   */
  private async assertCanView(workspaceId: string, userId: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { ownerId: true },
    });
    if (!workspace) {
      throw new AppException({
        statusCode: 404,
        message: 'Workspace not found',
        type: 'ERROR',
      });
    }
    if (workspace.ownerId === userId) return;
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { role: true },
    });
    if (!member || (member.role !== 'OWNER' && member.role !== 'STAFF')) {
      throw new AppException({
        statusCode: 403,
        message: 'Only workspace owners and staff can view notifications',
        type: 'ERROR',
      });
    }
  }

  /** D-user-decision: e-mail recipients are workspace members only. Owner
   *  counts as a member for this purpose (they always have access). */
  private async assertRecipientsAreMembers(
    workspaceId: string,
    recipientUserIds: string[],
  ) {
    if (recipientUserIds.length === 0) return;
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { ownerId: true },
    });
    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId, userId: { in: recipientUserIds } },
      select: { userId: true },
    });
    const validIds = new Set([
      workspace?.ownerId,
      ...members.map((m) => m.userId),
    ]);
    const invalid = recipientUserIds.filter((id) => !validIds.has(id));
    if (invalid.length > 0) {
      throw new AppException({
        statusCode: 422,
        message: `recipientUserIds includes users who are not members of this workspace: ${invalid.join(', ')}`,
        type: 'ERROR',
      });
    }
  }

  private mask(channel: {
    id: string;
    kind: string;
    encryptedTarget: string | null;
  }) {
    // The stored URL is NEVER returned in full after save (acceptance
    // criterion 6) — only whether one is configured.
    return {
      hasTarget: channel.kind === 'TEAMS_WORKFLOW' && !!channel.encryptedTarget,
    };
  }

  async listChannelsService(workspaceId: string, user: Auth.UserPayload) {
    await this.assertCanView(workspaceId, user.id);
    const channels = await this.prisma.notificationChannel.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
    });
    return {
      statusCode: 200,
      message: 'Notification channels fetched',
      type: 'SUCCESS' as const,
      data: {
        channels: channels.map((c) => ({
          id: c.id,
          kind: c.kind,
          name: c.name,
          enabled: c.enabled,
          minSeverity: c.minSeverity,
          events: c.events,
          cooldownMinutes: c.cooldownMinutes,
          mutedModelIds: c.mutedModelIds,
          recipientUserIds: c.recipientUserIds,
          ...this.mask(c),
        })),
        knownEvents: NOTIFICATION_EVENT_KINDS,
      },
    };
  }

  async createChannelService(
    workspaceId: string,
    dto: CreateNotificationChannelDto,
    user: Auth.UserPayload,
  ) {
    await this.assertIsOwner(workspaceId, user.id);
    if (dto.kind === 'EMAIL' && dto.recipientUserIds) {
      await this.assertRecipientsAreMembers(workspaceId, dto.recipientUserIds);
    }
    const channel = await this.prisma.notificationChannel.create({
      data: {
        workspaceId,
        kind: dto.kind,
        name: dto.name,
        encryptedTarget:
          dto.kind === 'TEAMS_WORKFLOW' && dto.target
            ? encryptSecret(dto.target)
            : null,
        recipientUserIds: dto.recipientUserIds ?? [],
        enabled: dto.enabled ?? true,
        minSeverity: dto.minSeverity ?? 'WARNING',
        events: dto.events ?? DEFAULT_ON_EVENT_KINDS,
        cooldownMinutes: dto.cooldownMinutes ?? 0,
        mutedModelIds: dto.mutedModelIds ?? [],
        createdById: user.id,
      },
    });
    return {
      statusCode: 201,
      message: 'Notification channel created',
      type: 'SUCCESS' as const,
      data: { id: channel.id, ...this.mask(channel) },
    };
  }

  async updateChannelService(
    workspaceId: string,
    channelId: string,
    dto: UpdateNotificationChannelDto,
    user: Auth.UserPayload,
  ) {
    await this.assertIsOwner(workspaceId, user.id);
    const existing = await this.prisma.notificationChannel.findFirst({
      where: { id: channelId, workspaceId },
    });
    if (!existing) {
      throw new AppException({
        statusCode: 404,
        message: 'Notification channel not found',
        type: 'ERROR',
      });
    }
    if (dto.recipientUserIds) {
      await this.assertRecipientsAreMembers(workspaceId, dto.recipientUserIds);
    }
    if (
      existing.kind === 'TEAMS_WORKFLOW' &&
      dto.target !== undefined &&
      !dto.target.startsWith('https://')
    ) {
      throw new AppException({
        statusCode: 422,
        message: 'target must be an https:// URL.',
        type: 'ERROR',
      });
    }
    const updated = await this.prisma.notificationChannel.update({
      where: { id: channelId },
      data: {
        name: dto.name,
        encryptedTarget:
          existing.kind === 'TEAMS_WORKFLOW' && dto.target
            ? encryptSecret(dto.target)
            : undefined,
        recipientUserIds: dto.recipientUserIds,
        enabled: dto.enabled,
        minSeverity: dto.minSeverity,
        events: dto.events,
        cooldownMinutes: dto.cooldownMinutes,
        mutedModelIds: dto.mutedModelIds,
      },
    });
    return {
      statusCode: 200,
      message: 'Notification channel updated',
      type: 'SUCCESS' as const,
      data: { id: updated.id, ...this.mask(updated) },
    };
  }

  async deleteChannelService(
    workspaceId: string,
    channelId: string,
    user: Auth.UserPayload,
  ) {
    await this.assertIsOwner(workspaceId, user.id);
    const existing = await this.prisma.notificationChannel.findFirst({
      where: { id: channelId, workspaceId },
      select: { id: true },
    });
    if (!existing) {
      throw new AppException({
        statusCode: 404,
        message: 'Notification channel not found',
        type: 'ERROR',
      });
    }
    await this.prisma.notificationChannel.delete({ where: { id: channelId } });
    return {
      statusCode: 200,
      message: 'Notification channel deleted',
      type: 'SUCCESS' as const,
    };
  }

  /** Goes through the REAL sender (`NotificationDeliveryService.attempt`),
   *  same code path the drain sweep uses — "send test notification" must
   *  show the real result, never a simulated one. */
  async sendTestMessageService(
    workspaceId: string,
    channelId: string,
    user: Auth.UserPayload,
  ) {
    await this.assertIsOwner(workspaceId, user.id);
    const channel = await this.prisma.notificationChannel.findFirst({
      where: { id: channelId, workspaceId },
    });
    if (!channel) {
      throw new AppException({
        statusCode: 404,
        message: 'Notification channel not found',
        type: 'ERROR',
      });
    }

    const msg = buildNotificationMessage({
      modelId: null,
      modelName: 'Test notification',
      workspaceName: '',
      axis: null,
      title: 'SoftSensor test notification',
      detail: 'This is a test message from this channel’s settings.',
      severity: 'INFO',
      at: new Date(),
    });

    const row = await this.prisma.notificationDelivery.create({
      data: {
        channelId: channel.id,
        modelId: null,
        axis: null,
        event: 'TEST_MESSAGE',
        severity: 'INFO',
        eventKey: `TEST_MESSAGE:${Date.now()}`,
        payload: {
          title: msg.title,
          bodyText: msg.bodyText,
          modelUrl: msg.modelUrl,
        },
        status: 'PENDING',
      },
      include: { channel: true },
    });
    await this.delivery.attempt(row);
    const result = await this.prisma.notificationDelivery.findUniqueOrThrow({
      where: { id: row.id },
    });
    return {
      statusCode: 200,
      message:
        result.status === 'SENT'
          ? 'Test notification sent'
          : 'Test notification failed',
      type: 'SUCCESS' as const,
      data: { status: result.status, lastError: result.lastError },
    };
  }

  async listDeliveriesService(
    workspaceId: string,
    channelId: string,
    user: Auth.UserPayload,
    page: number,
    limit: number,
  ) {
    await this.assertCanView(workspaceId, user.id);
    const channel = await this.prisma.notificationChannel.findFirst({
      where: { id: channelId, workspaceId },
      select: { id: true },
    });
    if (!channel) {
      throw new AppException({
        statusCode: 404,
        message: 'Notification channel not found',
        type: 'ERROR',
      });
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.notificationDelivery.findMany({
        where: { channelId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.notificationDelivery.count({ where: { channelId } }),
    ]);
    return {
      statusCode: 200,
      message: 'Delivery history fetched',
      type: 'SUCCESS' as const,
      data: { items, total, page, limit },
    };
  }
}
