import { Test, TestingModule } from '@nestjs/testing';
import { WorkspaceAuthorizedService } from './workspace.authorized.service';
import { PrismaService } from '@softsensor/prisma';

// ---------------------------------------------------------------------------
// Module mocks — must be declared before any imports that reference them
// ---------------------------------------------------------------------------

jest.mock('@softsensor/common', () => ({
  AppException: class AppException extends Error {
    readonly statusCode: number;
    readonly type: string;

    constructor(body: { statusCode: number; message: string; type: string }) {
      super(body.message);
      this.statusCode = body.statusCode;
      this.type = body.type;
    }
  },
}));

jest.mock('@softsensor/prisma', () => ({
  PrismaService: class {},
  PrismaEnums: { Role: { USER: 'USER', ADMIN: 'ADMIN' } },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

interface FindManyArgs {
  where: {
    deletedAt: null;
    OR?: Array<Record<string, unknown>>;
  };
  select: Record<string, unknown> & {
    _count: { select: Record<string, boolean> };
  };
}

describe('WorkspaceAuthorizedService', () => {
  let service: WorkspaceAuthorizedService;
  let prisma: {
    workspace: {
      findMany: jest.Mock<Promise<unknown[]>, [FindManyArgs]>;
      findUnique: jest.Mock;
    };
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceAuthorizedService,
        {
          provide: PrismaService,
          useValue: {
            workspace: {
              findMany: jest.fn(),
              findUnique: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<WorkspaceAuthorizedService>(
      WorkspaceAuthorizedService,
    );
    prisma = module.get(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // DS-LAKE-029-V02 / T02 — counts ride the list payload, one query only
  // -------------------------------------------------------------------------

  describe('getAllWorkspaces', () => {
    const user = { id: 'u1', role: 'USER' } as never;

    const makeWorkspace = (i: number) => ({
      id: `ws${i}`,
      color: 'blue',
      name: `Workspace ${i}`,
      icon: 'factory',
      thumbnailUrl: null,
      ownerId: 'u1',
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      _count: { members: 2, models: 3, plans: 4, datasets: 5 },
      nodes: [{ data: { status: 'normal' } }],
    });

    it('fetches all four relation counts inside a single select', async () => {
      const { findMany } = prisma.workspace;
      findMany.mockResolvedValue([makeWorkspace(1)]);

      await service.getAllWorkspaces(user);

      expect(findMany).toHaveBeenCalledTimes(1);
      const [args] = findMany.mock.calls[0];
      const select = args.select;
      expect(select._count).toEqual({
        select: {
          members: true,
          models: true,
          plans: true,
          datasets: true,
        },
      });
    });

    it('issues the same number of queries for one workspace and for fifty', async () => {
      const { findMany } = prisma.workspace;

      findMany.mockResolvedValue([makeWorkspace(1)]);
      await service.getAllWorkspaces(user);
      const callsForOne = findMany.mock.calls.length;

      findMany.mockClear();
      findMany.mockResolvedValue(
        Array.from({ length: 50 }, (_, i) => makeWorkspace(i)),
      );
      await service.getAllWorkspaces(user);
      const callsForFifty = findMany.mock.calls.length;

      expect(callsForOne).toBe(1);
      expect(callsForFifty).toBe(1);
    });

    it('emits modelsCount, plantsCount and datasetsCount from the relation counts', async () => {
      const { findMany } = prisma.workspace;
      findMany.mockResolvedValue([makeWorkspace(1)]);

      const res = await service.getAllWorkspaces(user);
      const ws = res.data[0];

      expect(ws.modelsCount).toBe(3);
      expect(ws.plantsCount).toBe(4);
      expect(ws.datasetsCount).toBe(5);
      // _count stays on the payload: admin/dashboard/dashboard-content.tsx
      // reads `w._count?.models`.
      expect(ws._count.models).toBe(3);
    });

    it('reports a genuine zero as 0, not as a missing count', async () => {
      const { findMany } = prisma.workspace;
      findMany.mockResolvedValue([
        {
          ...makeWorkspace(1),
          _count: { members: 1, models: 0, plans: 0, datasets: 0 },
        },
      ]);

      const ws = (await service.getAllWorkspaces(user)).data[0];

      expect(ws.modelsCount).toBe(0);
      expect(ws.plantsCount).toBe(0);
      expect(ws.datasetsCount).toBe(0);
    });

    it('scopes the query to the workspace, not to the caller', async () => {
      const { findMany } = prisma.workspace;
      findMany.mockResolvedValue([]);

      await service.getAllWorkspaces(user);

      const [args] = findMany.mock.calls[0];
      const where = args.where;
      // A shared workspace must be reachable via membership, and no count may
      // be narrowed by createdById — see DS-LAKE-013 deferred[1].
      expect(where.OR).toEqual([
        { ownerId: 'u1' },
        { members: { some: { userId: 'u1' } } },
      ]);
      expect(JSON.stringify(args)).not.toContain('createdById');
    });
  });
});
