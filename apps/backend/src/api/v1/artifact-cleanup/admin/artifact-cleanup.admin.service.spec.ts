import { Logger } from '@nestjs/common';
import { ArtifactCleanupAdminService } from './artifact-cleanup.admin.service';
import { postToPython } from '@/lib/python-client';
import { env } from '@/config/env.config';

jest.mock('@/lib/python-client', () => ({
  postToPython: jest.fn(),
  PYTHON_TIMEOUT: { test: 1, metadata: 2, fetch: 3, preprocess: 4 },
}));

jest.mock('@/config/env.config', () => ({
  env: {
    CLEANUP_DRAFT_RECOVERY_HOURS: 168,
    CLEANUP_INTERMEDIATE_RETENTION_HOURS: 168,
    CLEANUP_ACTIVE_EMPTY_MINUTES: 15,
    CLEANUP_ACTIVE_IDLE_HOURS: 6,
    // 0 by default so constructing the service in a test never starts a
    // real timer; DS-LAKE-014's own scheduling tests override this per case.
    CLEANUP_SWEEP_INTERVAL_MS: 0,
  },
}));

const post = postToPython as jest.MockedFunction<typeof postToPython>;

const NOW = new Date('2026-08-12T00:00:00.000Z');
const OLD = new Date('2026-08-01T00:00:00.000Z'); // > 168h before NOW (draft.updatedAt)

/**
 * DS-LAKE-009B-T03/T06/T09: orchestration around the (separately, exhaustively
 * unit-tested — see lib/artifact-cleanup-eligibility.spec.ts) eligibility
 * predicate. What matters HERE is the plumbing: what gets fetched, what gets
 * called in what order, and that one failure never poisons the rest of a run.
 */

interface ArtifactRow {
  id: string;
  type: 'BRONZE' | 'SILVER' | 'GOLD' | 'FINAL' | 'EXPORT';
  draftId: string | null;
  objectKey: string;
  parentArtifactId?: string | null;
  /**
   * DS-LAKE-014-T05: a real `bigint`, matching what Prisma + `@prisma/
   * adapter-pg` actually returns for an `int8` column (live-confirmed
   * against real Postgres — not a `string`/`number` the driver could hand
   * back instead). Defaults to `0n` so every pre-existing test, which never
   * cared about byte counts, is unaffected.
   */
  sizeBytes?: bigint;
  /** DS-LAKE-021-T04: only EXPORT's eligibility branch reads this — it has
   * no draftId to measure a window from. Defaults to `OLD` so every
   * pre-existing (non-EXPORT) test, which never cared, is unaffected. */
  createdAt?: Date;
}

