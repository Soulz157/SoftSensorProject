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
  userId?: string;
  role: 'OWNER' | 'STAFF' | 'VIEWER';
  permissions: string[];
};

function build(
  target: Member,
  actorRole: Member['role'] | null = 'OWNER',
  actorPermissions: string[] = [],
) {
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
        .mockResolvedValue(
          actorRole ? { role: actorRole, permissions: actorPermissions } : null,
        ),
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

/**
 * MODEL-SERVE-034. A STAFF member an owner gave MEMBER_ROLE_ASSIGN may switch
 * OTHER non-owner members between STAFF and VIEWER — nothing that leads to
 * owner power, and never their own role or anyone's member-management grants.
 */
describe('WorkspaceAuthorizedService.updateMemberRole — delegated role assignment', () => {
  const delegate = (target: Member) =>
    build(target, 'STAFF', ['MEMBER_ROLE_ASSIGN']);
  const other = (role: Member['role'], permissions: string[] = []): Member => ({
    id: 'm-1',
    userId: 'someone',
    role,
    permissions,
  });

  it('switches a VIEWER to STAFF', async () => {
    const { service, update } = delegate(other('VIEWER', ['MONITORING_VIEW']));
    await service.updateMemberRole('ws-1', 'm-1', 'actor', { role: 'STAFF' });
    expect(update.mock.calls[0][0].data).toEqual({
      role: 'STAFF',
      permissions: [],
    });
  });

  it("switches a STAFF to VIEWER and sets the viewer's read grants", async () => {
    const { service, update } = delegate(other('STAFF'));
    await service.updateMemberRole('ws-1', 'm-1', 'actor', {
      role: 'VIEWER',
      permissions: ['NOTIFICATIONS_VIEW'],
    });
    expect(update.mock.calls[0][0].data).toEqual({
      role: 'VIEWER',
      permissions: ['NOTIFICATIONS_VIEW'],
    });
  });

  it("cannot add or remove a STAFF member's member-management grants", async () => {
    const { service, update } = delegate(other('STAFF', ['MEMBER_INVITE']));
    await service.updateMemberRole('ws-1', 'm-1', 'actor', {
      role: 'STAFF',
      permissions: ['MEMBER_ROLE_ASSIGN'],
    });
    expect(update.mock.calls[0][0].data.permissions).toEqual(['MEMBER_INVITE']);
  });

  it.each([
    ['an owner', other('OWNER'), 'VIEWER'],
    ['their own row', { ...other('VIEWER'), userId: 'actor' }, 'STAFF'],
    ['a promotion to OWNER', other('STAFF'), 'OWNER'],
  ] as const)(
    'refuses %s with 403 and writes nothing',
    async (_, target, role) => {
      const { service, update } = delegate(target);
      await expect(
        service.updateMemberRole('ws-1', 'm-1', 'actor', { role }),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(update).not.toHaveBeenCalled();
    },
  );

  it('refuses a STAFF holding only MEMBER_INVITE', async () => {
    const { service, update } = build(other('VIEWER'), 'STAFF', [
      'MEMBER_INVITE',
    ]);
    await expect(
      service.updateMemberRole('ws-1', 'm-1', 'actor', { role: 'STAFF' }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(update).not.toHaveBeenCalled();
  });
});

describe('WorkspaceAuthorizedService.inviteMember — delegated invite', () => {
  function buildInvite(
    actorRole: Member['role'] | null,
    actorPermissions: string[] = [],
    limits: { maxMembers: number | null; memberCount: number } = {
      maxMembers: null,
      memberCount: 0,
    },
  ) {
    const create = jest.fn(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'new', ...data }),
    );
    const prisma = {
      // MODEL-SERVE-035: the invite runs in a transaction that locks the
      // workspace row and checks the member cap.
      $transaction: jest.fn(),
      $queryRaw: jest.fn().mockResolvedValue([]),
      workspace: {
        findUnique: jest.fn().mockResolvedValue({
          ownerId: 'someone-else',
          maxModels: null,
          maxMembers: limits.maxMembers,
        }),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'invitee' }) },
      workspaceMember: {
        findUnique: jest.fn(
          (args: { where: { workspaceId_userId: { userId: string } } }) =>
            Promise.resolve(
              args.where.workspaceId_userId.userId === 'actor' && actorRole
                ? { role: actorRole, permissions: actorPermissions }
                : null,
            ),
        ),
        count: jest.fn().mockResolvedValue(limits.memberCount),
        create,
      },
    };
    prisma.$transaction.mockImplementation(
      (fn: (tx: typeof prisma) => unknown) => fn(prisma),
    );
    const service = new WorkspaceAuthorizedService(prisma as never);
    return { service, create };
  }

  it('refuses with 409 when the workspace is at its member limit, even for an OWNER (MODEL-SERVE-035)', async () => {
    const { service, create } = buildInvite('OWNER', [], {
      maxMembers: 5,
      memberCount: 5,
    });
    const inviting = service.inviteMember('ws-1', 'actor', {
      email: 'a@b.c',
      role: 'VIEWER',
    });
    await expect(inviting).rejects.toMatchObject({ statusCode: 409 });
    await expect(inviting).rejects.toThrow('member limit (5)');
    expect(create).not.toHaveBeenCalled();
  });

  it('invites when the workspace is under its member limit', async () => {
    const { service, create } = buildInvite('OWNER', [], {
      maxMembers: 5,
      memberCount: 4,
    });
    await service.inviteMember('ws-1', 'actor', {
      email: 'a@b.c',
      role: 'VIEWER',
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it.each(['STAFF', 'VIEWER'] as const)(
    'lets a STAFF with MEMBER_INVITE invite as %s',
    async (role) => {
      const { service, create } = buildInvite('STAFF', ['MEMBER_INVITE']);
      await service.inviteMember('ws-1', 'actor', { email: 'a@b.c', role });
      expect(create).toHaveBeenCalledTimes(1);
      expect(create.mock.calls[0][0].data).toMatchObject({ role });
    },
  );

  it.each([
    ['as OWNER, even with the grant', 'STAFF', ['MEMBER_INVITE'], 'OWNER'],
    ['without the grant', 'STAFF', ['MEMBER_ROLE_ASSIGN'], 'VIEWER'],
    ['from a VIEWER', 'VIEWER', [], 'VIEWER'],
  ] as const)('refuses an invite %s', async (_, actorRole, perms, role) => {
    const { service, create } = buildInvite(actorRole, [...perms]);
    await expect(
      service.inviteMember('ws-1', 'actor', { email: 'a@b.c', role }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(create).not.toHaveBeenCalled();
  });

  it('lets an OWNER invite as OWNER', async () => {
    const { service, create } = buildInvite('OWNER');
    await service.inviteMember('ws-1', 'actor', {
      email: 'a@b.c',
      role: 'OWNER',
    });
    expect(create).toHaveBeenCalledTimes(1);
  });
});
