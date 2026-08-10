import { AppException } from '@softsensor/common';
import { postBinaryToPython, postToPython } from '@/lib/python-client';
import { DatasetDraftAuthorizedService } from './dataset-draft.authorized.service';
import type { PreprocessingJobService } from '../../dataset-version/authorized/preprocessing-job.service';
import {
  ListRowsSchema,
  TagCatalogSchema,
  type CreateRawVersionDto,
} from '../../dataset-version/authorized/dto/dataset-version.authorized.dto';

jest.mock('@/lib/python-client', () => ({
  postToPython: jest.fn(),
  postBinaryToPython: jest.fn(),
  PYTHON_TIMEOUT: { test: 1, metadata: 2, fetch: 3, preprocess: 4 },
}));

jest.mock('@/lib/crypto', () => ({
  decryptSecret: jest.fn().mockReturnValue('decrypted-secret'),
}));

const post = postToPython as jest.MockedFunction<typeof postToPython>;
const postBinary = postBinaryToPython as jest.MockedFunction<
  typeof postBinaryToPython
>;

const USER: Auth.UserPayload = {
  id: 'user-1',
  role: 'MEMBER',
} as Auth.UserPayload;

const DRAFT = {
  id: 'draft-1',
  name: null,
  workspaceId: 'ws-1',
  sourceIds: ['src-allowed'],
  status: 'ACTIVE',
  currentArtifactId: null,
  savedDatasetId: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

const SOURCE = {
  id: 'src-allowed',
  type: 'aveva',
  host: 'pi.example.com',
  username: 'svc',
  dbName: 'PIServer',
  secretCiphertext: 'cipher',
  config: {},
};

function buildPrisma(overrides: Record<string, unknown> = {}) {
  const artifactCreate = jest
    .fn()
    .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ ...data }),
    );
  const tx = {
    datasetArtifact: { create: artifactCreate },
    datasetDraft: { update: jest.fn() },
  };
  return {
    datasetDraft: {
      findFirst: jest.fn().mockResolvedValue(DRAFT),
      create: jest.fn().mockResolvedValue(DRAFT),
      update: jest.fn().mockResolvedValue(DRAFT),
    },
    dataSource: {
      findFirst: jest.fn().mockResolvedValue(SOURCE),
    },
    datasetArtifact: {
      findFirst: jest.fn(),
    },
    preprocessingJob: {
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
          id: 'job-1',
          status: 'QUEUED',
          ...data,
        })),
      findFirst: jest.fn(),
    },
    $transaction: jest.fn((cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    workspace: {
      findFirst: jest.fn().mockResolvedValue({ id: 'ws-1' }),
    },
    ...overrides,
  };
}

/**
 * `jest.Mock.mock.calls` is `any[][]` when the mock's generic is not pinned,
 * exactly as documented in `preprocessing-job.service.spec.ts`. One typed
 * accessor keeps the create-call assertions readable and the lint honest.
 */
function firstCreateArg(mock: jest.Mock): { data: Record<string, unknown> } {
  return (mock.mock.calls[0] as [{ data: Record<string, unknown> }])[0];
}

function makeService(prisma: ReturnType<typeof buildPrisma>) {
  const jobs = { start: jest.fn(), cancel: jest.fn() };
  const service = new DatasetDraftAuthorizedService(
    prisma as unknown as ConstructorParameters<
      typeof DatasetDraftAuthorizedService
    >[0],
    jobs as unknown as PreprocessingJobService,
  );
  return { service, jobs };
}

const MATERIALIZE_DTO: CreateRawVersionDto = {
  sourceId: 'src-allowed',
  tags: ['TI-101'],
  startTime: '2026-01-01T00:00:00Z',
  endTime: '2026-01-02T00:00:00Z',
};

