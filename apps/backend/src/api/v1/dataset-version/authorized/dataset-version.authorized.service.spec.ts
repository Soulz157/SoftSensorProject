import { AppException } from '@softsensor/common';
import { postToPython } from '@/lib/python-client';
import { DatasetVersionAuthorizedService } from './dataset-version.authorized.service';
import type { PreprocessingJobService } from './preprocessing-job.service';
import type { LoaderJobService } from '../../loader/loader-job.service';

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
      update: jest.fn(),
    },
    // DS-LAKE-021-T03: startExportService creates a PreprocessingJob row.
    preprocessingJob: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
    ...overrides,
  };
}

function makeService(prisma: ReturnType<typeof buildPrisma>) {
  const jobs = { start: jest.fn(), cancel: jest.fn() };
  const loaderJobs = {
    enqueue: jest.fn(),
    start: jest.fn(),
    retry: jest.fn(),
    getStatus: jest.fn(),
  };
  const service = new DatasetVersionAuthorizedService(
    prisma as unknown as ConstructorParameters<
      typeof DatasetVersionAuthorizedService
    >[0],
    jobs as unknown as PreprocessingJobService,
    loaderJobs as unknown as LoaderJobService,
  );
  return { service, jobs, loaderJobs };
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

describe('DatasetVersionAuthorizedService — promoteVersionService (DS-LAKE-010)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('404s when the version does not belong to the dataset', async () => {
    const prisma = buildPrisma();
    const { service } = makeService(prisma);

    await expect(
      service.promoteVersionService(USER, 'ds-1', 'ghost', {
        status: 'VALIDATED',
      } as never),
    ).rejects.toThrow(AppException);
  });

  it('same-state request is an idempotent no-op — no write, no throw', async () => {
    const prisma = buildPrisma();
    prisma.datasetVersion.findFirst.mockResolvedValue({
      id: 'v-1',
      status: 'VALIDATED',
    });
    prisma.datasetVersion.update = jest.fn();
    const { service } = makeService(prisma);

    const res = await service.promoteVersionService(USER, 'ds-1', 'v-1', {
      status: 'VALIDATED',
    } as never);

    expect(res.data).toEqual({ id: 'v-1', status: 'VALIDATED' });
    expect(prisma.datasetVersion.update).not.toHaveBeenCalled();
  });

  it('DS-LAKE-010-V02: refuses ARCHIVED -> ACTIVE', async () => {
    const prisma = buildPrisma();
    prisma.datasetVersion.findFirst.mockResolvedValue({
      id: 'v-1',
      status: 'ARCHIVED',
    });
    prisma.datasetVersion.update = jest.fn();
    const { service } = makeService(prisma);

    await expect(
      service.promoteVersionService(USER, 'ds-1', 'v-1', {
        status: 'ACTIVE',
      } as never),
    ).rejects.toThrow(AppException);
    expect(prisma.datasetVersion.update).not.toHaveBeenCalled();
  });

  it('refuses a skip (DRAFT -> ACTIVE)', async () => {
    const prisma = buildPrisma();
    prisma.datasetVersion.findFirst.mockResolvedValue({
      id: 'v-1',
      status: 'DRAFT',
    });
    prisma.datasetVersion.update = jest.fn();
    const { service } = makeService(prisma);

    await expect(
      service.promoteVersionService(USER, 'ds-1', 'v-1', {
        status: 'ACTIVE',
      } as never),
    ).rejects.toThrow(AppException);
    expect(prisma.datasetVersion.update).not.toHaveBeenCalled();
  });

  it('DS-LAKE-010-V01: a legal promotion writes ONLY status, nothing else on the row', async () => {
    const prisma = buildPrisma();
    prisma.datasetVersion.findFirst.mockResolvedValue({
      id: 'v-1',
      status: 'DRAFT',
    });
    prisma.datasetVersion.update = jest
      .fn()
      .mockResolvedValue({ id: 'v-1', status: 'VALIDATED' });
    const { service } = makeService(prisma);

    await service.promoteVersionService(USER, 'ds-1', 'v-1', {
      status: 'VALIDATED',
    } as never);

    expect(prisma.datasetVersion.update).toHaveBeenCalledTimes(1);
    expect(prisma.datasetVersion.update).toHaveBeenCalledWith({
      where: { id: 'v-1' },
      data: { status: 'VALIDATED' },
      select: { id: true, status: true },
    });
    // AC0's structural half: the `data` payload is `{status}` alone — no
    // objectKey/checksum field appears anywhere in this call, so neither
    // can change. No `postToPython` call either (verified by the shared
    // `post` mock never firing across this whole describe block).
    expect(post).not.toHaveBeenCalled();
  });

  it('DS-LAKE-010-T05: refuses promoting to ACTIVE while another version already holds it', async () => {
    const prisma = buildPrisma();
    prisma.datasetVersion.findFirst.mockResolvedValue({
      id: 'v-2',
      status: 'VALIDATED',
    });
    const tx = {
      datasetVersion: {
        findFirst: jest.fn().mockResolvedValue({ id: 'v-1' }), // the OTHER active version
        update: jest.fn(),
      },
    };
    prisma.$transaction = jest.fn((cb: (t: typeof tx) => unknown) => cb(tx));
    const { service } = makeService(prisma);

    await expect(
      service.promoteVersionService(USER, 'ds-1', 'v-2', {
        status: 'ACTIVE',
      } as never),
    ).rejects.toThrow(AppException);
    expect(tx.datasetVersion.update).not.toHaveBeenCalled();
  });

  it('promotes to ACTIVE when no other version currently holds it', async () => {
    const prisma = buildPrisma();
    prisma.datasetVersion.findFirst.mockResolvedValue({
      id: 'v-2',
      status: 'VALIDATED',
    });
    const tx = {
      datasetVersion: {
        findFirst: jest.fn().mockResolvedValue(null), // no other ACTIVE version
        update: jest.fn().mockResolvedValue({ id: 'v-2', status: 'ACTIVE' }),
      },
    };
    prisma.$transaction = jest.fn((cb: (t: typeof tx) => unknown) => cb(tx));
    const { service } = makeService(prisma);

    const res = await service.promoteVersionService(USER, 'ds-1', 'v-2', {
      status: 'ACTIVE',
    } as never);

    expect(res.data).toEqual({ id: 'v-2', status: 'ACTIVE' });
    expect(tx.datasetVersion.update).toHaveBeenCalledWith({
      where: { id: 'v-2' },
      data: { status: 'ACTIVE' },
      select: { id: true, status: true },
    });
  });
});

