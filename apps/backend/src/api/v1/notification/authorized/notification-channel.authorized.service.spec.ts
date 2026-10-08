import { NotificationChannelAuthorizedService } from './notification-channel.authorized.service';
import type { NotificationDeliveryService } from '../core/notification-delivery.service';

/**
 * Read vs write access to a workspace's notification channels (2026-10-01):
 * the owner and STAFF members may VIEW channels and delivery history; only
 * the owner may create, edit, delete or test-send. A VIEWER sees neither
 * unless an OWNER granted NOTIFICATIONS_VIEW (2026-10-07) — and then may
 * view only, never write.
 */
const user = {
  id: 'user-1',
  role: 'USER' as const,
  email: 'u@example.com',
  firstName: 'A',
  lastName: 'B',
  company: null,
};

function build(
  memberRole: 'OWNER' | 'STAFF' | 'VIEWER' | null,
  ownerId = 'someone-else',
  permissions: string[] = [],
) {
  const prisma = {
    workspace: {
      findUnique: jest.fn().mockResolvedValue({ ownerId }),
    },
    workspaceMember: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          memberRole ? { role: memberRole, permissions } : null,
        ),
    },
    notificationChannel: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue({ id: 'ch-1' }),
      delete: jest.fn().mockResolvedValue({}),
    },
    notificationDelivery: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  const service = new NotificationChannelAuthorizedService(
    prisma as never,
    {} as NotificationDeliveryService,
  );
  return { service, prisma };
}

describe('NotificationChannelAuthorizedService — read access', () => {
  it.each(['OWNER', 'STAFF'] as const)(
    'lets a %s member list channels',
    async (role) => {
      const { service } = build(role);
      await expect(
        service.listChannelsService('ws-1', user as never),
      ).resolves.toMatchObject({ statusCode: 200 });
    },
  );

  it('lets the workspace owner list channels without a member row', async () => {
    const { service } = build(null, 'user-1');
    await expect(
      service.listChannelsService('ws-1', user as never),
    ).resolves.toMatchObject({ statusCode: 200 });
  });

  it('lets a STAFF member read delivery history', async () => {
    const { service } = build('STAFF');
    await expect(
      service.listDeliveriesService('ws-1', 'ch-1', user as never, 1, 20),
    ).resolves.toMatchObject({ statusCode: 200 });
  });

  it('lets a VIEWER granted NOTIFICATIONS_VIEW list channels and history', async () => {
    const { service } = build('VIEWER', 'someone-else', ['NOTIFICATIONS_VIEW']);
    await expect(
      service.listChannelsService('ws-1', user as never),
    ).resolves.toMatchObject({ statusCode: 200 });
    await expect(
      service.listDeliveriesService('ws-1', 'ch-1', user as never, 1, 20),
    ).resolves.toMatchObject({ statusCode: 200 });
  });

  it('refuses a VIEWER granted only MONITORING_VIEW', async () => {
    const { service } = build('VIEWER', 'someone-else', ['MONITORING_VIEW']);
    await expect(
      service.listChannelsService('ws-1', user as never),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it.each([['VIEWER'], [null]] as const)(
    'refuses %s with a 403',
    async (role) => {
      const { service } = build(role);
      await expect(
        service.listChannelsService('ws-1', user as never),
      ).rejects.toMatchObject({ statusCode: 403 });
    },
  );
});

describe('NotificationChannelAuthorizedService — writes stay owner-only', () => {
  it('refuses a STAFF member deleting a channel', async () => {
    const { service, prisma } = build('STAFF');
    await expect(
      service.deleteChannelService('ws-1', 'ch-1', user as never),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(prisma.notificationChannel.delete).not.toHaveBeenCalled();
  });

  it('refuses a VIEWER granted NOTIFICATIONS_VIEW deleting a channel', async () => {
    const { service, prisma } = build('VIEWER', 'someone-else', [
      'NOTIFICATIONS_VIEW',
    ]);
    await expect(
      service.deleteChannelService('ws-1', 'ch-1', user as never),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(prisma.notificationChannel.delete).not.toHaveBeenCalled();
  });
});

describe('NotificationChannelAuthorizedService — focus models (MODEL-SERVE-022-D-FOCUS)', () => {
  it('refuses a focus model that is not in the workspace with a 422', async () => {
    const { service, prisma } = build('OWNER');
    (prisma as unknown as { model: unknown }).model = {
      findMany: jest.fn().mockResolvedValue([{ id: 'm-in' }]),
    };
    await expect(
      service.createChannelService(
        'ws-1',
        {
          kind: 'TEAMS_WORKFLOW',
          name: 'Ops',
          target: 'https://example.com/hook',
          focusModelIds: ['m-in', 'm-foreign'],
        } as never,
        user as never,
      ),
    ).rejects.toMatchObject({ statusCode: 422 });
  });
});
