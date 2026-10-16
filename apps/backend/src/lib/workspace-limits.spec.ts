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
  limitBlocker,
  limitUsage,
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
