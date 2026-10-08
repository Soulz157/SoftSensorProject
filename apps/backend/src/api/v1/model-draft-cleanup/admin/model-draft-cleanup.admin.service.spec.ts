import { Logger } from '@nestjs/common';
import { ModelDraftCleanupAdminService } from './model-draft-cleanup.admin.service';
import { postToPython } from '@/lib/python-client';
import { env } from '@/config/env.config';

jest.mock('@/lib/python-client', () => ({
  postToPython: jest.fn(),
  PYTHON_TIMEOUT: { test: 1, metadata: 2, fetch: 3, preprocess: 4 },
}));

jest.mock('@/config/env.config', () => ({
  env: {
    MODEL_DRAFT_EMPTY_IDLE_HOURS: 24,
    MODEL_DRAFT_RUNS_IDLE_HOURS: 168,
    MODEL_DRAFT_ABANDONED_RECOVERY_HOURS: 168,
    // 0 by default so constructing the service in a test never starts a
    // real timer; the scheduling tests below override this per case.
    MODEL_DRAFT_SWEEP_INTERVAL_MS: 0,
  },
}));

const post = postToPython as jest.MockedFunction<typeof postToPython>;

const NOW = new Date('2026-08-31T00:00:00.000Z');
const OLD = new Date('2026-08-01T00:00:00.000Z'); // > 168h before NOW

/**
 * MODEL-FLOW-011: orchestration around the (separately, exhaustively
 * unit-tested — see lib/model-draft-cleanup-eligibility.spec.ts) eligibility
 * predicate. What matters HERE is the plumbing: what gets fetched, what gets
 * called in what order, and that one failure never poisons the rest of a run.
 */

interface DraftRow {
  id: string;
  status: 'ACTIVE' | 'TRAINED' | 'SAVED' | 'ABANDONED';
  updatedAt: Date;
  objectsReclaimedAt: Date | null;
  trainingRuns: Array<{
    id: string;
    status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';
    modelId: string | null;
  }>;
  candidateJobs: Array<{ status: string }>;
}

function buildPrismaMock(drafts: DraftRow[]) {
  return {
    modelDraft: {
      findMany: jest.fn().mockImplementation(() =>
        Promise.resolve(
          drafts.map((d) => ({
            ...d,
            candidateJobs: d.candidateJobs.filter((j) =>
              ['QUEUED', 'RUNNING'].includes(j.status),
            ),
          })),
        ),
      ),
      update: jest.fn().mockResolvedValue({}),
    },
  };
}

function makeService(prisma: ReturnType<typeof buildPrismaMock>) {
  return new ModelDraftCleanupAdminService(
    prisma as unknown as ConstructorParameters<
      typeof ModelDraftCleanupAdminService
    >[0],
  );
}

function draft(overrides: Partial<DraftRow> & { id: string }): DraftRow {
  return {
    status: 'ACTIVE',
    updatedAt: NOW,
    objectsReclaimedAt: null,
    trainingRuns: [],
    candidateJobs: [],
    ...overrides,
  };
}