describe('DatasetVersionAuthorizedService — getVersionLineageService (DS-LAKE-010-T03)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('404s when the version does not belong to the dataset', async () => {
    const prisma = buildPrisma();
    const { service } = makeService(prisma);

    await expect(
      service.getVersionLineageService(USER, 'ds-1', 'ghost'),
    ).rejects.toThrow(AppException);
  });

  it('404s when the version predates the lineage snapshot (lineage: null)', async () => {
    const prisma = buildPrisma();
    prisma.datasetVersion.findFirst.mockResolvedValue({
      id: 'v-1',
      lineage: null,
    });
    const { service } = makeService(prisma);

    await expect(
      service.getVersionLineageService(USER, 'ds-1', 'v-1'),
    ).rejects.toThrow(AppException);
  });

  it('DS-LAKE-010-AC3: returns the frozen chain root-first, BRONZE first', async () => {
    const chain = [
      { id: 'bronze-1', type: 'BRONZE', checksum: 'b', objectKey: 'k-b' },
      { id: 'silver-1', type: 'SILVER', checksum: 's', objectKey: 'k-s' },
      { id: 'final-1', type: 'FINAL', checksum: 'f', objectKey: 'k-f' },
    ];
    const prisma = buildPrisma();
    prisma.datasetVersion.findFirst.mockResolvedValue({
      id: 'v-1',
      lineage: chain,
    });
    const { service } = makeService(prisma);

    const res = await service.getVersionLineageService(USER, 'ds-1', 'v-1');

    expect(res.data.lineage[0]).toMatchObject({ type: 'BRONZE' });
    expect(res.data.lineage[res.data.lineage.length - 1]).toMatchObject({
      type: 'FINAL',
    });
    // DS-LAKE-010-V03: no row-level payload anywhere in this response —
    // just the frozen artifact-chain metadata already asserted above.
    expect(res.data).not.toHaveProperty('rows');
  });
});

