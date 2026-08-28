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

  it('returns the run siblings holdout window, rows, and missing rate', async () => {
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst
      .mockResolvedValueOnce({ runId: 'run-1' }) // the requested artifact
      .mockResolvedValueOnce({
        objectKey: 'ds-1/artifacts/bronze-1/data.parquet',
        validationRowCount: 42,
        validationHoldoutFrom: new Date('2026-01-11T00:00:00.000Z'),
        validationMissingPct: 12.5,
      }); // the run sibling carrying the validation columns
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

  it('looks up the holdout sibling by the validation columns, not by type — a SILVER-only holdout (DS-LAKE-022 reordered pipeline) resolves, not just BRONZE', async () => {
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst
      .mockResolvedValueOnce({ runId: 'run-1' }) // the requested artifact
      .mockResolvedValueOnce({
        objectKey: 'ds-1/artifacts/silver-1/data_silver.parquet',
        validationRowCount: 576,
        validationHoldoutFrom: new Date('2026-01-27T17:00:00.000Z'),
        validationMissingPct: 0,
      }); // the SILVER sibling — reordered pipeline writes the split here
    post.mockResolvedValue({
      source_key: 'ds-1/artifacts/silver-1/validate_data.parquet',
      tags: ['TI-101'],
      column_count: 3,
      row_count: 576,
      start_time: '2026-01-27T17:00:00.000Z',
      end_time: '2026-01-28T00:00:00.000Z',
    });
    const { service } = makeService(prisma);

    const res = await service.getArtifactHoldoutService(
      USER,
      'ds-1',
      'artifact-final',
    );

    expect(res.data.holdout?.rowCount).toBe(576);
    expect(prisma.datasetArtifact.findFirst).toHaveBeenNthCalledWith(2, {
      where: {
        runId: 'run-1',
        validationRowCount: { not: null },
        validationHoldoutFrom: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        objectKey: true,
        validationRowCount: true,
        validationHoldoutFrom: true,
        validationMissingPct: true,
      },
    });
  });

  it('breaks a tie between two candidates in the same run by createdAt desc — a re-materialized run with two BRONZE rows resolves the newer one deterministically', async () => {
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst
      .mockResolvedValueOnce({ runId: 'run-1' })
      .mockResolvedValueOnce({
        objectKey: 'ds-1/artifacts/bronze-2/data_bronze.parquet',
        validationRowCount: 3167,
        validationHoldoutFrom: new Date('2026-01-25T17:00:00.000Z'),
        validationMissingPct: 0,
      }); // Prisma's own orderBy: createdAt desc picks this row; the mock
    // stands in for that ordering rather than re-implementing it.
    post.mockResolvedValue({
      source_key: 'ds-1/artifacts/bronze-2/validate_data.parquet',
      tags: [],
      column_count: 1,
      row_count: 3167,
      start_time: '2026-01-25T17:00:00.000Z',
      end_time: '2026-01-28T00:00:00.000Z',
    });
    const { service } = makeService(prisma);

    const res = await service.getArtifactHoldoutService(
      USER,
      'ds-1',
      'artifact-final',
    );

    expect(res.data.holdout?.rowCount).toBe(3167);
    expect(prisma.datasetArtifact.findFirst).toHaveBeenNthCalledWith(2, {
      where: {
        runId: 'run-1',
        validationRowCount: { not: null },
        validationHoldoutFrom: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        objectKey: true,
        validationRowCount: true,
        validationHoldoutFrom: true,
        validationMissingPct: true,
      },
    });
  });

  it('derives source_key from the resolved artifacts objectKey, not datasetId — a draft-scoped artifact resolves under drafts/, the bug this test locks in', async () => {
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst
      .mockResolvedValueOnce({ runId: 'run-1' })
      .mockResolvedValueOnce({
        // datasetId is 'ds-1' below, but this dataset was adopted from a
        // draft — the resolved artifact's real objectKey still starts with
        // drafts/. Before the fix, `validateDataKey('ds-1', artifact.id)`
        // would have rebuilt `ds-1/artifacts/bronze-1/validate_data.parquet`
        // — a key nothing ever wrote — instead of the key asserted below.
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

  it('returns holdout: null when no run sibling has a validation split — the normal case, not an error', async () => {
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst
      .mockResolvedValueOnce({ runId: 'run-1' })
      // Prisma's `where: { validationRowCount: { not: null }, ... }`
      // matches nothing for a run with no holdout — findFirst resolves
      // null, not a row with null fields.
      .mockResolvedValueOnce(null);
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

describe('DatasetVersionAuthorizedService — getArtifactValidationRowsService (compare view)', () => {
  beforeEach(() => jest.clearAllMocks());

  const ROW_PAGE = {
    source_key: 'ds-1/artifacts/silver-1/validate_data.parquet',
    total_row_count: 2,
    offset: 0,
    tags: ['TI-101'],
    filtered: true,
    start_time: '2026-01-27T17:00:00.000Z',
    end_time: '2026-01-28T00:00:00.000Z',
    rows: [
      {
        timestamp: '2026-01-27T17:00:00.000Z',
        cells: { 'TI-101': { value: 42, status: 'Good' } },
      },
      {
        timestamp: '2026-01-27T18:00:00.000Z',
        cells: { 'TI-101': { value: 0, status: 'Bad' } },
      },
    ],
  };

  it('reads validate_data.parquet via the same run-sibling lookup getArtifactHoldoutService uses', async () => {
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst
      .mockResolvedValueOnce({ runId: 'run-1' }) // the requested artifact
      .mockResolvedValueOnce({
        objectKey: 'ds-1/artifacts/silver-1/data_silver.parquet',
        validationRowCount: 576,
        validationHoldoutFrom: new Date('2026-01-27T17:00:00.000Z'),
        validationMissingPct: 0,
      }); // the holdout sibling
    post.mockResolvedValue(ROW_PAGE);
    const { service } = makeService(prisma);

    const res = await service.getArtifactValidationRowsService(
      USER,
      'ds-1',
      'artifact-final',
      { offset: 0, limit: 1000, tags: ['TI-101'] } as never,
    );

    expect(res.data.rows).toHaveLength(2);
    expect(res.data.totalRowCount).toBe(2);
    expect(post).toHaveBeenCalledWith(
      '/v1/preprocess/rows',
      {
        source_key: 'ds-1/artifacts/silver-1/validate_data.parquet',
        offset: 0,
        limit: 1000,
        tags: ['TI-101'],
      },
      expect.any(Number),
    );
  });

  it('404s when the run has no validation holdout, never returning rows: null', async () => {
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst
      .mockResolvedValueOnce({ runId: 'run-1' })
      .mockResolvedValueOnce(null);
    const { service } = makeService(prisma);

    await expect(
      service.getArtifactValidationRowsService(USER, 'ds-1', 'artifact-final', {
        offset: 0,
        limit: 1000,
      } as never),
    ).rejects.toThrow(AppException);
    expect(post).not.toHaveBeenCalled();
  });

  it('maps a 422 from a reclaimed validate_data.parquet to a 404, same discipline as getArtifactHoldoutService', async () => {
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst
      .mockResolvedValueOnce({ runId: 'run-1' })
      .mockResolvedValueOnce({
        objectKey: 'ds-1/artifacts/silver-1/data_silver.parquet',
        validationRowCount: 576,
        validationHoldoutFrom: new Date('2026-01-27T17:00:00.000Z'),
        validationMissingPct: 0,
      });
    post.mockRejectedValue(
      Object.assign(new Error('NoSuchKey'), { statusCode: 422 }),
    );
    const { service } = makeService(prisma);

    try {
      await service.getArtifactValidationRowsService(
        USER,
        'ds-1',
        'artifact-final',
        { offset: 0, limit: 1000 } as never,
      );
      throw new Error('expected rejection');
    } catch (err) {
      expect(err).toBeInstanceOf(AppException);
      expect((err as { statusCode?: number }).statusCode).toBe(404);
    }
  });

  // DS-LAKE-025-T06 read 2. Python answers 422 for BOTH "object gone" and
  // "unknown column"; a BRONZE-borne holdout is pre-features, so asking it
  // for a derived column fails while the sidecar is perfectly intact.
  // Reporting that as "no longer retained" is the exact copy-conflation this
  // file's other states exist to prevent.
  it('does NOT report a missing derived column as a reclaimed holdout — an unknown-tag 422 stays a 422 with its own message', async () => {
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst
      .mockResolvedValueOnce({ runId: 'run-1' })
      .mockResolvedValueOnce({
        // A BRONZE-borne holdout: raw tags only, no engineered columns.
        objectKey: 'ds-1/artifacts/bronze-2/data_bronze.parquet',
        validationRowCount: 3167,
        validationHoldoutFrom: new Date('2026-01-25T17:00:00.000Z'),
        validationMissingPct: 0,
      });
    post.mockRejectedValue(
      Object.assign(
        new Error("No match for FieldRef.Name('TI-101_rolling_60') in schema"),
        { statusCode: 422 },
      ),
    );
    const { service } = makeService(prisma);

    try {
      await service.getArtifactValidationRowsService(
        USER,
        'ds-1',
        'artifact-final',
        { offset: 0, limit: 1000, tags: ['TI-101_rolling_60'] } as never,
      );
      throw new Error('expected rejection');
    } catch (err) {
      expect(err).toBeInstanceOf(AppException);
      expect((err as { statusCode?: number }).statusCode).toBe(422);
      expect((err as AppException).message).toContain('do not exist');
      // The storage claim must be absent — that is the whole point.
      expect((err as AppException).message).not.toContain(
        'missing from storage',
      );
    }
  });
});

describe('DatasetVersionAuthorizedService — getArtifactFeatureSpecService (DS-LAKE-025-T06)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('serves scalingParams from the sidecar without opening the data object', async () => {
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst.mockResolvedValueOnce({
      objectKey: 'ds-1/artifacts/gold-1/data_gold.parquet',
      featureSpecKey: 'ds-1/artifacts/gold-1/feature_spec.json',
    });
    post.mockResolvedValue({
      source_key: 'ds-1/artifacts/gold-1/data_gold.parquet',
      feature_spec_key: 'ds-1/artifacts/gold-1/feature_spec.json',
      spec: {
        featureVersion: 1,
        scaling: [],
        scalingParams: { 'TI-101': { min: 70, max: 75 } },
      },
    });
    const { service } = makeService(prisma);

    const res = await service.getArtifactFeatureSpecService(
      USER,
      'ds-1',
      'gold-1',
    );

    expect(res.data.scalingParams).toEqual({ 'TI-101': { min: 70, max: 75 } });
    expect(post).toHaveBeenCalledWith(
      '/v1/preprocess/feature-spec',
      { source_key: 'ds-1/artifacts/gold-1/data_gold.parquet' },
      expect.any(Number),
    );
  });

  it('404s WITHOUT calling Python when featureSpecKey is null — a BRONZE produces no spec, and Postgres alone knows that', async () => {
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst.mockResolvedValueOnce({
      objectKey: 'ds-1/artifacts/bronze-1/data_bronze.parquet',
      featureSpecKey: null,
    });
    const { service } = makeService(prisma);

    await expect(
      service.getArtifactFeatureSpecService(USER, 'ds-1', 'bronze-1'),
    ).rejects.toThrow(AppException);
    expect(post).not.toHaveBeenCalled();
  });

  it('maps a 422 from a missing sidecar to a 404, same discipline as getArtifactColumnStatsService', async () => {
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst.mockResolvedValueOnce({
      objectKey: 'ds-1/artifacts/gold-1/data_gold.parquet',
      featureSpecKey: 'ds-1/artifacts/gold-1/feature_spec.json',
    });
    post.mockRejectedValue(
      Object.assign(new Error('NoSuchKey'), { statusCode: 422 }),
    );
    const { service } = makeService(prisma);

    try {
      await service.getArtifactFeatureSpecService(USER, 'ds-1', 'gold-1');
      throw new Error('expected rejection');
    } catch (err) {
      expect(err).toBeInstanceOf(AppException);
      expect((err as { statusCode?: number }).statusCode).toBe(404);
    }
  });

  it('returns scalingParams: null rather than {} when the sidecar predates the field — "not recorded" is not "nothing was scaled"', async () => {
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst.mockResolvedValueOnce({
      objectKey: 'ds-1/artifacts/gold-1/data_gold.parquet',
      featureSpecKey: 'ds-1/artifacts/gold-1/feature_spec.json',
    });
    post.mockResolvedValue({
      source_key: 'ds-1/artifacts/gold-1/data_gold.parquet',
      feature_spec_key: 'ds-1/artifacts/gold-1/feature_spec.json',
      spec: { featureVersion: 1, scaling: [] },
    });
    const { service } = makeService(prisma);

    const res = await service.getArtifactFeatureSpecService(
      USER,
      'ds-1',
      'gold-1',
    );

    expect(res.data.scalingParams).toBeNull();
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
    prisma.preprocessingJob.create.mockResolvedValueOnce({
      id: 'job-9',
      status: 'QUEUED',
    });
    const { service } = makeService(prisma);

    const res = await service.startExportService(USER, 'ds-1');

    expect(res.data.jobId).toBe('job-9');
    expect(res.data.status).toBe('QUEUED');
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

  it("getExportDownloadService presigns the EXPORT artifact's own objectKey, fresh every call", async () => {
    // DS-LAKE-021-T04: the export now owns its own key directly (own
    // artifact-id-keyed prefix) — one lookup, no parentArtifactId hop to a
    // FINAL, no sidecars param. `data_url`, not `sidecar_urls[...]`.
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst.mockResolvedValueOnce({
      id: 'export-1',
      type: 'EXPORT',
      objectKey: 'ds-1/artifacts/export-1/export.csv',
    });
    post.mockResolvedValue({
      data_url: 'https://minio.example/export-signed',
      sidecar_urls: {},
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
      { source_key: 'ds-1/artifacts/export-1/export.csv', sidecars: [] },
      expect.anything(),
    );
  });

  it('getExportDownloadService 404s when no EXPORT artifact matches this id/dataset', async () => {
    // A real Postgres query's `where: { id, datasetId, type: 'EXPORT' }`
    // returns null for a wrong-type or wrong-dataset id alike — both
    // collapse to the same "not found" case this mock represents.
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst.mockResolvedValueOnce(null);
    const { service } = makeService(prisma);

    await expect(
      service.getExportDownloadService(USER, 'ds-1', 'silver-1'),
    ).rejects.toThrow(AppException);
  });

  // DS-LAKE-021 final-review fix: getJobService must surface resultArtifactId
  // so a client can learn which artifact id to call the download route with.
  it('getJobService returns resultArtifactId from the job row', async () => {
    const prisma = buildPrisma({
      preprocessingJob: {
        create: jest.fn(),
        findFirst: jest.fn().mockResolvedValue({
          id: 'job-9',
          status: 'SUCCEEDED',
          stage: 'EXPORT',
          progress: 100,
          currentStep: 1,
          totalSteps: 1,
          completedSteps: 1,
          estimatedRemainingMs: 0,
          error: null,
          attempts: 1,
          sourceVersionId: null,
          resultVersionId: null,
          resultArtifactId: 'export-1',
          startedAt: null,
          finishedAt: null,
        }),
      },
    });
    const { service } = makeService(prisma);

    const res = await service.getJobService(USER, 'ds-1', 'job-9');

    expect(res.data.resultArtifactId).toBe('export-1');
  });
});
