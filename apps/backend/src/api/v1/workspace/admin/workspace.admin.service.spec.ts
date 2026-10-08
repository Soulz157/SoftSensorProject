import { Test, TestingModule } from '@nestjs/testing';
import { WorkspaceAdminService } from './workspace.admin.service';
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

describe('WorkspaceAdminService', () => {
  let service: WorkspaceAdminService;
  let prisma: {
    workspace: { findMany: jest.Mock; count: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceAdminService,
        {
          provide: PrismaService,
          useValue: {
            workspace: {
              create: jest.fn(),
              findUnique: jest.fn(),
              findMany: jest.fn(),
              count: jest.fn(),
              update: jest.fn(),
            },
            $transaction: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<WorkspaceAdminService>(WorkspaceAdminService);
    prisma = module.get(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  const owner = { id: 'u1', firstName: 'A', lastName: 'B', email: 'a@b.c' };
  const node = (status: string) => ({ data: { status } });
  const workspaceRow = (over: Record<string, unknown> = {}) => ({
    id: 'w1',
    name: 'Mock A',
    color: 'blue',
    icon: 'box',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-02-01T00:00:00Z'),
    owner,
    _count: { models: 2, plans: 3, datasets: 4 },
    nodes: [node('normal')],
    ...over,
  });

  describe('listWorkspaces (MODEL-SERVE admin dashboard)', () => {
    it('returns real counts, updatedAt and the equipment roll-up per item', async () => {
      prisma.$transaction.mockResolvedValue([
        [
          workspaceRow(),
          workspaceRow({
            id: 'w2',
            name: 'Mock B',
            nodes: [node('alarm'), node('alarm'), node('warning')],
          }),
        ],
        2,
      ]);
      const res = await service.listWorkspaces({ page: 1, limit: 15 });
      const [a, b] = res.data.items;
      expect(a).toMatchObject({
        modelsCount: 2,
        plantsCount: 3,
        datasetsCount: 4,
        status: 'normal',
        alarmCount: 0,
      });
      expect(b).toMatchObject({
        status: 'alarm',
        alarmCount: 2,
        warningCount: 1,
        nodeCount: 3,
      });
      expect(a.updatedAt).toEqual(new Date('2026-02-01T00:00:00Z'));
      // The raw node payload is not leaked to the client.
      expect(a).not.toHaveProperty('nodes');
      expect(res.data.total).toBe(2);
    });

    it('keeps newest-first order with an id tiebreak so pages are stable', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);
      await service.listWorkspaces({ page: 2, limit: 15 });
      expect(prisma.workspace.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip: 15,
          take: 15,
        }),
      );
    });

    it('never lists soft-deleted workspaces, and applies the search', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);
      await service.listWorkspaces({ page: 1, limit: 15, search: 'abc' });
      expect(prisma.workspace.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            deletedAt: null,
            name: { contains: 'abc', mode: 'insensitive' },
          },
        }),
      );
    });

    it('does not leak fields outside the DTO', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);
      await service.listWorkspaces({ page: 1, limit: 15 });
      const calls = prisma.workspace.findMany.mock.calls as unknown[][];
      const arg = calls[0]?.[0] as { select?: Record<string, unknown> };
      expect(arg.select).toBeDefined();
      expect(arg.select).not.toHaveProperty('ownerId');
      expect(arg.select).not.toHaveProperty('deletedAt');
    });
  });

  describe('getSummary', () => {
    it('counts every workspace and sums models, unpaginated', async () => {
      prisma.workspace.findMany.mockResolvedValue([
        workspaceRow({ id: 'a', _count: { models: 2 } }),
        workspaceRow({ id: 'b', _count: { models: 5 } }),
      ]);
      const res = await service.getSummary();
      expect(res.data.total).toBe(2);
      expect(res.data.models).toBe(7);
      const calls = prisma.workspace.findMany.mock.calls as unknown[][];
      const arg = calls[0]?.[0] as { take?: number; where: unknown };
      expect(arg.take).toBeUndefined();
      expect(arg.where).toEqual({ deletedAt: null });
    });

    it('lists only alarm workspaces under attention, with their counts', async () => {
      prisma.workspace.findMany.mockResolvedValue([
        workspaceRow({ id: 'ok', nodes: [node('normal')] }),
        workspaceRow({ id: 'warn', nodes: [node('warning')] }),
        workspaceRow({ id: 'off', nodes: [node('offline')] }),
        workspaceRow({
          id: 'bad',
          name: 'Mock Bad',
          nodes: [node('alarm'), node('offline')],
        }),
      ]);
      const res = await service.getSummary();
      expect(res.data.attention).toEqual([
        {
          id: 'bad',
          name: 'Mock Bad',
          owner,
          status: 'alarm',
          alarmCount: 1,
          warningCount: 0,
          offlineCount: 1,
        },
      ]);
    });

    it('reports an empty platform as zeros, not an error', async () => {
      prisma.workspace.findMany.mockResolvedValue([]);
      const res = await service.getSummary();
      expect(res.data).toEqual({
        total: 0,
        models: 0,
        attentionTotal: 0,
        attention: [],
      });
    });

    it('caps the queue at the worst 10 but reports the true total', async () => {
      prisma.workspace.findMany.mockResolvedValue(
        Array.from({ length: 14 }, (_, i) =>
          workspaceRow({
            id: `w${i}`,
            name: `Mock ${String(i).padStart(2, '0')}`,
            // w13 has the most alarms; the rest have one each.
            nodes: Array.from({ length: i === 13 ? 3 : 1 }, () =>
              node('alarm'),
            ),
          }),
        ),
      );
      const res = await service.getSummary();
      expect(res.data.attentionTotal).toBe(14);
      expect(res.data.attention).toHaveLength(10);
      expect(res.data.attention[0]?.id).toBe('w13');
    });
  });
});