describe('DatasetDraftAuthorizedService — materialize source scoping', () => {
  beforeEach(() => jest.clearAllMocks());

  /**
   * The one invariant this whole draft-scoped surface exists to preserve
   * (feature_list.preprocessing.json → decisions.draft_architecture
   * .source_scoping): a DataSource lookup that is not restricted to the
   * draft's OWN sourceIds would let any caller holding a draft id name an
   * arbitrary DataSource and have the server decrypt and use ITS credentials.
   */
  it('refuses a sourceId the draft does not list, without ever loading the DataSource', async () => {
    const prisma = buildPrisma();
    const { service } = makeService(prisma);

    await expect(
      service.materializeDraftArtifactService(USER, 'draft-1', {
        ...MATERIALIZE_DTO,
        sourceId: 'src-not-owned',
      }),
    ).rejects.toThrow(AppException);

    expect(prisma.dataSource.findFirst).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it('materializes a BRONZE artifact scoped to draftId, not datasetId', async () => {
    post.mockResolvedValueOnce({
      object_key: 'drafts/draft-1/artifacts/whatever/data.parquet',
      row_count: 10,
      column_count: 1,
      size_bytes: 100,
      missing_pct: 0,
      checksum: 'a'.repeat(64),
      duration_ms: 5,
    });
    const prisma = buildPrisma();
    const { service } = makeService(prisma);

    const res = await service.materializeDraftArtifactService(
      USER,
      'draft-1',
      MATERIALIZE_DTO,
    );

    expect(res.data.type).toBe('BRONZE');
    expect(prisma.dataSource.findFirst).toHaveBeenCalledWith({
      where: { id: 'src-allowed' },
    });

    // The target_key the connector was told to write must fall under the
    // drafts/ namespace, never under a bare datasetId — that is what keeps a
    // draft-time write from colliding with a saved dataset's keys.
    const [, body] = post.mock.calls[0];
    expect((body as { target_key: string }).target_key).toContain(
      'drafts/draft-1/artifacts/',
    );
  });
});

describe('DatasetDraftAuthorizedService — preview (T01 hybrid)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('previews against a draft artifact and writes nothing', async () => {
    post.mockResolvedValueOnce({
      source_key: 'drafts/draft-1/artifacts/artifact-1/data.parquet',
      sampled: false,
      sampled_rows: 10,
      source_row_count: 10,
      before: {
        row_count: 10,
        column_count: 1,
        missing_cells: 0,
        missing_pct: 0,
        columns: [],
        rows: [],
      },
      after: {
        row_count: 10,
        column_count: 1,
        missing_cells: 0,
        missing_pct: 0,
        columns: [],
        rows: [],
      },
      delta: {
        row_count: 0,
        column_count: 0,
        missing_cells: 0,
        missing_pct: 0,
      },
      warnings: [],
    });
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst.mockResolvedValue({
      objectKey: 'drafts/draft-1/artifacts/artifact-1/data.parquet',
    });
    const { service } = makeService(prisma);

    const res = await service.previewDraftService(
      USER,
      'draft-1',
      'artifact-1',
      {
        operations: [{ type: 'drop_missing' }],
        precision: {},
      },
    );

    expect(res.data.source_key).toBe(
      'drafts/draft-1/artifacts/artifact-1/data.parquet',
    );
    expect(prisma.preprocessingJob.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('404s previewing an artifact that does not belong to this draft', async () => {
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst.mockResolvedValue(null);
    const { service } = makeService(prisma);

    await expect(
      service.previewDraftService(USER, 'draft-1', 'not-mine', {
        operations: [{ type: 'drop_missing' }],
        precision: {},
      }),
    ).rejects.toThrow(AppException);
    expect(post).not.toHaveBeenCalled();
  });

  it('forwards tags/startTime/endTime to Python (DS-LAKE-005B-A-T04)', async () => {
    post.mockResolvedValueOnce({
      source_key: 'drafts/draft-1/artifacts/artifact-1/data.parquet',
      sampled: false,
      sampled_rows: 3,
      source_row_count: 3,
      before: {
        row_count: 3,
        column_count: 1,
        missing_cells: 0,
        missing_pct: 0,
        columns: [],
        rows: [],
      },
      after: {
        row_count: 3,
        column_count: 1,
        missing_cells: 0,
        missing_pct: 0,
        columns: [],
        rows: [],
      },
      delta: {
        row_count: 0,
        column_count: 0,
        missing_cells: 0,
        missing_pct: 0,
      },
      filtered: true,
      start_time: '2026-01-01 00:01:00',
      end_time: '2026-01-01 00:03:00',
      warnings: [],
    });
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst.mockResolvedValue({
      objectKey: 'drafts/draft-1/artifacts/artifact-1/data.parquet',
    });
    const { service } = makeService(prisma);

    const res = await service.previewDraftService(
      USER,
      'draft-1',
      'artifact-1',
      {
        operations: [{ type: 'drop_missing' }],
        precision: {},
        tags: ['TI-101'],
        startTime: '2026-01-01 00:01:00',
        endTime: '2026-01-01 00:03:00',
      },
    );

    const [, body] = post.mock.calls[0];
    expect(body).toMatchObject({
      tags: ['TI-101'],
      start_time: '2026-01-01 00:01:00',
      end_time: '2026-01-01 00:03:00',
    });
    // Raw passthrough (no camelCase remap on this path, unlike rows/metadata)
    // — the new fields must survive PythonPreviewSchema.parse untouched.
    expect(res.data.filtered).toBe(true);
    expect(res.data.start_time).toBe('2026-01-01 00:01:00');
  });

  it('omits tags/start_time/end_time from the Python call when not supplied', async () => {
    post.mockResolvedValueOnce({
      source_key: 'drafts/draft-1/artifacts/artifact-1/data.parquet',
      sampled: false,
      sampled_rows: 10,
      source_row_count: 10,
      before: {
        row_count: 10,
        column_count: 1,
        missing_cells: 0,
        missing_pct: 0,
        columns: [],
        rows: [],
      },
      after: {
        row_count: 10,
        column_count: 1,
        missing_cells: 0,
        missing_pct: 0,
        columns: [],
        rows: [],
      },
      delta: {
        row_count: 0,
        column_count: 0,
        missing_cells: 0,
        missing_pct: 0,
      },
      warnings: [],
    });
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst.mockResolvedValue({
      objectKey: 'drafts/draft-1/artifacts/artifact-1/data.parquet',
    });
    const { service } = makeService(prisma);

    await service.previewDraftService(USER, 'draft-1', 'artifact-1', {
      operations: [{ type: 'drop_missing' }],
      precision: {},
    });

    const [, body] = post.mock.calls[0];
    expect(body).not.toHaveProperty('tags');
    expect(body).not.toHaveProperty('start_time');
    expect(body).not.toHaveProperty('end_time');
    // filtered defaults false server-side when the artifact has no time range.
  });

  it('forwards maxPoints to Python and passes through the downsample envelope (DS-LAKE-005B-A-T06)', async () => {
    post.mockResolvedValueOnce({
      source_key: 'drafts/draft-1/artifacts/artifact-1/data.parquet',
      sampled: false,
      sampled_rows: 259_200,
      source_row_count: 259_200,
      before: {
        row_count: 259_200,
        column_count: 1,
        missing_cells: 0,
        missing_pct: 0,
        columns: [],
        rows: [],
        downsampled: true,
        downsample_ratio: 129.6,
        series: [],
      },
      after: {
        row_count: 259_200,
        column_count: 1,
        missing_cells: 0,
        missing_pct: 0,
        columns: [],
        rows: [],
        downsampled: true,
        downsample_ratio: 129.6,
        series: [],
      },
      delta: {
        row_count: 0,
        column_count: 0,
        missing_cells: 0,
        missing_pct: 0,
      },
      max_points: 2000,
      bucket_edges: ['2026-01-01 00:00:00', '2026-06-30 00:00:00'],
      warnings: ['Chart series reduced to at most 2,000 points via LTTB...'],
    });
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst.mockResolvedValue({
      objectKey: 'drafts/draft-1/artifacts/artifact-1/data.parquet',
    });
    const { service } = makeService(prisma);

    const res = await service.previewDraftService(
      USER,
      'draft-1',
      'artifact-1',
      {
        operations: [],
        precision: {},
        maxPoints: 2000,
      },
    );

    const [, body] = post.mock.calls[0];
    expect(body).toMatchObject({ max_points: 2000 });
    expect(res.data.max_points).toBe(2000);
    expect(res.data.bucket_edges).toEqual([
      '2026-01-01 00:00:00',
      '2026-06-30 00:00:00',
    ]);
    expect(res.data.before.downsampled).toBe(true);
    expect(res.data.before.downsample_ratio).toBe(129.6);
  });

  it('omits maxPoints from the Python call when not supplied', async () => {
    post.mockResolvedValueOnce({
      source_key: 'drafts/draft-1/artifacts/artifact-1/data.parquet',
      sampled: false,
      sampled_rows: 3,
      source_row_count: 3,
      before: {
        row_count: 3,
        column_count: 1,
        missing_cells: 0,
        missing_pct: 0,
        columns: [],
        rows: [],
      },
      after: {
        row_count: 3,
        column_count: 1,
        missing_cells: 0,
        missing_pct: 0,
        columns: [],
        rows: [],
      },
      delta: {
        row_count: 0,
        column_count: 0,
        missing_cells: 0,
        missing_pct: 0,
      },
      warnings: [],
    });
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst.mockResolvedValue({
      objectKey: 'drafts/draft-1/artifacts/artifact-1/data.parquet',
    });
    const { service } = makeService(prisma);

    const res = await service.previewDraftService(
      USER,
      'draft-1',
      'artifact-1',
      {
        operations: [],
        precision: {},
      },
    );

    const [, body] = post.mock.calls[0];
    expect(body).not.toHaveProperty('max_points');
    // Lenient schema fields default sanely when the connector omits them.
    expect(res.data.before.downsampled).toBe(false);
    expect(res.data.max_points).toBeUndefined();
  });
});

describe('DatasetDraftAuthorizedService — artifact metadata (DS-LAKE-005B-A-T01)', () => {
  beforeEach(() => jest.clearAllMocks());

  const ARTIFACT = {
    id: 'artifact-1',
    runId: 'run-1',
    type: 'BRONZE',
    parentArtifactId: null,
    checksum: 'a'.repeat(64),
    objectKey: 'drafts/draft-1/artifacts/artifact-1/data.parquet',
    rowCount: 100,
    columnCount: 3, // LOGICAL tags
    missingPct: 1.5,
    sizeBytes: 4096n,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };

  it('reports tagCount and columnCount as distinct fields, never conflated', async () => {
    post.mockResolvedValueOnce({
      source_key: ARTIFACT.objectKey,
      tags: ['TI-101', 'TI-102', 'FI-201'],
      column_count: 7, // timestamp + 3 tags + 3 status sidecars (2N+1)
      row_count: 100,
      start_time: '2026-01-01 00:00:00',
      end_time: '2026-01-02 00:00:00',
    });
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst.mockResolvedValue(ARTIFACT);
    const { service } = makeService(prisma);

    const res = await service.getDraftArtifactMetadataService(
      USER,
      'draft-1',
      'artifact-1',
    );

    expect(res.data.tagCount).toBe(3);
    expect(res.data.columnCount).toBe(7);
    expect(res.data.tagCount).not.toBe(res.data.columnCount);
    expect(res.data.tags).toEqual(['TI-101', 'TI-102', 'FI-201']);
    expect(res.data.startTime).toBe('2026-01-01 00:00:00');
    expect(res.data.endTime).toBe('2026-01-02 00:00:00');
    expect(res.data.missingPct).toBe(1.5);
    // BigInt is not JSON-serialisable; must cross the wire as a string.
    expect(res.data.sizeBytes).toBe('4096');
    expect(typeof res.data.sizeBytes).toBe('string');

    // No row payload — this is metadata, not hydration.
    expect(res.data).not.toHaveProperty('rows');

    const [, body] = post.mock.calls[0];
    expect(body).toEqual({ source_key: ARTIFACT.objectKey });
  });

  it('404s metadata for an artifact that does not belong to this draft', async () => {
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst.mockResolvedValue(null);
    const { service } = makeService(prisma);

    await expect(
      service.getDraftArtifactMetadataService(USER, 'draft-1', 'not-mine'),
    ).rejects.toThrow(AppException);
    expect(post).not.toHaveBeenCalled();
  });
});

describe('DatasetDraftAuthorizedService — column stats sidecar (DS-LAKE-005B-A-T07)', () => {
  beforeEach(() => jest.clearAllMocks());

  const ARTIFACT_WITH_SIDECAR = {
    objectKey: 'drafts/draft-1/artifacts/artifact-1/data.parquet',
    columnStatsKey: 'drafts/draft-1/artifacts/artifact-1/column_stats.json',
  };

  it('forwards source_key and returns the per-tag stats keyed by tag', async () => {
    post.mockResolvedValueOnce({
      source_key: ARTIFACT_WITH_SIDECAR.objectKey,
      column_stats_key: ARTIFACT_WITH_SIDECAR.columnStatsKey,
      stats: {
        'TI-101': {
          tag: 'TI-101',
          coverage: 98.5,
          null_pct: 1.5,
          outlier_count: 2,
          min: 10.0,
          max: 90.0,
          mean: 45.0,
          drift: null,
          percentiles: { p1: 10.2, p99: 89.5 },
          cleaned: false,
        },
      },
    });
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst.mockResolvedValue(ARTIFACT_WITH_SIDECAR);
    const { service } = makeService(prisma);

    const res = await service.getDraftArtifactColumnStatsService(
      USER,
      'draft-1',
      'artifact-1',
    );

    const [, body] = post.mock.calls[0];
    expect(body).toEqual({ source_key: ARTIFACT_WITH_SIDECAR.objectKey });
    expect(res.data.columnStatsKey).toBe(ARTIFACT_WITH_SIDECAR.columnStatsKey);
    expect(res.data.stats['TI-101'].coverage).toBe(98.5);
    expect(res.data.stats['TI-101'].drift).toBeNull();
  });

  it('404s WITHOUT calling Python when columnStatsKey is null (legacy artifact)', async () => {
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst.mockResolvedValue({
      objectKey: 'drafts/draft-1/artifacts/artifact-1/data.parquet',
      columnStatsKey: null,
    });
    const { service } = makeService(prisma);

    await expect(
      service.getDraftArtifactColumnStatsService(USER, 'draft-1', 'artifact-1'),
    ).rejects.toThrow(AppException);
    expect(post).not.toHaveBeenCalled();
  });

  it('404s for an artifact that does not belong to this draft', async () => {
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst.mockResolvedValue(null);
    const { service } = makeService(prisma);

    await expect(
      service.getDraftArtifactColumnStatsService(USER, 'draft-1', 'not-mine'),
    ).rejects.toThrow(AppException);
    expect(post).not.toHaveBeenCalled();
  });
});

describe('DatasetDraftAuthorizedService — artifact rows (DS-LAKE-005B-A-T02)', () => {
  beforeEach(() => jest.clearAllMocks());

  const OBJECT_KEY = 'drafts/draft-1/artifacts/artifact-1/data.parquet';

  it('forwards tags/startTime/endTime to Python and echoes the applied filter back', async () => {
    post.mockResolvedValueOnce({
      source_key: OBJECT_KEY,
      total_row_count: 2,
      offset: 0,
      tags: ['TI-101'],
      filtered: true,
      start_time: '2026-01-01 00:00:00',
      end_time: '2026-01-02 00:00:00',
      rows: [],
    });
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst.mockResolvedValue({
      objectKey: OBJECT_KEY,
    });
    const { service } = makeService(prisma);

    const res = await service.listDraftRowsService(
      USER,
      'draft-1',
      'artifact-1',
      {
        offset: 0,
        limit: 1000,
        tags: ['TI-101'],
        startTime: '2026-01-01 00:00:00',
        endTime: '2026-01-02 00:00:00',
        format: 'json',
      },
    );
    if (res.format !== 'json') throw new Error('expected json');

    const [, body] = post.mock.calls[0];
    expect(body).toEqual({
      source_key: OBJECT_KEY,
      offset: 0,
      limit: 1000,
      tags: ['TI-101'],
      start_time: '2026-01-01 00:00:00',
      end_time: '2026-01-02 00:00:00',
    });
    // A filtered totalRowCount that does not announce itself is a
    // client-side correctness trap — the caller must be able to tell it
    // apart from the whole artifact without re-sending its own request.
    expect(res.data.filtered).toBe(true);
    expect(res.data.startTime).toBe('2026-01-01 00:00:00');
    expect(res.data.endTime).toBe('2026-01-02 00:00:00');
  });

  it('omits tags/start_time/end_time from the Python call when not supplied', async () => {
    post.mockResolvedValueOnce({
      source_key: OBJECT_KEY,
      total_row_count: 6,
      offset: 0,
      tags: ['TI-101'],
      filtered: false,
      start_time: null,
      end_time: null,
      rows: [],
    });
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst.mockResolvedValue({
      objectKey: OBJECT_KEY,
    });
    const { service } = makeService(prisma);

    const res = await service.listDraftRowsService(
      USER,
      'draft-1',
      'artifact-1',
      {
        offset: 0,
        limit: 1000,
        format: 'json',
      },
    );
    if (res.format !== 'json') throw new Error('expected json');

    const [, body] = post.mock.calls[0];
    expect(body).toEqual({ source_key: OBJECT_KEY, offset: 0, limit: 1000 });
    expect(res.data.filtered).toBe(false);
    expect(res.data.startTime).toBeNull();
  });

  it('forwards format=arrow to postBinaryToPython, not postToPython (DS-LAKE-005B-A-T05)', async () => {
    postBinary.mockResolvedValueOnce({
      buffer: Buffer.from([1, 2, 3]),
      contentType: 'application/vnd.apache.arrow.stream',
      headers: {
        'X-Total-Row-Count': '6',
        'X-Offset': '0',
        'X-Filtered': 'false',
      },
    });
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst.mockResolvedValue({
      objectKey: OBJECT_KEY,
    });
    const { service } = makeService(prisma);

    const res = await service.listDraftRowsService(
      USER,
      'draft-1',
      'artifact-1',
      {
        offset: 0,
        limit: 1000,
        format: 'arrow',
      },
    );
    if (res.format !== 'arrow') throw new Error('expected arrow');

    expect(post).not.toHaveBeenCalled();
    const [, body] = postBinary.mock.calls[0];
    expect(body).toEqual({
      source_key: OBJECT_KEY,
      offset: 0,
      limit: 1000,
      format: 'arrow',
    });
    expect(res.contentType).toBe('application/vnd.apache.arrow.stream');
    expect(res.headers['X-Total-Row-Count']).toBe('6');
    expect(res.buffer).toEqual(Buffer.from([1, 2, 3]));
  });

  it('404s rows for an artifact that does not belong to this draft', async () => {
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst.mockResolvedValue(null);
    const { service } = makeService(prisma);

    await expect(
      service.listDraftRowsService(USER, 'draft-1', 'not-mine', {
        offset: 0,
        limit: 1000,
        format: 'json',
      }),
    ).rejects.toThrow(AppException);
    expect(post).not.toHaveBeenCalled();
  });

  it('rejects a limit over the bound at the schema level, regardless of artifact size (V01)', () => {
    // The refusal happens in validation, before any artifact is looked up —
    // it cannot be conditional on how big the source turns out to be.
    expect(() => ListRowsSchema.parse({ limit: 50_001 })).toThrow();
    expect(() => ListRowsSchema.parse({ limit: 50_000 })).not.toThrow();
  });

  it('parses a comma-separated tags query param into an array', () => {
    expect(ListRowsSchema.parse({ tags: 'TI-101,FI-404' }).tags).toEqual([
      'TI-101',
      'FI-404',
    ]);
    expect(ListRowsSchema.parse({}).tags).toBeUndefined();
  });

  it('treats an empty tags value as "no filter", not "zero tags"', () => {
    // Python reads `tags: undefined` as every tag; sending `[]` through
    // would silently produce a timestamp-only page instead. Pinned so a
    // future edit to either the transform or the `query.tags &&` guard in
    // the service cannot quietly flip which value means "all".
    expect(ListRowsSchema.parse({ tags: '' }).tags).toBeUndefined();
  });
});

describe('DatasetDraftAuthorizedService — tag catalog (DS-LAKE-005B-A-T03)', () => {
  beforeEach(() => jest.clearAllMocks());

  const OBJECT_KEY = 'drafts/draft-1/artifacts/artifact-1/data.parquet';

  it('forwards search/offset/limit to Python and returns the page', async () => {
    post.mockResolvedValueOnce({
      source_key: OBJECT_KEY,
      total_count: 2,
      offset: 0,
      search: 'ti-1',
      tags: ['TI-101', 'TI-102'],
    });
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst.mockResolvedValue({
      objectKey: OBJECT_KEY,
    });
    const { service } = makeService(prisma);

    const res = await service.getDraftArtifactTagCatalogService(
      USER,
      'draft-1',
      'artifact-1',
      { offset: 0, limit: 100, search: 'ti-1' },
    );

    const [, body] = post.mock.calls[0];
    expect(body).toEqual({
      source_key: OBJECT_KEY,
      offset: 0,
      limit: 100,
      search: 'ti-1',
    });
    expect(res.data).toEqual({
      totalCount: 2,
      offset: 0,
      search: 'ti-1',
      tags: ['TI-101', 'TI-102'],
    });
  });

  it('omits search from the Python call when not supplied', async () => {
    post.mockResolvedValueOnce({
      source_key: OBJECT_KEY,
      total_count: 5,
      offset: 0,
      search: null,
      tags: ['FI-404'],
    });
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst.mockResolvedValue({
      objectKey: OBJECT_KEY,
    });
    const { service } = makeService(prisma);

    await service.getDraftArtifactTagCatalogService(
      USER,
      'draft-1',
      'artifact-1',
      {
        offset: 0,
        limit: 100,
      },
    );

    const [, body] = post.mock.calls[0];
    expect(body).toEqual({ source_key: OBJECT_KEY, offset: 0, limit: 100 });
  });

  it('404s the tag catalog for an artifact that does not belong to this draft', async () => {
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst.mockResolvedValue(null);
    const { service } = makeService(prisma);

    await expect(
      service.getDraftArtifactTagCatalogService(USER, 'draft-1', 'not-mine', {
        offset: 0,
        limit: 100,
      }),
    ).rejects.toThrow(AppException);
    expect(post).not.toHaveBeenCalled();
  });

  it('rejects a limit over 5,000, a SEPARATE ceiling from ListRowsSchema', () => {
    expect(() => TagCatalogSchema.parse({ limit: 5_001 })).toThrow();
    expect(() => TagCatalogSchema.parse({ limit: 5_000 })).not.toThrow();
  });

  it('treats an empty search value as "no filter", matching Python\'s falsy check', async () => {
    // Empty string is falsy in NestJS's `query.search && {...}` guard AND in
    // Python's `if request.search:`, so both sides already agree — pinned at
    // the SERVICE boundary (not just the schema) so a future edit to either
    // guard cannot quietly split what "no filter" means between them.
    post.mockResolvedValueOnce({
      source_key: OBJECT_KEY,
      total_count: 5,
      offset: 0,
      search: null,
      tags: ['FI-404'],
    });
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst.mockResolvedValue({
      objectKey: OBJECT_KEY,
    });
    const { service } = makeService(prisma);

    await service.getDraftArtifactTagCatalogService(
      USER,
      'draft-1',
      'artifact-1',
      {
        offset: 0,
        limit: 100,
        search: TagCatalogSchema.parse({ search: '' }).search,
      },
    );

    const [, body] = post.mock.calls[0];
    expect(body).toEqual({ source_key: OBJECT_KEY, offset: 0, limit: 100 });
  });
});

describe('DatasetDraftAuthorizedService — draft-owned jobs', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates a cleaning job with draftId set and no datasetId', async () => {
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst.mockResolvedValue({ id: 'artifact-1' });
    const { service, jobs } = makeService(prisma);

    await service.startDraftCleanJobService(USER, 'draft-1', 'artifact-1', {
      operations: [{ type: 'drop_missing' }],
      precision: {},
    });

    const call = firstCreateArg(prisma.preprocessingJob.create);
    expect(call.data.draftId).toBe('draft-1');
    expect(call.data.datasetId).toBeUndefined();
    expect(call.data.sourceArtifactId).toBe('artifact-1');
    expect(jobs.start).toHaveBeenCalledWith('job-1');
  });

  it('404s when the source artifact does not belong to this draft', async () => {
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst.mockResolvedValue(null);
    const { service } = makeService(prisma);

    await expect(
      service.startDraftCleanJobService(USER, 'draft-1', 'not-mine', {
        operations: [{ type: 'drop_missing' }],
        precision: {},
      }),
    ).rejects.toThrow(AppException);
  });

  it('retry carries sourceArtifactId forward, not just sourceVersionId', async () => {
    const prisma = buildPrisma();
    prisma.preprocessingJob.findFirst.mockResolvedValue({
      id: 'job-old',
      status: 'FAILED',
      sourceArtifactId: 'artifact-1',
      sourceVersionId: null,
      stage: 'CLEAN',
      totalSteps: 1,
      operations: { operations: [{ type: 'drop_missing' }], precision: {} },
      attempts: 1,
    });
    const { service, jobs } = makeService(prisma);

    await service.retryDraftJobService(USER, 'draft-1', 'job-old');

    const call = firstCreateArg(prisma.preprocessingJob.create);
    expect(call.data.sourceArtifactId).toBe('artifact-1');
    expect(call.data.draftId).toBe('draft-1');
    expect(jobs.start).toHaveBeenCalledWith('job-1');
  });
});