describe('ModelDraftCleanupAdminService', () => {
  beforeEach(() => {
    post.mockReset();
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('queries only ACTIVE drafts and ABANDONED drafts with unreclaimed bytes', async () => {
    const prisma = buildPrismaMock([]);
    const service = makeService(prisma);

    await service.run({ dryRun: true });

    expect(prisma.modelDraft.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { status: 'ACTIVE' },
            { status: 'ABANDONED', objectsReclaimedAt: null },
          ],
        },
      }),
    );
  });

  it('dry run previews eligible drafts without calling Python or writing the DB', async () => {
    const prisma = buildPrismaMock([draft({ id: 'd1', updatedAt: OLD })]);
    const service = makeService(prisma);

    const result = await service.run({ dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.eligible).toBe(1);
    expect(result.reclaimed).toBe(0);
    expect(result.drafts).toEqual([{ draftId: 'd1', tier: 'active_empty' }]);
    expect(post).not.toHaveBeenCalled();
    expect(prisma.modelDraft.update).not.toHaveBeenCalled();
  });

  it('a live run reclaims via Python THEN stamps status/objectsReclaimedAt', async () => {
    post.mockResolvedValue({ prefix: 'drafts/d1/runs/', deleted: 3 });
    const prisma = buildPrismaMock([draft({ id: 'd1', updatedAt: OLD })]);
    const service = makeService(prisma);

    const result = await service.run({ dryRun: false });

    expect(post).toHaveBeenCalledWith(
      '/v1/preprocess/models/runs/reclaim',
      { draft_id: 'd1', run_id: null },
      expect.any(Number),
    );
    expect(prisma.modelDraft.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { status: 'ABANDONED', objectsReclaimedAt: expect.any(Date) },
    });
    // The update call must come AFTER the Python call — verified by call
    // order, not merely by both having been called.
    const postOrder = post.mock.invocationCallOrder[0];
    const updateOrder = prisma.modelDraft.update.mock.invocationCallOrder[0];
    expect(postOrder).toBeLessThan(updateOrder);

    expect(result.reclaimed).toBe(1);
    expect(result.drafts).toEqual([
      { draftId: 'd1', tier: 'active_empty', deletedObjects: 3 },
    ]);
  });

  it('a failed Python call is recorded and does NOT stamp the row', async () => {
    post.mockRejectedValue(new Error('network exploded'));
    const prisma = buildPrismaMock([draft({ id: 'd1', updatedAt: OLD })]);
    const service = makeService(prisma);

    const result = await service.run({ dryRun: false });

    expect(prisma.modelDraft.update).not.toHaveBeenCalled();
    expect(result.failed).toBe(1);
    expect(result.reclaimed).toBe(0);
    expect(result.drafts).toEqual([
      { draftId: 'd1', tier: 'active_empty', error: 'network exploded' },
    ]);
  });

  it('subtree call when no run on the draft is adopted', async () => {
    post.mockResolvedValue({ prefix: 'drafts/d1/runs/', deleted: 2 });
    const prisma = buildPrismaMock([
      draft({
        id: 'd1',
        updatedAt: new Date(NOW.getTime() - 169 * 60 * 60 * 1000),
        trainingRuns: [
          { id: 'r1', status: 'SUCCEEDED', modelId: null },
          { id: 'r2', status: 'FAILED', modelId: null },
        ],
      }),
    ]);
    const service = makeService(prisma);

    await service.run({ dryRun: false });

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(
      '/v1/preprocess/models/runs/reclaim',
      { draft_id: 'd1', run_id: null },
      expect.any(Number),
    );
  });

  it('MODEL-FLOW-011-T05: an adopted run is never named — only its unadopted sibling, one call', async () => {
    post.mockResolvedValue({ prefix: 'drafts/d1/runs/unadopted/', deleted: 1 });
    const prisma = buildPrismaMock([
      draft({
        id: 'd1',
        updatedAt: new Date(NOW.getTime() - 169 * 60 * 60 * 1000),
        trainingRuns: [
          { id: 'unadopted', status: 'SUCCEEDED', modelId: null },
          { id: 'adopted', status: 'SUCCEEDED', modelId: 'model-1' },
        ],
      }),
    ]);
    const service = makeService(prisma);

    await service.run({ dryRun: false });

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(
      '/v1/preprocess/models/runs/reclaim',
      { draft_id: 'd1', run_id: 'unadopted' },
      expect.any(Number),
    );
    // The adopted run's id must never appear in any call this run makes.
    expect(post).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ run_id: 'adopted' }),
      expect.anything(),
    );
  });

  it('a draft owning runs is not reclaimed inside the runs-idle window', async () => {
    const prisma = buildPrismaMock([
      draft({
        id: 'd1',
        updatedAt: new Date(NOW.getTime() - 48 * 60 * 60 * 1000),
        trainingRuns: [{ id: 'r1', status: 'SUCCEEDED', modelId: null }],
      }),
    ]);
    const service = makeService(prisma);

    const result = await service.run({ dryRun: true });

    expect(result.eligible).toBe(0);
    expect(result.skipped.inside_window).toBe(1);
  });

  it('never reclaims a TRAINED draft', async () => {
    const prisma = buildPrismaMock([
      draft({ id: 'd1', status: 'TRAINED', updatedAt: OLD }),
    ]);
    const service = makeService(prisma);

    const result = await service.run({ dryRun: true });

    expect(result.eligible).toBe(0);
    expect(result.skipped.status_not_eligible).toBe(1);
  });

  describe('MODEL-FLOW-011-T03: periodic sweep scheduling', () => {
    it('does not schedule a timer when the interval is <= 0', () => {
      env.MODEL_DRAFT_SWEEP_INTERVAL_MS = 0;
      const service = makeService(buildPrismaMock([]));

      service.onModuleInit();

      expect(jest.getTimerCount()).toBe(0);
    });

    it('schedules exactly one timer, and shutdown clears it', () => {
      env.MODEL_DRAFT_SWEEP_INTERVAL_MS = 60_000;
      const service = makeService(buildPrismaMock([]));

      service.onModuleInit();
      expect(jest.getTimerCount()).toBe(1);

      service.onApplicationShutdown();
      expect(jest.getTimerCount()).toBe(0);

      env.MODEL_DRAFT_SWEEP_INTERVAL_MS = 0; // restore the mocked default
    });

    it('a tick calls run({dryRun:false, trigger:"interval"}) and does real work', async () => {
      env.MODEL_DRAFT_SWEEP_INTERVAL_MS = 60_000;
      post.mockResolvedValue({ prefix: 'drafts/d1/runs/', deleted: 1 });
      const prisma = buildPrismaMock([draft({ id: 'd1', updatedAt: OLD })]);
      const service = makeService(prisma);
      const runSpy = jest.spyOn(service, 'run');

      service.onModuleInit();
      await jest.advanceTimersByTimeAsync(60_000);

      expect(runSpy).toHaveBeenCalledWith({
        dryRun: false,
        trigger: 'interval',
      });
      expect(prisma.modelDraft.update).toHaveBeenCalledWith({
        where: { id: 'd1' },
        data: { status: 'ABANDONED', objectsReclaimedAt: expect.any(Date) },
      });

      service.onApplicationShutdown();
      env.MODEL_DRAFT_SWEEP_INTERVAL_MS = 0;
    });

    it('a throwing tick is swallowed, logged, and the next tick still runs', async () => {
      env.MODEL_DRAFT_SWEEP_INTERVAL_MS = 60_000;
      const prisma = buildPrismaMock([]);
      prisma.modelDraft.findMany.mockRejectedValueOnce(
        new Error('db exploded'),
      );
      const service = makeService(prisma);
      const runSpy = jest.spyOn(service, 'run');
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      service.onModuleInit();
      await expect(
        jest.advanceTimersByTimeAsync(60_000),
      ).resolves.not.toThrow();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('ModelDraft cleanup sweep failed'),
      );
      expect(jest.getTimerCount()).toBe(1); // one throwing tick does not unschedule
      expect(runSpy).toHaveBeenCalledTimes(1);
      await expect(runSpy.mock.results[0].value).rejects.toThrow('db exploded');

      await expect(
        jest.advanceTimersByTimeAsync(60_000),
      ).resolves.not.toThrow();
      expect(runSpy).toHaveBeenCalledTimes(2);

      service.onApplicationShutdown();
      warnSpy.mockRestore();
      env.MODEL_DRAFT_SWEEP_INTERVAL_MS = 0;
    });
  });
});
