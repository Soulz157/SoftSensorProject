import { AppException } from '@softsensor/common';
import { postToPython } from '@/lib/python-client';
import { DatasetVersionAuthorizedService } from './dataset-version.authorized.service';
import type { PreprocessingJobService } from './preprocessing-job.service';

/**
 * DS-LAKE-009-T07. Covers the two methods this task materially changed —
 * neither had any prior test anywhere in the repo (confirmed: no
 * `dataset-version.authorized.service.spec.ts` existed before this file).
 *
 *   - `findArtifactSource` (private, exercised via `listRowsService`):
 *     the DatasetVersion-first branch was DELETED (the registry reshape
 *     dropped `objectKey` off DatasetVersion) — this proves the
 *     artifact-only lookup still resolves and still 404s correctly.
 *   - `listVersionsService`: the response shape changed (dropped fields
 *     replaced with the reshaped registry's own) and `sizeBytes` now needs
 *     a BigInt->Number cast to avoid a JSON.stringify crash.
 */

jest.mock('@/lib/python-client', () => ({
  postToPython: jest.fn(),
  postBinaryToPython: jest.fn(),
  PYTHON_TIMEOUT: { test: 1, metadata: 2, fetch: 3, preprocess: 4 },
}));

const post = postToPython as jest.MockedFunction<typeof postToPython>;

const USER: Auth.UserPayload = {
  id: 'user-1',
  role: 'MEMBER',
} as Auth.UserPayload;

const DATASET = { id: 'ds-1', workspaceId: 'ws-1' };

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    dataset: {
      findFirst: jest.fn().mockResolvedValue(DATASET),
    },
    datasetArtifact: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    datasetVersion: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    ...overrides,
  };
}

function makeService(prisma: ReturnType<typeof buildPrisma>) {
  const jobs = { start: jest.fn(), cancel: jest.fn() };
  const service = new DatasetVersionAuthorizedService(
    prisma as unknown as ConstructorParameters<
      typeof DatasetVersionAuthorizedService
    >[0],
    jobs as unknown as PreprocessingJobService,
  );
  return { service, jobs };
}

describe('DatasetVersionAuthorizedService — findArtifactSource (DS-LAKE-009-T07)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('resolves against DatasetArtifact only — the DatasetVersion branch was removed, not patched', async () => {
    post.mockResolvedValueOnce({
      source_key: 'ds-1/artifacts/artifact-1/data.parquet',
      total_row_count: 0,
      offset: 0,
      tags: [],
      filtered: false,
      start_time: null,
      end_time: null,
      rows: [],
    });
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst.mockResolvedValue({
      objectKey: 'ds-1/artifacts/artifact-1/data.parquet',
    });
    const { service } = makeService(prisma);

    await service.listRowsService(USER, 'ds-1', 'artifact-1', {
      offset: 0,
      limit: 100,
      format: 'json',
    } as never);

    // DatasetVersion is never even queried now — confirms the branch is
    // gone, not just unreachable.
    expect(prisma.datasetVersion.findFirst).not.toHaveBeenCalled();
    const [, body] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(body.source_key).toBe('ds-1/artifacts/artifact-1/data.parquet');
  });

  it('404s when neither an artifact nor (the now-irrelevant) a version exists', async () => {
    const prisma = buildPrisma();
    const { service } = makeService(prisma);

    await expect(
      service.listRowsService(USER, 'ds-1', 'ghost-id', {
        offset: 0,
        limit: 100,
        format: 'json',
      } as never),
    ).rejects.toThrow(AppException);

    expect(post).not.toHaveBeenCalled();
  });
});

describe('DatasetVersionAuthorizedService — listVersionsService (DS-LAKE-009-T07)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('maps the reshaped registry fields and safely casts a BigInt sizeBytes', async () => {
    const prisma = buildPrisma();
    prisma.datasetVersion.findMany.mockResolvedValue([
      {
        id: 'v-1',
        datasetId: 'ds-1',
        semanticVersion: '1.0.0',
        artifactId: 'final-1',
        versionNumber: 1,
        status: 'ACTIVE',
        qualityScore: 92.5,
        rowCount: 1000,
        columnCount: 12,
        featureCount: 5,
        missingPct: 1.2,
        sizeBytes: BigInt('9223372036854775'), // exceeds 32-bit Int on purpose
        durationMs: 4200,
        createdAt: new Date('2026-08-11T00:00:00Z'),
        createdBy: { firstName: 'Ada', lastName: 'Lovelace' },
      },
    ]);
    const { service } = makeService(prisma);

    const res = await service.listVersionsService(USER, 'ds-1');

    // The crux of the fix: this must not throw, and must not silently
    // truncate/stringify a raw bigint into the response.
    expect(() => JSON.stringify(res)).not.toThrow();
    expect(res.data[0]).toMatchObject({
      id: 'v-1',
      semanticVersion: '1.0.0',
      artifactId: 'final-1',
      status: 'ACTIVE',
      qualityScore: 92.5,
      featureCount: 5,
      sizeBytes: 9223372036854775,
      createdBy: 'Ada Lovelace',
    });
    // The dropped columns must not silently reappear under old names.
    expect(res.data[0]).not.toHaveProperty('stage');
    expect(res.data[0]).not.toHaveProperty('parentVersionId');
    expect(res.data[0]).not.toHaveProperty('operations');
  });
});
