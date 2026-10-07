import { WorkspaceAuthorizedService } from './workspace.authorized.service';

jest.mock('@softsensor/common', () => ({
  AppException: class AppException extends Error {
    readonly statusCode: number;
    constructor(body: { statusCode: number; message: string }) {
      super(body.message);
      this.statusCode = body.statusCode;
    }
  },
}));

jest.mock('@softsensor/prisma', () => ({ PrismaService: class {} }));

/**
 * `updateMemberRole` carries the VIEWER feature grants (2026-10-07). Grants
 * are stored only for a VIEWER; any other role stores none. Omitting
 * `permissions` keeps the member's current grants.
 */
type Member = {
  id: string;
  role: 'OWNER' | 'STAFF' | 'VIEWER';
  permissions: string[];
};

function build(target: Member, actorRole: Member['role'] | null = 'OWNER') {
  const update = jest.fn(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ ...target, ...data }),
  );
  const prisma = {
    workspace: {
      findUnique: jest.fn().mockResolvedValue({ ownerId: 'someone-else' }),
    },
    workspaceMember: {
      findUnique: jest
        .fn()
        .mockResolvedValue(actorRole ? { role: actorRole } : null),
      findFirst: jest.fn().mockResolvedValue(target),
      count: jest.fn().mockResolvedValue(1),
      update,
    },
  };
  const service = new WorkspaceAuthorizedService(prisma as never);
  return { service, update };
}

const viewer = (permissions: string[] = []): Member => ({
  id: 'm-1',
  role: 'VIEWER',
  permissions,
});

describe('WorkspaceAuthorizedService.updateMemberRole — feature grants', () => {
  it('stores the grants an OWNER gives a VIEWER', async () => {
    const { service, update } = build(viewer());
    await service.updateMemberRole('ws-1', 'm-1', 'actor', {
      role: 'VIEWER',
      permissions: ['MONITORING_VIEW', 'NOTIFICATIONS_VIEW'],
    });
    expect(update.mock.calls[0][0].data).toEqual({
      role: 'VIEWER',
      permissions: ['MONITORING_VIEW', 'NOTIFICATIONS_VIEW'],
    });
  });

  it('keeps current grants when permissions is omitted', async () => {
    const { service, update } = build(viewer(['MONITORING_VIEW']));
    await service.updateMemberRole('ws-1', 'm-1', 'actor', { role: 'VIEWER' });
    expect(update.mock.calls[0][0].data.permissions).toEqual([
      'MONITORING_VIEW',
    ]);
  });

  it('clears grants when the member becomes STAFF', async () => {
    const { service, update } = build(viewer(['MONITORING_VIEW']));
    await service.updateMemberRole('ws-1', 'm-1', 'actor', {
      role: 'STAFF',
      permissions: ['NOTIFICATIONS_VIEW'],
    });
    expect(update.mock.calls[0][0].data).toEqual({
      role: 'STAFF',
      permissions: [],
    });
  });

  it.each(['STAFF', 'VIEWER', null] as const)(
    'refuses a %s caller with 403 and writes nothing',
    async (actorRole) => {
      const { service, update } = build(viewer(), actorRole);
      await expect(
        service.updateMemberRole('ws-1', 'm-1', 'actor', {
          role: 'VIEWER',
          permissions: ['MONITORING_VIEW'],
        }),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(update).not.toHaveBeenCalled();
    },
  );

  it('still refuses to demote the last owner', async () => {
    const { service, update } = build({
      id: 'm-1',
      role: 'OWNER',
      permissions: [],
    });
    await expect(
      service.updateMemberRole('ws-1', 'm-1', 'actor', {
        role: 'VIEWER',
        permissions: ['MONITORING_VIEW'],
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(update).not.toHaveBeenCalled();
  });
});
