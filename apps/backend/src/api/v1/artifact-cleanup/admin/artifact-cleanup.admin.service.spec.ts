import { ArtifactCleanupAdminService } from './artifact-cleanup.admin.service';
import { postToPython } from '@/lib/python-client';

jest.mock('@/lib/python-client', () => ({
  postToPython: jest.fn(),
  PYTHON_TIMEOUT: { test: 1, metadata: 2, fetch: 3, preprocess: 4 },
}));

jest.mock('@/config/env.config', () => ({
  env: {
    CLEANUP_DRAFT_RECOVERY_HOURS: 168,
    CLEANUP_INTERMEDIATE_RETENTION_HOURS: 168,
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
  type: 'BRONZE' | 'SILVER' | 'GOLD' | 'FINAL';
  draftId: string | null;
  objectKey: string;
  parentArtifactId?: string | null;
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
          .map(({ id, type, draftId, objectKey }) => ({
            id,
            type,
            draftId,
            objectKey,
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
});