function buildPrismaMock(options: {
  artifacts: ArtifactRow[];
  drafts: Array<{ id: string; status: string; updatedAt: Date }>;
  liveVersions: Array<{ artifactId: string | null }>;
  activeJobs?: Array<{
    sourceArtifactId: string | null;
    resultArtifactId: string | null;
  }>;
}) {
  const byId = new Map(options.artifacts.map((a) => [a.id, a]));
  return {
    datasetArtifact: {
      findMany: jest.fn().mockResolvedValue(
        options.artifacts
          .filter((a) => a.type !== 'FINAL')
          .map(({ id, type, draftId, objectKey, sizeBytes, createdAt }) => ({
            id,
            type,
            draftId,
            objectKey,
            sizeBytes: sizeBytes ?? 0n,
            createdAt: createdAt ?? OLD,
          })),
      ),
      findUnique: jest.fn().mockImplementation(({ where: { id } }) => {
        const row = byId.get(id);
        return Promise.resolve(
          row ? { parentArtifactId: row.parentArtifactId ?? null } : null,
        );
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    datasetDraft: {
      findMany: jest.fn().mockResolvedValue(options.drafts),
      // DS-LAKE-014-T02: the draft-level auto-abandon pass. Defaults to "no
      // empty ACTIVE drafts found" so every pre-existing test in this file
      // — none of which seed one — is unaffected by run() now calling these.
      count: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    datasetVersion: {
      findMany: jest.fn().mockResolvedValue(options.liveVersions),
    },
    preprocessingJob: {
      findMany: jest.fn().mockResolvedValue(options.activeJobs ?? []),
    },
  };
}

function makeService(prisma: ReturnType<typeof buildPrismaMock>) {
  return new ArtifactCleanupAdminService(
    prisma as unknown as ConstructorParameters<
      typeof ArtifactCleanupAdminService
    >[0],
  );
}

describe('ArtifactCleanupAdminService', () => {
  beforeEach(() => {
    post.mockReset();
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('scans only non-FINAL, not-yet-reclaimed artifacts', async () => {
    const prisma = buildPrismaMock({
      artifacts: [],
      drafts: [],
      liveVersions: [],
    });
    const service = makeService(prisma);

    await service.run({ dryRun: true });

    expect(prisma.datasetArtifact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { type: { not: 'FINAL' }, objectReclaimedAt: null },
      }),
    );
  });

  it('dry run previews eligible artifacts without calling Python or writing the DB', async () => {
    const prisma = buildPrismaMock({
      artifacts: [
        {
          id: 'silver-1',
          type: 'SILVER',
          draftId: 'draft-1',
          objectKey: 'ds-1/artifacts/silver-1/data.parquet',
        },
      ],
      drafts: [{ id: 'draft-1', status: 'SAVED', updatedAt: OLD }],
      liveVersions: [],
    });
    const service = makeService(prisma);

    const result = await service.run({ dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.eligible).toBe(1);
    expect(result.reclaimed).toBe(0);
    expect(result.artifacts).toEqual([
      {
        id: 'silver-1',
        objectKey: 'ds-1/artifacts/silver-1/data.parquet',
        type: 'SILVER',
      },
    ]);
    expect(post).not.toHaveBeenCalled();
    expect(prisma.datasetArtifact.update).not.toHaveBeenCalled();
  });

  it('regression: eligibility is measured from Save time, not from a wizard-old artifact', async () => {
    // The draft was JUST saved (1h ago); the artifact itself may be far
    // older than the retention window from the wizard iterating for days
    // beforehand. Only draft.updatedAt may gate eligibility.
    const prisma = buildPrismaMock({
      artifacts: [
        {
          id: 'silver-1',
          type: 'SILVER',
          draftId: 'draft-1',
          objectKey: 'ds-1/artifacts/silver-1/data.parquet',
        },
      ],
      drafts: [
        {
          id: 'draft-1',
          status: 'SAVED',
          updatedAt: new Date('2026-08-11T23:00:00.000Z'),
        },
      ],
      liveVersions: [],
    });
    const service = makeService(prisma);

    const result = await service.run({ dryRun: true });

    expect(result.eligible).toBe(0);
    expect(result.artifacts).toEqual([]);
  });

  it('a live run reclaims via Python THEN stamps objectReclaimedAt', async () => {
    post.mockResolvedValue({
      prefix: 'ds-1/artifacts/silver-1/',
      deleted: 3,
    });
    const prisma = buildPrismaMock({
      artifacts: [
        {
          id: 'silver-1',
          type: 'SILVER',
          draftId: 'draft-1',
          objectKey: 'ds-1/artifacts/silver-1/data.parquet',
        },
      ],
      drafts: [{ id: 'draft-1', status: 'SAVED', updatedAt: OLD }],
      liveVersions: [],
    });
    const service = makeService(prisma);

    const result = await service.run({ dryRun: false });

    expect(post).toHaveBeenCalledWith(
      '/v1/preprocess/artifacts/reclaim',
      { object_key: 'ds-1/artifacts/silver-1/data.parquet' },
      expect.any(Number),
    );
    expect(prisma.datasetArtifact.update).toHaveBeenCalledWith({
      where: { id: 'silver-1' },
      data: { objectReclaimedAt: expect.any(Date) },
    });
    expect(result.reclaimed).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.artifacts[0]).toEqual(
      expect.objectContaining({ id: 'silver-1', deletedObjects: 3 }),
    );

    // Order: the Python call happened before the stamp.
    const postOrder = post.mock.invocationCallOrder[0];
    const updateOrder =
      prisma.datasetArtifact.update.mock.invocationCallOrder[0];
    expect(postOrder).toBeLessThan(updateOrder);
  });

  it('DS-LAKE-021-T04: a live run reclaims an EXPORT artifact via the same sweep, no draft involved', async () => {
    // EXPORT belongs to a SAVED dataset (draftId: null, no draft row at
    // all) and now owns its own artifact-id-keyed prefix — this is the
    // plan's original Task 5, made meaningful now that reclaim actually
    // works for EXPORT instead of always skipping it as no_draft.
    post.mockResolvedValue({
      prefix: 'ds-1/artifacts/export-1/',
      deleted: 1,
    });
    const prisma = buildPrismaMock({
      artifacts: [
        {
          id: 'export-1',
          type: 'EXPORT',
          draftId: null,
          objectKey: 'ds-1/artifacts/export-1/export.csv',
          createdAt: OLD,
        },
      ],
      drafts: [],
      liveVersions: [],
    });
    const service = makeService(prisma);

    const result = await service.run({ dryRun: false });

    expect(post).toHaveBeenCalledWith(
      '/v1/preprocess/artifacts/reclaim',
      { object_key: 'ds-1/artifacts/export-1/export.csv' },
      expect.any(Number),
    );
    expect(prisma.datasetArtifact.update).toHaveBeenCalledWith({
      where: { id: 'export-1' },
      data: { objectReclaimedAt: expect.any(Date) },
    });
    expect(result.reclaimed).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.scanned).toBe(1);
  });

  it('DS-LAKE-014-T05: bytesReclaimed sums real bigint sizeBytes across multiple reclaimed artifacts (a zero that cannot fail proves nothing)', async () => {
    post.mockResolvedValue({ prefix: 'x/', deleted: 1 });
    const prisma = buildPrismaMock({
      artifacts: [
        {
          id: 'silver-1',
          type: 'SILVER',
          draftId: 'draft-1',
          objectKey: 'ds-1/artifacts/silver-1/data.parquet',
          sizeBytes: 205_760n, // the exact live-observed value, not a round number
        },
        {
          id: 'silver-2',
          type: 'SILVER',
          draftId: 'draft-1',
          objectKey: 'ds-1/artifacts/silver-2/data.parquet',
          sizeBytes: 1_024n,
        },
      ],
      drafts: [{ id: 'draft-1', status: 'SAVED', updatedAt: OLD }],
      liveVersions: [],
    });
    const service = makeService(prisma);

    const result = await service.run({ dryRun: false });

    expect(result.reclaimed).toBe(2);
    expect(result.bytesReclaimed).toBe('206784'); // 205_760 + 1_024, as a string
  });

  it('one failed reclaim does not abort the rest of the batch', async () => {
    post.mockImplementation((_path, body) => {
      const b = body as { object_key: string };
      if (b.object_key.includes('silver-1')) {
        return Promise.reject(new Error('Data connector error (502).'));
      }
      return Promise.resolve({ prefix: 'x/', deleted: 1 });
    });
    const prisma = buildPrismaMock({
      artifacts: [
        {
          id: 'silver-1',
          type: 'SILVER',
          draftId: 'draft-1',
          objectKey: 'ds-1/artifacts/silver-1/data.parquet',
        },
        {
          id: 'silver-2',
          type: 'SILVER',
          draftId: 'draft-1',
          objectKey: 'ds-1/artifacts/silver-2/data.parquet',
        },
      ],
      drafts: [{ id: 'draft-1', status: 'SAVED', updatedAt: OLD }],
      liveVersions: [],
    });
    const service = makeService(prisma);

    const result = await service.run({ dryRun: false });

    expect(result.reclaimed).toBe(1);
    expect(result.failed).toBe(1);
    expect(prisma.datasetArtifact.update).toHaveBeenCalledTimes(1);
    expect(prisma.datasetArtifact.update).toHaveBeenCalledWith({
      where: { id: 'silver-2' },
      data: { objectReclaimedAt: expect.any(Date) },
    });
    const failedResult = result.artifacts.find((a) => a.id === 'silver-1');
    expect(failedResult?.error).toContain('502');
    // The Python call never succeeded for silver-1, so nothing was deleted
    // — unlike the stamp-retry-exhausted case below, this must NOT report
    // deletedObjects (that would falsely imply bytes are gone).
    expect(failedResult?.deletedObjects).toBeUndefined();
  });

  it('retries the stamp once when Python succeeds but the DB write fails, and recovers', async () => {
    post.mockResolvedValue({ prefix: 'ds-1/artifacts/silver-1/', deleted: 2 });
    const prisma = buildPrismaMock({
      artifacts: [
        {
          id: 'silver-1',
          type: 'SILVER',
          draftId: 'draft-1',
          objectKey: 'ds-1/artifacts/silver-1/data.parquet',
        },
      ],
      drafts: [{ id: 'draft-1', status: 'SAVED', updatedAt: OLD }],
      liveVersions: [],
    });
    prisma.datasetArtifact.update
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce({});
    const service = makeService(prisma);

    const result = await service.run({ dryRun: false });

    expect(prisma.datasetArtifact.update).toHaveBeenCalledTimes(2);
    expect(result.reclaimed).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.artifacts[0]).toEqual(
      expect.objectContaining({ id: 'silver-1', deletedObjects: 2 }),
    );
  });

  it('reports deletedObjects even when both stamp attempts fail — bytes are gone regardless', async () => {
    post.mockResolvedValue({ prefix: 'ds-1/artifacts/silver-1/', deleted: 2 });
    const prisma = buildPrismaMock({
      artifacts: [
        {
          id: 'silver-1',
          type: 'SILVER',
          draftId: 'draft-1',
          objectKey: 'ds-1/artifacts/silver-1/data.parquet',
        },
      ],
      drafts: [{ id: 'draft-1', status: 'SAVED', updatedAt: OLD }],
      liveVersions: [],
    });
    prisma.datasetArtifact.update.mockRejectedValue(new Error('db is down'));
    const service = makeService(prisma);

    const result = await service.run({ dryRun: false });

    expect(prisma.datasetArtifact.update).toHaveBeenCalledTimes(2);
    expect(result.reclaimed).toBe(0);
    expect(result.failed).toBe(1);
    // Bytes ARE gone (Python confirmed it) even though the row could not be
    // stamped — the result must say so, so an operator/log reader knows the
    // row currently understates reality rather than assuming nothing happened.
    expect(result.artifacts[0]).toEqual(
      expect.objectContaining({
        id: 'silver-1',
        deletedObjects: 2,
        error: expect.stringContaining('db is down'),
      }),
    );
  });

  it('never reclaims a BRONZE reachable from a non-ARCHIVED version, even if old', async () => {
    const prisma = buildPrismaMock({
      artifacts: [
        {
          id: 'bronze-1',
          type: 'BRONZE',
          draftId: 'draft-1',
          objectKey: 'ds-1/artifacts/bronze-1/data.parquet',
          parentArtifactId: null,
        },
      ],
      drafts: [{ id: 'draft-1', status: 'SAVED', updatedAt: OLD }],
      // FINAL artifact (final-1) has BRONZE (bronze-1) as its parent — a
      // live (non-ARCHIVED) version references final-1.
      liveVersions: [{ artifactId: 'final-1' }],
    });
    // Extend findUnique to resolve final-1 -> bronze-1 -> null.
    prisma.datasetArtifact.findUnique.mockImplementation(
      ({ where: { id } }: { where: { id: string } }) => {
        if (id === 'final-1') {
          return Promise.resolve({ parentArtifactId: 'bronze-1' });
        }
        if (id === 'bronze-1') {
          return Promise.resolve({ parentArtifactId: null });
        }
        return Promise.resolve(null);
      },
    );
    const service = makeService(prisma);

    const result = await service.run({ dryRun: true });

    expect(result.eligible).toBe(0);
    expect(result.artifacts).toEqual([]);
  });

  it('refuses an artifact referenced by an active (QUEUED/RUNNING) job (V02)', async () => {
    const prisma = buildPrismaMock({
      artifacts: [
        {
          id: 'silver-1',
          type: 'SILVER',
          draftId: 'draft-1',
          objectKey: 'ds-1/artifacts/silver-1/data.parquet',
        },
        {
          id: 'silver-2',
          type: 'SILVER',
          draftId: 'draft-1',
          objectKey: 'ds-1/artifacts/silver-2/data.parquet',
        },
      ],
      drafts: [{ id: 'draft-1', status: 'SAVED', updatedAt: OLD }],
      liveVersions: [],
      // silver-1 is a RUNNING job's sourceArtifact — otherwise old enough
      // and lineage-free, so this is the ONLY thing keeping it ineligible.
      activeJobs: [{ sourceArtifactId: 'silver-1', resultArtifactId: null }],
    });
    const service = makeService(prisma);

    const result = await service.run({ dryRun: true });

    const ids = result.artifacts.map((a) => a.id);
    expect(ids).toEqual(['silver-2']);
    expect(ids).not.toContain('silver-1');
  });

  it('DS-LAKE-014-T05: every run satisfies examined == reclaimed + failed + sum(skipped)', async () => {
    post.mockResolvedValue({ prefix: 'x/', deleted: 1 });
    const prisma = buildPrismaMock({
      artifacts: [
        {
          id: 'bronze-pinned',
          type: 'BRONZE',
          draftId: 'draft-1',
          objectKey: 'ds-1/artifacts/bronze-pinned/data.parquet',
          parentArtifactId: null,
        },
        {
          id: 'silver-1',
          type: 'SILVER',
          draftId: 'draft-1',
          objectKey: 'ds-1/artifacts/silver-1/data.parquet',
        },
        {
          id: 'silver-active-job',
          type: 'SILVER',
          draftId: 'draft-1',
          objectKey: 'ds-1/artifacts/silver-active-job/data.parquet',
        },
      ],
      drafts: [{ id: 'draft-1', status: 'SAVED', updatedAt: OLD }],
      liveVersions: [{ artifactId: 'final-1' }],
      activeJobs: [
        { sourceArtifactId: 'silver-active-job', resultArtifactId: null },
      ],
    });
    prisma.datasetArtifact.findUnique.mockImplementation(
      ({ where: { id } }: { where: { id: string } }) => {
        if (id === 'final-1') {
          return Promise.resolve({ parentArtifactId: 'bronze-pinned' });
        }
        if (id === 'bronze-pinned') {
          return Promise.resolve({ parentArtifactId: null });
        }
        return Promise.resolve(null);
      },
    );
    const service = makeService(prisma);

    const result = await service.run({ dryRun: false });

    // bronze-pinned -> lineage_pinned; silver-active-job -> active_job;
    // silver-1 -> reclaimed. Nothing left unattributed.
    expect(result.scanned).toBe(3);
    expect(result.reclaimed).toBe(1);
    const totalSkipped = Object.values(result.skipped).reduce(
      (sum, n) => sum + n,
      0,
    );
    expect(totalSkipped).toBe(2);
    expect(result.reclaimed + result.failed + totalSkipped).toBe(
      result.scanned,
    );
  });
});

describe('DS-LAKE-014-T02: auto-abandon empty ACTIVE drafts', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('dryRun previews via count, without writing', async () => {
    const prisma = buildPrismaMock({
      artifacts: [],
      drafts: [],
      liveVersions: [],
    });
    prisma.datasetDraft.count.mockResolvedValue(2);
    const service = makeService(prisma);

    const result = await service.run({ dryRun: true });

    expect(prisma.datasetDraft.count).toHaveBeenCalledWith({
      where: {
        status: 'ACTIVE',
        updatedAt: { lt: expect.any(Date) },
        artifacts: { none: { objectReclaimedAt: null } },
      },
    });
    expect(prisma.datasetDraft.updateMany).not.toHaveBeenCalled();
    expect(result.autoAbandoned).toBe(2);
  });

  it('a live run flips qualifying drafts to ABANDONED via updateMany, never count', async () => {
    const prisma = buildPrismaMock({
      artifacts: [],
      drafts: [],
      liveVersions: [],
    });
    prisma.datasetDraft.updateMany.mockResolvedValue({ count: 3 });
    const service = makeService(prisma);

    const result = await service.run({ dryRun: false });

    expect(prisma.datasetDraft.updateMany).toHaveBeenCalledWith({
      where: {
        status: 'ACTIVE',
        updatedAt: { lt: expect.any(Date) },
        artifacts: { none: { objectReclaimedAt: null } },
      },
      data: { status: 'ABANDONED' },
    });
    expect(prisma.datasetDraft.count).not.toHaveBeenCalled();
    expect(result.autoAbandoned).toBe(3);
  });

  it('the cutoff is exactly CLEANUP_ACTIVE_EMPTY_MINUTES before now', async () => {
    const prisma = buildPrismaMock({
      artifacts: [],
      drafts: [],
      liveVersions: [],
    });
    const service = makeService(prisma);

    await service.run({ dryRun: true });

    const call = prisma.datasetDraft.count.mock.calls[0][0] as {
      where: { updatedAt: { lt: Date } };
    };
    const cutoff = call.where.updatedAt.lt;
    expect(NOW.getTime() - cutoff.getTime()).toBe(
      env.CLEANUP_ACTIVE_EMPTY_MINUTES * 60_000,
    );
  });
});

describe('DS-LAKE-014-T03: periodic sweep scheduling', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    env.CLEANUP_SWEEP_INTERVAL_MS = 0; // restore the mocked default
    jest.useRealTimers();
  });

  it('does not schedule a timer when CLEANUP_SWEEP_INTERVAL_MS <= 0', () => {
    env.CLEANUP_SWEEP_INTERVAL_MS = 0;
    const prisma = buildPrismaMock({
      artifacts: [],
      drafts: [],
      liveVersions: [],
    });
    const service = makeService(prisma);

    service.onModuleInit();

    expect(jest.getTimerCount()).toBe(0);
  });

  it('schedules exactly one timer when CLEANUP_SWEEP_INTERVAL_MS > 0, and onApplicationShutdown clears it', () => {
    env.CLEANUP_SWEEP_INTERVAL_MS = 60_000;
    const prisma = buildPrismaMock({
      artifacts: [],
      drafts: [],
      liveVersions: [],
    });
    const service = makeService(prisma);

    service.onModuleInit();
    expect(jest.getTimerCount()).toBe(1);

    service.onApplicationShutdown();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('the interval calls run({ dryRun: false, trigger: "interval" }) on its own, with no admin endpoint involved', async () => {
    env.CLEANUP_SWEEP_INTERVAL_MS = 60_000;
    post.mockResolvedValue({ prefix: 'ds-1/artifacts/silver-1/', deleted: 1 });
    const prisma = buildPrismaMock({
      artifacts: [
        {
          id: 'silver-1',
          type: 'SILVER',
          draftId: 'draft-1',
          objectKey: 'ds-1/artifacts/silver-1/data.parquet',
        },
      ],
      drafts: [{ id: 'draft-1', status: 'SAVED', updatedAt: OLD }],
      liveVersions: [],
    });
    const service = makeService(prisma);
    const runSpy = jest.spyOn(service, 'run');

    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(60_000);

    expect(runSpy).toHaveBeenCalledWith({ dryRun: false, trigger: 'interval' });
    expect(prisma.datasetArtifact.update).toHaveBeenCalledWith({
      where: { id: 'silver-1' },
      data: { objectReclaimedAt: expect.any(Date) },
    });

    service.onApplicationShutdown();
  });

  it('a failing run() inside the interval is logged and swallowed — the app never crashes, the timer survives, and the NEXT tick actually runs (not just stays scheduled)', async () => {
    env.CLEANUP_SWEEP_INTERVAL_MS = 60_000;
    const prisma = buildPrismaMock({
      artifacts: [],
      drafts: [],
      liveVersions: [],
    });
    // Only the first call rejects — buildPrismaMock's default resolves
    // normally after that, so the second tick can genuinely succeed.
    prisma.datasetArtifact.findMany.mockRejectedValueOnce(
      new Error('db exploded'),
    );
    const service = makeService(prisma);
    const runSpy = jest.spyOn(service, 'run');
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    service.onModuleInit();
    await expect(jest.advanceTimersByTimeAsync(60_000)).resolves.not.toThrow();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Cleanup sweep failed'),
    );
    expect(jest.getTimerCount()).toBe(1); // one throwing tick does not unschedule the interval
    expect(runSpy).toHaveBeenCalledTimes(1);
    await expect(runSpy.mock.results[0].value).rejects.toThrow('db exploded');

    // The acceptance criterion is "does not PREVENT the next tick" — proven
    // by the next tick actually completing, not merely by the timer still
    // being registered.
    await expect(jest.advanceTimersByTimeAsync(60_000)).resolves.not.toThrow();
    expect(runSpy).toHaveBeenCalledTimes(2);
    await expect(runSpy.mock.results[1].value).resolves.toEqual(
      expect.objectContaining({ scanned: 0, reclaimed: 0, failed: 0 }),
    );

    warnSpy.mockRestore();
    service.onApplicationShutdown();
  });
});
