import { NotificationFeedAuthorizedService } from './notification-feed.authorized.service';

const user = (role: 'USER' | 'ADMIN' = 'USER') => ({
  id: 'user-1',
  role,
  email: 'u@example.com',
  firstName: 'A',
  lastName: 'B',
  company: undefined,
});

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    notificationEvent: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue({ id: 'ev-1' }),
      count: jest.fn().mockResolvedValue(0),
    },
    notificationDismissal: {
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    notificationReadMarker: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
    },
    notificationUserMute: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    model: {
      findUnique: jest.fn().mockResolvedValue({ workspaceId: 'ws-1' }),
    },
    workspace: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    workspaceMember: {
      findUnique: jest.fn().mockResolvedValue({ role: 'VIEWER' }),
    },
    ...overrides,
  };
}

describe('NotificationFeedAuthorizedService (MODEL-SERVE-022-T07/V08)', () => {
  describe('access filter — the SAME where for list and count', () => {
    it('a non-admin, non-owner, non-member user gets no events (workspace filter excludes them)', async () => {
      const prisma = buildPrisma();
      const service = new NotificationFeedAuthorizedService(prisma as never);
      await service.listEventsService(user(), undefined, undefined);
      const calls = prisma.notificationEvent.findMany.mock.calls as unknown[][];
      const call = calls[0][0] as { where: { workspace: unknown } };
      // ADMIN sees {deletedAt:null}; a non-admin gets the ownerId-or-member
      // OR clause — assert the non-admin shape specifically.
      expect(call.where.workspace).toEqual({
        deletedAt: null,
        OR: [
          { ownerId: 'user-1' },
          { members: { some: { userId: 'user-1' } } },
        ],
      });
    });

    it('an ADMIN gets the unrestricted workspace filter', async () => {
      const prisma = buildPrisma();
      const service = new NotificationFeedAuthorizedService(prisma as never);
      await service.listEventsService(user('ADMIN'), undefined, undefined);
      const calls = prisma.notificationEvent.findMany.mock.calls as unknown[][];
      const call = calls[0][0] as { where: { workspace: unknown } };
      expect(call.where.workspace).toEqual({ deletedAt: null });
    });

    it('excludes a model the user has muted, in both list and count', async () => {
      const prisma = buildPrisma();
      const service = new NotificationFeedAuthorizedService(prisma as never);
      await service.listEventsService(user(), undefined, undefined);
      await service.unreadCountService(user());

      const findManyCalls = prisma.notificationEvent.findMany.mock
        .calls as unknown[][];
      const countCalls = prisma.notificationEvent.count.mock
        .calls as unknown[][];
      const listWhere = (findManyCalls[0][0] as { where: { model: unknown } })
        .where.model;
      const countWhere = (countCalls[0][0] as { where: { model: unknown } })
        .where.model;
      const expected = {
        notificationUserMutes: { none: { userId: 'user-1' } },
      };
      expect(listWhere).toEqual(expected);
      expect(countWhere).toEqual(expected);
    });
  });

  describe('unread count', () => {
    it('counts events created after the watermark, and nothing before it', async () => {
      const prisma = buildPrisma({
        notificationReadMarker: {
          findUnique: jest.fn().mockResolvedValue({
            lastReadAt: new Date('2026-09-01T00:00:00Z'),
          }),
        },
      });
      const service = new NotificationFeedAuthorizedService(prisma as never);
      await service.unreadCountService(user());
      const countCalls = prisma.notificationEvent.count.mock
        .calls as unknown[][];
      const call = countCalls[0][0] as { where: { createdAt: { gt: Date } } };
      expect(call.where.createdAt.gt).toEqual(new Date('2026-09-01T00:00:00Z'));
    });

    it('treats a user with no marker row as having read nothing (everything unread)', async () => {
      const prisma = buildPrisma();
      const service = new NotificationFeedAuthorizedService(prisma as never);
      await service.unreadCountService(user());
      const countCalls = prisma.notificationEvent.count.mock
        .calls as unknown[][];
      const call = countCalls[0][0] as { where: { createdAt: { gt: Date } } };
      expect(call.where.createdAt.gt).toEqual(new Date(0));
    });
  });

  describe('mark read — per-user watermark, never a per-event table', () => {
    it("marking read only upserts the CALLING user's marker", async () => {
      const prisma = buildPrisma();
      const service = new NotificationFeedAuthorizedService(prisma as never);
      await service.markReadService(user(), undefined);
      expect(prisma.notificationReadMarker.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1' } }),
      );
    });

    it("a second user's watermark is untouched by the first user's mark-read", async () => {
      const prisma = buildPrisma();
      const service = new NotificationFeedAuthorizedService(prisma as never);
      await service.markReadService(user(), undefined);
      await service.markReadService({ ...user(), id: 'user-2' }, undefined);
      const calls = prisma.notificationReadMarker.upsert.mock.calls as {
        where: { userId: string };
      }[][];
      expect(calls[0][0].where.userId).toBe('user-1');
      expect(calls[1][0].where.userId).toBe('user-2');
    });

    it('never moves the watermark backwards', async () => {
      const prisma = buildPrisma({
        notificationReadMarker: {
          findUnique: jest.fn().mockResolvedValue({
            lastReadAt: new Date('2026-09-29T12:00:00Z'),
          }),
          upsert: jest.fn(),
        },
      });
      const service = new NotificationFeedAuthorizedService(prisma as never);
      await service.markReadService(user(), '2026-09-01T00:00:00.000Z');
      expect(prisma.notificationReadMarker.upsert).not.toHaveBeenCalled();
    });
  });

  describe('mutes', () => {
    it('refuses to mute a model the user cannot read', async () => {
      const prisma = buildPrisma({
        workspaceMember: { findUnique: jest.fn().mockResolvedValue(null) },
      });
      const service = new NotificationFeedAuthorizedService(prisma as never);
      await expect(
        service.muteModelService(user(), 'model-1'),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(prisma.notificationUserMute.upsert).not.toHaveBeenCalled();
    });

    it('mutes a model the user can read', async () => {
      const prisma = buildPrisma();
      const service = new NotificationFeedAuthorizedService(prisma as never);
      await service.muteModelService(user(), 'model-1');
      expect(prisma.notificationUserMute.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId_modelId: { userId: 'user-1', modelId: 'model-1' } },
        }),
      );
    });
  });

  describe('hiding history — per user, never deleting shared events', () => {
    const marker = (lastReadAt: string, clearedAt: string | null) =>
      jest.fn().mockResolvedValue({
        lastReadAt: new Date(lastReadAt),
        clearedAt: clearedAt ? new Date(clearedAt) : null,
      });

    it('list and count both drop events this user dismissed', async () => {
      const prisma = buildPrisma();
      const service = new NotificationFeedAuthorizedService(prisma as never);
      await service.listEventsService(user(), undefined, undefined);
      await service.unreadCountService(user());
      const expected = { none: { userId: 'user-1' } };
      const list = prisma.notificationEvent.findMany.mock.calls as unknown[][];
      const count = prisma.notificationEvent.count.mock.calls as unknown[][];
      expect(
        (list[0][0] as { where: { dismissals: unknown } }).where.dismissals,
      ).toEqual(expected);
      expect(
        (count[0][0] as { where: { dismissals: unknown } }).where.dismissals,
      ).toEqual(expected);
    });

    it('after Clear all, the list starts after clearedAt (and keeps the cursor)', async () => {
      const prisma = buildPrisma({
        notificationReadMarker: {
          findUnique: marker('2026-10-01T00:00:00Z', '2026-10-05T00:00:00Z'),
        },
      });
      const service = new NotificationFeedAuthorizedService(prisma as never);
      await service.listEventsService(
        user(),
        '2026-10-07T00:00:00.000Z',
        undefined,
      );
      const calls = prisma.notificationEvent.findMany.mock.calls as unknown[][];
      expect(
        (calls[0][0] as { where: { createdAt: unknown } }).where.createdAt,
      ).toEqual({
        gt: new Date('2026-10-05T00:00:00Z'),
        lt: new Date('2026-10-07T00:00:00Z'),
      });
    });

    it('the unread count starts after the LATER of read and cleared', async () => {
      const prisma = buildPrisma({
        notificationReadMarker: {
          findUnique: marker('2026-10-01T00:00:00Z', '2026-10-05T00:00:00Z'),
        },
      });
      const service = new NotificationFeedAuthorizedService(prisma as never);
      await service.unreadCountService(user());
      const calls = prisma.notificationEvent.count.mock.calls as unknown[][];
      const call = calls[0][0] as { where: { createdAt: { gt: Date } } };
      expect(call.where.createdAt.gt).toEqual(new Date('2026-10-05T00:00:00Z'));
    });

    it('dismiss: an event the user cannot see is a 404 and writes nothing', async () => {
      const prisma = buildPrisma();
      prisma.notificationEvent.findFirst.mockResolvedValue(null);
      const service = new NotificationFeedAuthorizedService(prisma as never);
      await expect(
        service.dismissEventService(user(), 'ev-x'),
      ).rejects.toMatchObject({ statusCode: 404 });
      expect(prisma.notificationDismissal.upsert).not.toHaveBeenCalled();
    });

    it('dismiss: hides the event for the calling user only', async () => {
      const prisma = buildPrisma();
      const service = new NotificationFeedAuthorizedService(prisma as never);
      await service.dismissEventService(user(), 'ev-1');
      const find = prisma.notificationEvent.findFirst.mock.calls as unknown[][];
      expect(
        (find[0][0] as { where: { workspace: unknown } }).where.workspace,
      ).toEqual({
        deletedAt: null,
        OR: [
          { ownerId: 'user-1' },
          { members: { some: { userId: 'user-1' } } },
        ],
      });
      expect(prisma.notificationDismissal.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId_eventId: { userId: 'user-1', eventId: 'ev-1' } },
        }),
      );
    });

    it('clear: sets clearedAt (and read) to upTo, and drops covered dismissals', async () => {
      const prisma = buildPrisma();
      const service = new NotificationFeedAuthorizedService(prisma as never);
      await service.clearService(user(), '2026-10-08T01:00:00.000Z');
      const at = new Date('2026-10-08T01:00:00.000Z');
      expect(prisma.notificationReadMarker.upsert).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        create: { userId: 'user-1', lastReadAt: at, clearedAt: at },
        update: { lastReadAt: at, clearedAt: at },
      });
      expect(prisma.notificationDismissal.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', event: { createdAt: { lte: at } } },
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('clear: never moves clearedAt back, and an upTo in the future is clamped to now', async () => {
      const prisma = buildPrisma({
        notificationReadMarker: {
          findUnique: marker('2026-10-01T00:00:00Z', '2026-10-06T00:00:00Z'),
          upsert: jest.fn().mockResolvedValue({}),
        },
      });
      const service = new NotificationFeedAuthorizedService(prisma as never);
      await service.clearService(user(), '2026-10-02T00:00:00.000Z');
      const calls = prisma.notificationReadMarker.upsert.mock.calls as {
        update: { clearedAt: Date; lastReadAt: Date };
      }[][];
      expect(calls[0][0].update.clearedAt).toEqual(
        new Date('2026-10-06T00:00:00Z'),
      );

      const before = Date.now();
      await service.clearService(user(), '2999-01-01T00:00:00.000Z');
      const future = calls[1][0].update.clearedAt.getTime();
      expect(future).toBeGreaterThanOrEqual(before);
      expect(future).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('bad query input is a clean answer, not a 500', () => {
    it('a non-numeric limit falls back to the default page size', async () => {
      const prisma = buildPrisma();
      const service = new NotificationFeedAuthorizedService(prisma as never);
      await service.listEventsService(user(), undefined, Number('abc'));
      const calls = prisma.notificationEvent.findMany.mock.calls as unknown[][];
      expect((calls[0][0] as { take: number }).take).toBe(25);
    });

    it('an unparseable cursor is a 400', async () => {
      const prisma = buildPrisma();
      const service = new NotificationFeedAuthorizedService(prisma as never);
      await expect(
        service.listEventsService(user(), 'not-a-date', undefined),
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(prisma.notificationEvent.findMany).not.toHaveBeenCalled();
    });
  });
});
