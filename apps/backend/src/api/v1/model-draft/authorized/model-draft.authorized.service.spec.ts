import { AppException } from '@softsensor/common';
import { ModelDraftAuthorizedService } from './model-draft.authorized.service';

/**
 * MODEL-FLOW-010-T08. Covers `listDraftsService`, the route that makes a
 * ModelDraft reachable again after the user left the wizard to go and edit a
 * dataset — no other method here changed, and the workspace-scope extraction
 * they now share is exercised through this one.
 *
 * The assertions worth having are all about the WHERE clause, because that is
 * where a list route goes wrong: silently listing another tenant's drafts is
 * invisible in a happy-path test that only counts rows.
 */

const USER: Auth.UserPayload = {
  id: 'user-1',
  role: 'MEMBER',
} as Auth.UserPayload;

const ADMIN: Auth.UserPayload = {
  id: 'admin-1',
  role: 'ADMIN',
} as Auth.UserPayload;

const DRAFT_ROW = {
  id: 'draft-1',
  name: 'Boiler efficiency',
  workspaceId: 'ws-1',
  plantId: 'plant-1',
  nodeId: 'node-1',
  datasetId: 'ds-1',
  targetY: 'TAG_A',
  algorithm: 'ridge',
  hyperparameters: { alpha: 1 },
  splitRatio: 0.8,
  status: 'ACTIVE',
  currentRunId: null,
  savedModelId: null,
  createdAt: new Date('2026-08-20T10:00:00.000Z'),
  updatedAt: new Date('2026-08-21T11:00:00.000Z'),
};

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    workspace: {
      findFirst: jest.fn().mockResolvedValue({ id: 'ws-1' }),
    },
    modelDraft: {
      findMany: jest.fn().mockResolvedValue([DRAFT_ROW]),
      findFirst: jest.fn().mockResolvedValue(DRAFT_ROW),
      create: jest.fn(),
      update: jest.fn(),
    },
    ...overrides,
  };
}

function makeService(prisma: ReturnType<typeof buildPrisma>) {
  return new ModelDraftAuthorizedService(
    prisma as unknown as ConstructorParameters<
      typeof ModelDraftAuthorizedService
    >[0],
  );
}

describe('ModelDraftAuthorizedService — draft access and listing', () => {
  it('scopes to the caller’s own workspaces even with no filters', async () => {
    const prisma = buildPrisma();
    const service = makeService(prisma);

    await service.listDraftsService(USER, {});

    const args = prisma.modelDraft.findMany.mock.calls[0][0];
    // The scope is applied regardless of filters — an unfiltered call must
    // not become "every draft in the database".
    expect(args.where.workspace).toEqual({
      deletedAt: null,
      OR: [{ ownerId: 'user-1' }, { members: { some: { userId: 'user-1' } } }],
    });
    expect(args.where.workspaceId).toBeUndefined();
    expect(args.where.status).toBeUndefined();
    expect(args.orderBy).toEqual({ updatedAt: 'desc' });
  });

  it('applies the workspace and status filters when given', async () => {
    const prisma = buildPrisma();
    const service = makeService(prisma);

    await service.listDraftsService(USER, {
      workspaceId: 'ws-1',
      status: 'ACTIVE',
    });

    const args = prisma.modelDraft.findMany.mock.calls[0][0];
    expect(args.where.workspaceId).toBe('ws-1');
    expect(args.where.status).toBe('ACTIVE');
  });

  it('404s for a workspace the caller cannot reach, rather than returning []', async () => {
    // An empty list would read as "no drafts here", which is a different
    // fact from "this workspace is not yours".
    const prisma = buildPrisma({
      workspace: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    const service = makeService(prisma);

    await expect(
      service.listDraftsService(USER, { workspaceId: 'ws-other' }),
    ).rejects.toBeInstanceOf(AppException);
    expect(prisma.modelDraft.findMany).not.toHaveBeenCalled();
  });

  it('drops the owner-or-member clause for an ADMIN but keeps deletedAt', async () => {
    const prisma = buildPrisma();
    const service = makeService(prisma);

    await service.listDraftsService(ADMIN, {});

    const args = prisma.modelDraft.findMany.mock.calls[0][0];
    expect(args.where.workspace).toEqual({ deletedAt: null });
  });

  it('shares ONE access clause with the single-draft GET', async () => {
    // `workspaceScope` was extracted this pass and now backs
    // assertWorkspaceAccess, assertDraftAccess and the list — so the list
    // cannot drift wider than the routes it links to. Two clauses that merely
    // agree today would pass a per-method test and diverge later; this
    // compares them directly.
    const prisma = buildPrisma();
    const service = makeService(prisma);

    await service.listDraftsService(USER, {});
    await service.getDraftService(USER, 'draft-1');

    const listWhere = prisma.modelDraft.findMany.mock.calls[0][0].where;
    const getWhere = prisma.modelDraft.findFirst.mock.calls[0][0].where;
    expect(getWhere.workspace).toEqual(listWhere.workspace);
    expect(getWhere.id).toBe('draft-1');
  });

  it('404s a draft the access clause filters out', async () => {
    const prisma = buildPrisma({
      modelDraft: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn(),
      },
    });
    const service = makeService(prisma);

    await expect(
      service.getDraftService(USER, 'draft-someone-elses'),
    ).rejects.toBeInstanceOf(AppException);
  });

  it('serialises dates as ISO strings, same shape as the single-draft GET', async () => {
    const prisma = buildPrisma();
    const service = makeService(prisma);

    const res = await service.listDraftsService(USER, {});

    expect(res.statusCode).toBe(200);
    expect(res.data).toHaveLength(1);
    expect(res.data[0]).toMatchObject({
      id: 'draft-1',
      datasetId: 'ds-1',
      targetY: 'TAG_A',
      algorithm: 'ridge',
      // A FRACTION, never a percentage — the client multiplies by 100 on the
      // way into the wizard, and this is the boundary that must not drift.
      splitRatio: 0.8,
      updatedAt: '2026-08-21T11:00:00.000Z',
    });
  });
});
