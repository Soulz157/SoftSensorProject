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

import { WorkspaceAdminService } from './workspace.admin.service';

/**
 * MODEL-SERVE-035. The member cap binds an admin too (invite and move), and
 * an admin may set a cap below the current count — nothing is removed.
 */
function build(opts: { maxMembers: number | null; memberCount: number }) {
  const member = {
    id: 'm-1',
    userId: 'u-1',
    role: 'VIEWER',
    workspaceId: 'ws-src',
  };
  const prisma = {
    $transaction: jest.fn(),
    $queryRaw: jest.fn().mockResolvedValue([]),
    workspace: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'ws-1',
        maxModels: null,
        maxMembers: opts.maxMembers,
      }),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          ...data,
          _count: { members: opts.memberCount, models: 8 },
        }),
      ),
    },
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'invitee' }) },
    workspaceMember: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(member),
      count: jest.fn().mockResolvedValue(opts.memberCount),
      create: jest.fn().mockResolvedValue({ id: 'new' }),
      update: jest.fn().mockResolvedValue({ id: 'm-1' }),
    },
  };
  prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) =>
    fn(prisma),
  );
  return { prisma, service: new WorkspaceAdminService(prisma as never) };
}

describe('WorkspaceAdminService — member limit', () => {
  it('refuses an admin invite with 409 when the workspace is full', async () => {
    const { prisma, service } = build({ maxMembers: 3, memberCount: 3 });
    await expect(
      service.inviteMember('ws-1', { email: 'a@b.c', role: 'VIEWER' }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(prisma.workspaceMember.create).not.toHaveBeenCalled();
  });

  it('invites when there is room', async () => {
    const { prisma, service } = build({ maxMembers: 3, memberCount: 2 });
    await service.inviteMember('ws-1', { email: 'a@b.c', role: 'VIEWER' });
    expect(prisma.workspaceMember.create).toHaveBeenCalledTimes(1);
  });

  it('refuses a move into a full target workspace and leaves the member where it was', async () => {
    const { prisma, service } = build({ maxMembers: 2, memberCount: 2 });
    await expect(
      service.moveMember('ws-src', 'm-1', { targetWorkspaceId: 'ws-1' }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(prisma.workspaceMember.update).not.toHaveBeenCalled();
  });
});

describe('WorkspaceAdminService.updateWorkspaceLimits', () => {
  it('saves a cap below the current count and reports it as over', async () => {
    const { prisma, service } = build({ maxMembers: null, memberCount: 4 });
    const res = await service.updateWorkspaceLimits('ws-1', {
      maxModels: 5,
      maxMembers: null,
    });
    expect(prisma.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { maxModels: 5, maxMembers: null } }),
    );
    expect(res.data.usage.models).toEqual({
      current: 8,
      limit: 5,
      full: true,
      over: true,
      source: 'admin',
    });
    expect(res.data.usage.members.limit).toBeNull();
  });

  it('MODEL-SERVE-040: a cleared cap falls back to the owner plan and says so', async () => {
    const { prisma, service } = build({ maxMembers: null, memberCount: 4 });
    prisma.workspace.findUnique.mockResolvedValue({
      id: 'ws-1',
      maxModels: null,
      maxMembers: null,
      owner: {
        subscriptions: [
          {
            plan: { maxModelsPerWorkspace: 30, maxMembersPerWorkspace: 10 },
          },
        ],
      },
    });
    const res = await service.updateWorkspaceLimits('ws-1', {
      maxModels: null,
      maxMembers: null,
    });
    expect(res.data.usage.models).toMatchObject({
      limit: 30,
      source: 'plan',
      current: 8,
    });
    expect(res.data.usage.members).toMatchObject({ limit: 10, source: 'plan' });
    expect(res.data.planQuota).toEqual({ maxModels: 30, maxMembers: 10 });
  });

  it('404s a missing workspace', async () => {
    const { prisma, service } = build({ maxMembers: null, memberCount: 0 });
    prisma.workspace.findUnique.mockResolvedValue(null);
    await expect(
      service.updateWorkspaceLimits('nope', { maxModels: 1, maxMembers: 1 }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