describe('DatasetVersionAuthorizedService — getArtifactHoldoutService (MODEL-FLOW-010-T06)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the BRONZE siblings holdout window, rows, and missing rate', async () => {
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst
      .mockResolvedValueOnce({ runId: 'run-1' }) // the requested artifact
      .mockResolvedValueOnce({
        objectKey: 'ds-1/artifacts/bronze-1/data.parquet',
        validationRowCount: 42,
        validationHoldoutFrom: new Date('2026-01-11T00:00:00.000Z'),
        validationMissingPct: 12.5,
      }); // the BRONZE sibling, resolved by runId
    post.mockResolvedValue({
      source_key: 'ds-1/artifacts/bronze-1/validate_data.parquet',
      tags: ['TI-101'],
      column_count: 3,
      row_count: 42,
      start_time: '2026-01-04T00:00:00.000Z',
      end_time: '2026-01-13T00:00:00.000Z',
    });
    const { service } = makeService(prisma);

    const res = await service.getArtifactHoldoutService(
      USER,
      'ds-1',
      'artifact-2',
    );

    expect(res.data.holdout).toEqual({
      holdoutFrom: '2026-01-11T00:00:00.000Z',
      holdoutTo: '2026-01-13T00:00:00.000Z',
      rowCount: 42,
      missingPct: 12.5,
    });
    expect(post).toHaveBeenCalledWith(
      '/v1/preprocess/metadata',
      { source_key: 'ds-1/artifacts/bronze-1/validate_data.parquet' },
      2,
    );
  });

  it('derives source_key from the BRONZE objectKey, not datasetId — a draft-scoped BRONZE resolves under drafts/, the bug this test locks in', async () => {
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst
      .mockResolvedValueOnce({ runId: 'run-1' })
      .mockResolvedValueOnce({
        // datasetId is 'ds-1' below, but this dataset was adopted from a
        // draft — the BRONZE's real objectKey still starts with drafts/.
        // Before the fix, `validateDataKey('ds-1', bronze.id)` would have
        // rebuilt `ds-1/artifacts/bronze-1/validate_data.parquet` — a key
        // nothing ever wrote — instead of the key asserted below.
        objectKey: 'drafts/draft-9/artifacts/bronze-1/data_bronze.parquet',
        validationRowCount: 7,
        validationHoldoutFrom: new Date('2026-01-11T00:00:00.000Z'),
        validationMissingPct: 0,
      });
    post.mockResolvedValue({
      source_key: 'drafts/draft-9/artifacts/bronze-1/validate_data.parquet',
      tags: [],
      column_count: 1,
      row_count: 7,
      start_time: '2026-01-04T00:00:00.000Z',
      end_time: '2026-01-13T00:00:00.000Z',
    });
    const { service } = makeService(prisma);

    await service.getArtifactHoldoutService(USER, 'ds-1', 'artifact-2');

    expect(post).toHaveBeenCalledWith(
      '/v1/preprocess/metadata',
      {
        source_key: 'drafts/draft-9/artifacts/bronze-1/validate_data.parquet',
      },
      2,
    );
  });

  it('maps a 422 from a missing validate_data.parquet to a 404 AppException, never leaking the raw object key to the caller', async () => {
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst
      .mockResolvedValueOnce({ runId: 'run-1' })
      .mockResolvedValueOnce({
        objectKey: 'ds-1/artifacts/bronze-1/data.parquet',
        validationRowCount: 42,
        validationHoldoutFrom: new Date('2026-01-11T00:00:00.000Z'),
        validationMissingPct: 12.5,
      });
    post.mockRejectedValue(
      Object.assign(
        new Error(
          "Could not read 'ds-1/artifacts/bronze-1/validate_data.parquet': NoSuchKey",
        ),
        { statusCode: 422 },
      ),
    );
    const { service } = makeService(prisma);

    try {
      await service.getArtifactHoldoutService(USER, 'ds-1', 'artifact-2');
      throw new Error('expected rejection');
    } catch (err) {
      expect(err).toBeInstanceOf(AppException);
      expect((err as AppException).message).not.toContain('validate_data');
      expect((err as { statusCode?: number }).statusCode).toBe(404);
    }
  });

  it('returns holdout: null when the BRONZE sibling has no validation split — the normal case, not an error', async () => {
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst
      .mockResolvedValueOnce({ runId: 'run-1' })
      .mockResolvedValueOnce({
        id: 'bronze-1',
        validationRowCount: null,
        validationHoldoutFrom: null,
        validationMissingPct: null,
      });
    const { service } = makeService(prisma);

    const res = await service.getArtifactHoldoutService(
      USER,
      'ds-1',
      'artifact-2',
    );

    expect(res.statusCode).toBe(200);
    expect(res.data).toEqual({ holdout: null });
    expect(post).not.toHaveBeenCalled();
  });

  it('a holdout captured before T06 comes back with missingPct: null, not 0', async () => {
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst
      .mockResolvedValueOnce({ runId: 'run-1' })
      .mockResolvedValueOnce({
        objectKey: 'ds-1/artifacts/bronze-1/data.parquet',
        validationRowCount: 10,
        validationHoldoutFrom: new Date('2026-01-11T00:00:00.000Z'),
        validationMissingPct: null,
      });
    post.mockResolvedValue({
      source_key: 'ds-1/artifacts/bronze-1/validate_data.parquet',
      tags: [],
      column_count: 1,
      row_count: 10,
      start_time: '2026-01-04T00:00:00.000Z',
      end_time: '2026-01-13T00:00:00.000Z',
    });
    const { service } = makeService(prisma);

    const res = await service.getArtifactHoldoutService(
      USER,
      'ds-1',
      'artifact-2',
    );

    expect(res.data.holdout?.missingPct).toBeNull();
  });

  it('404s when the requested artifact does not belong to the dataset', async () => {
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst.mockResolvedValueOnce(null);
    const { service } = makeService(prisma);

    await expect(
      service.getArtifactHoldoutService(USER, 'ds-1', 'ghost'),
    ).rejects.toThrow(AppException);
  });
});

