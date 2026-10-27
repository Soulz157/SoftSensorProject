jest.mock('@softsensor/common', () => ({
  AppException: class AppException extends Error {
    readonly statusCode: number;
    constructor(body: { statusCode: number; message: string }) {
      super(body.message);
      this.statusCode = body.statusCode;
    }
  },
}));

import {
  assertWorkspaceCapacity,
  buildQuota,
  limitBlocker,
  limitUsage,
  loadWorkspaceLimits,
  pickLimit,
} from './workspace-limits';
import { UpdateWorkspaceRequestSchema } from '@/api/v1/workspace/admin/dto/workspace.admin.dto';

describe('limitUsage', () => {
  it('treats null as no limit', () => {
    expect(limitUsage(null, 999)).toEqual({
      current: 999,
      limit: null,
      full: false,
      over: false,
    });
  });

  it.each([
    [5, 4, false, false],
    [5, 5, true, false],
    [5, 8, true, true],
  ])(
    'limit %i with %i in use: full=%s over=%s',
    (limit, current, full, over) => {
      expect(limitUsage(limit, current)).toMatchObject({ full, over });
    },
  );
});

describe('limitBlocker', () => {
  it('is null while there is room, or with no limit', () => {
    expect(limitBlocker('models', 5, 4)).toBeNull();
    expect(limitBlocker('members', null, 50)).toBeNull();
  });

  it('names the kind and the limit when full', () => {
    expect(limitBlocker('models', 10, 10)).toBe(
      'This workspace has reached its model limit (10). Ask an admin to raise it.',
    );
    expect(limitBlocker('members', 5, 7)).toContain('member limit (5)');
  });
});