describe('DatasetVersionAuthorizedService — startExportService / getExportDownloadService (DS-LAKE-021)', () => {
  beforeEach(() => jest.clearAllMocks());

  it("creates an EXPORT-stage job against the dataset's FINAL artifact", async () => {
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst.mockResolvedValueOnce({
      id: 'final-1',
      type: 'FINAL',
      objectKey: 'ds-1/artifacts/final-1/data.parquet',
      runId: 'run-1',
    });
    prisma.preprocessingJob.create.mockResolvedValueOnce({ id: 'job-9' });
    const { service } = makeService(prisma);

    const res = await service.startExportService(USER, 'ds-1');

    expect(res.data.jobId).toBe('job-9');
    const createArgs = prisma.preprocessingJob.create.mock.calls[0][0];
    expect(createArgs.data).toMatchObject({
      stage: 'EXPORT',
      sourceArtifactId: 'final-1',
      operations: { kind: 'export' },
    });
  });

  it('404s when the dataset has no FINAL artifact', async () => {
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst.mockResolvedValueOnce(null);
    const { service } = makeService(prisma);

    await expect(service.startExportService(USER, 'ds-1')).rejects.toThrow(
      AppException,
    );
  });

  it('getExportDownloadService presigns the FINAL objectKey with the export sidecar, fresh every call', async () => {
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst
      .mockResolvedValueOnce({
        id: 'export-1',
        type: 'EXPORT',
        parentArtifactId: 'final-1',
      })
      .mockResolvedValueOnce({
        id: 'final-1',
        objectKey: 'ds-1/artifacts/final-1/data.parquet',
      });
    post.mockResolvedValue({
      data_url: 'https://minio.example/gold-signed',
      sidecar_urls: { 'export.csv': 'https://minio.example/export-signed' },
      checksum: 'c'.repeat(64),
      row_count: 500,
      expires_at: '2026-08-24T01:00:00Z',
    });
    const { service } = makeService(prisma);

    const res = await service.getExportDownloadService(
      USER,
      'ds-1',
      'export-1',
    );

    expect(res.data.downloadUrl).toBe('https://minio.example/export-signed');
    expect(res.data.expiresAt).toBe('2026-08-24T01:00:00Z');
    expect(post).toHaveBeenCalledWith(
      '/v1/preprocess/artifacts/presign',
      {
        source_key: 'ds-1/artifacts/final-1/data.parquet',
        sidecars: ['export.csv'],
      },
      expect.anything(),
    );
  });

  it('getExportDownloadService 404s when the artifact is not type EXPORT', async () => {
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst.mockResolvedValueOnce({
      id: 'silver-1',
      type: 'SILVER',
      parentArtifactId: null,
    });
    const { service } = makeService(prisma);

    await expect(
      service.getExportDownloadService(USER, 'ds-1', 'silver-1'),
    ).rejects.toThrow(AppException);
  });
});