describe('assertWorkspaceCapacity', () => {
  function tx(
    limits: { maxModels: number | null; maxMembers: number | null } | null,
    count: number,
  ) {
    return {
      $queryRaw: jest.fn().mockResolvedValue([]),
      workspace: { findUnique: jest.fn().mockResolvedValue(limits) },
      model: { count: jest.fn().mockResolvedValue(count) },
      workspaceMember: { count: jest.fn().mockResolvedValue(count) },
    };
  }

  it('locks the workspace row before counting', async () => {
    const t = tx({ maxModels: 3, maxMembers: null }, 1);
    await assertWorkspaceCapacity(t as never, 'ws-1', 'models');
    expect(t.$queryRaw).toHaveBeenCalledTimes(1);
    expect(t.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      t.model.count.mock.invocationCallOrder[0],
    );
  });

  it('does not count at all when there is no limit', async () => {
    const t = tx({ maxModels: null, maxMembers: null }, 100);
    await assertWorkspaceCapacity(t as never, 'ws-1', 'members');
    expect(t.workspaceMember.count).not.toHaveBeenCalled();
  });

  it('throws 409 when full', async () => {
    const t = tx({ maxModels: null, maxMembers: 2 }, 2);
    await expect(
      assertWorkspaceCapacity(t as never, 'ws-1', 'members'),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('throws 404 for a missing workspace', async () => {
    await expect(
      assertWorkspaceCapacity(tx(null, 0) as never, 'nope', 'models'),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('MODEL-SERVE-040 — the owner plan supplies the default cap', () => {
  const free = { maxModelsPerWorkspace: 5, maxMembersPerWorkspace: 3 };
  const enterprise = {
    maxModelsPerWorkspace: null,
    maxMembersPerWorkspace: null,
  };

  function db(opts: {
    admin?: { maxModels: number | null; maxMembers: number | null };
    subscriptionPlan?: typeof free | null;
    freeRow?: typeof free | null;
    count?: number;
  }) {
    return {
      $queryRaw: jest.fn().mockResolvedValue([]),
      workspace: {
        findUnique: jest.fn().mockResolvedValue({
          maxModels: opts.admin?.maxModels ?? null,
          maxMembers: opts.admin?.maxMembers ?? null,
          owner: {
            subscriptions: opts.subscriptionPlan
              ? [{ plan: opts.subscriptionPlan }]
              : [],
          },
        }),
      },
      plan: { findUnique: jest.fn().mockResolvedValue(opts.freeRow ?? null) },
      model: { count: jest.fn().mockResolvedValue(opts.count ?? 0) },
      workspaceMember: { count: jest.fn().mockResolvedValue(opts.count ?? 0) },
    };
  }

  it('pickLimit: admin beats plan, plan beats nothing', () => {
    expect(pickLimit(7, 30)).toEqual({ limit: 7, source: 'admin' });
    expect(pickLimit(null, 30)).toEqual({ limit: 30, source: 'plan' });
    expect(pickLimit(null, null)).toEqual({ limit: null, source: 'none' });
    expect(pickLimit(null, undefined)).toEqual({ limit: null, source: 'none' });
  });

  it('uses the subscription plan when no admin cap is set', async () => {
    const loaded = await loadWorkspaceLimits(
      db({ subscriptionPlan: free }) as never,
      'ws-1',
    );
    expect(loaded?.resolved).toEqual({
      models: { limit: 5, source: 'plan' },
      members: { limit: 3, source: 'plan' },
    });
  });

  it('an admin cap overrides the plan, per kind', async () => {
    const loaded = await loadWorkspaceLimits(
      db({
        admin: { maxModels: 50, maxMembers: null },
        subscriptionPlan: free,
      }) as never,
      'ws-1',
    );
    expect(loaded?.resolved.models).toEqual({ limit: 50, source: 'admin' });
    expect(loaded?.resolved.members).toEqual({ limit: 3, source: 'plan' });
  });

  it('a plan with null quotas (ENTERPRISE) means no limit', async () => {
    const loaded = await loadWorkspaceLimits(
      db({ subscriptionPlan: enterprise as never }) as never,
      'ws-1',
    );
    expect(loaded?.resolved.models).toEqual({ limit: null, source: 'none' });
  });

  it('only ACTIVE / TRIALING, newest first, is asked of the subscription', async () => {
    const d = db({ subscriptionPlan: free });
    await loadWorkspaceLimits(d as never, 'ws-1');
    const args = d.workspace.findUnique.mock.calls[0] as [
      {
        select: {
          owner: { select: { subscriptions: Record<string, unknown> } };
        };
      },
    ];
    const subscriptions = args[0].select.owner.select.subscriptions;
    expect(subscriptions.where).toEqual({
      status: { in: ['ACTIVE', 'TRIALING'] },
    });
    expect(subscriptions.orderBy).toEqual({ createdAt: 'desc' });
    expect(subscriptions.take).toBe(1);
  });

  it('no live subscription falls back to the FREE plan row', async () => {
    const d = db({ subscriptionPlan: null, freeRow: free });
    const loaded = await loadWorkspaceLimits(d as never, 'ws-1');
    expect(d.plan.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: 'FREE' } }),
    );
    expect(loaded?.resolved.members).toEqual({ limit: 3, source: 'plan' });
  });

  it('no subscription and no FREE row is no limit, not an error', async () => {
    const loaded = await loadWorkspaceLimits(
      db({ subscriptionPlan: null, freeRow: null }) as never,
      'ws-1',
    );
    expect(loaded?.resolved.models.limit).toBeNull();
  });

  it('assertWorkspaceCapacity refuses at the plan cap with the plan wording', async () => {
    const t = db({ subscriptionPlan: free, count: 3 });
    const refusal = assertWorkspaceCapacity(t as never, 'ws-1', 'members');
    await expect(refusal).rejects.toMatchObject({ statusCode: 409 });
    await expect(refusal).rejects.toThrow("under the owner's subscription");
  });

  it('assertWorkspaceCapacity admits below the plan cap', async () => {
    const t = db({ subscriptionPlan: free, count: 2 });
    await expect(
      assertWorkspaceCapacity(t as never, 'ws-1', 'members'),
    ).resolves.toBeUndefined();
  });

  it('limitBlocker keeps the admin wording by default', () => {
    expect(limitBlocker('models', 10, 10)).toContain('Ask an admin');
    expect(limitBlocker('models', 10, 10, 'plan')).toContain(
      "owner's subscription",
    );
  });

  it('buildQuota reports usage against the effective cap and its source', () => {
    expect(
      buildQuota(
        {
          models: { limit: 5, source: 'plan' },
          members: { limit: null, source: 'none' },
        },
        { models: 5, members: 9 },
      ),
    ).toEqual({
      models: { current: 5, limit: 5, full: true, over: false, source: 'plan' },
      members: {
        current: 9,
        limit: null,
        full: false,
        over: false,
        source: 'none',
      },
    });
  });
});

describe('owner-facing workspace update cannot set limits', () => {
  it('UpdateWorkspaceRequestSchema strips maxModels / maxMembers', () => {
    const parsed = UpdateWorkspaceRequestSchema.parse({
      name: 'X',
      maxModels: 1000,
      maxMembers: 1000,
    });
    expect(parsed).toEqual({ name: 'X' });
  });
});
