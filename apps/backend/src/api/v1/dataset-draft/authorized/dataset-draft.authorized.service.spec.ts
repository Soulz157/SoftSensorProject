import { AppException } from '@softsensor/common';
import {
  postBinaryToPython,
  postToPython,
  PYTHON_TIMEOUT,
} from '@/lib/python-client';
import { DatasetDraftAuthorizedService } from './dataset-draft.authorized.service';
import type { PreprocessingJobService } from '../../dataset-version/authorized/preprocessing-job.service';
import type { LoaderJobService } from '../../loader/loader-job.service';
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
    datasetArtifact: {
      create: artifactCreate,
      update: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...data }),
        ),
    },
    datasetDraft: { update: jest.fn().mockResolvedValue(DRAFT) },
    dataset: {
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'dataset-1', ...data }),
        ),
      update: jest.fn(),
    },
    datasetVersion: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'version-1', ...data }),
        ),
    },
  };
  return {
    datasetDraft: {
      findFirst: jest.fn().mockResolvedValue(DRAFT),
      create: jest.fn().mockResolvedValue(DRAFT),
      update: jest.fn().mockResolvedValue(DRAFT),
      // DS-LAKE-014-T04: touchDraftService's own write. Defaults to "the
      // filter matched" so tests that don't care about the heartbeat are
      // unaffected by its presence.
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    dataSource: {
      findFirst: jest.fn().mockResolvedValue(SOURCE),
    },
    datasetArtifact: {
      findFirst: jest.fn(),
      findUnique: jest.fn().mockResolvedValue(null),
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
    // Exposed so a test can inspect exactly what a transaction wrote
    // (`create.mock.calls[0][0].data`) without re-deriving it from the
    // service's own (deliberately slim, Bronze-shaped) response.
    _tx: tx,
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
  const loaderJobs = {
    enqueue: jest.fn().mockResolvedValue('loader-job-1'),
    start: jest.fn(),
    retry: jest.fn(),
    getStatus: jest.fn(),
  };
  const service = new DatasetDraftAuthorizedService(
    prisma as unknown as ConstructorParameters<
      typeof DatasetDraftAuthorizedService
    >[0],
    jobs as unknown as PreprocessingJobService,
    loaderJobs as unknown as LoaderJobService,
  );
  return { service, jobs, loaderJobs };
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

const BRONZE_ROOT = {
  id: 'bronze-1',
  draftId: 'draft-1',
  runId: 'run-1',
  parentArtifactId: null,
  type: 'BRONZE',
  objectKey: 'drafts/draft-1/artifacts/bronze-1/data.parquet',
  checksum: 'c'.repeat(64),
  rowCount: 100,
  columnCount: 4,
  missingPct: 0,
  validationRowCount: null,
};

const SILVER_FOR_WALK = {
  id: 'silver-1',
  draftId: 'draft-1',
  runId: 'run-1',
  parentArtifactId: 'bronze-1',
  type: 'SILVER',
  objectKey: 'drafts/draft-1/artifacts/silver-1/data.parquet',
  checksum: 'b'.repeat(64),
  rowCount: 40,
  columnCount: 4,
  missingPct: 2.5,
  validationRowCount: null,
};

describe('DatasetDraftAuthorizedService — resplit holdout (DS-LAKE-018-T06)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('refuses when the draft is not found, without ever resolving an artifact', async () => {
    const prisma = buildPrisma();
    prisma.datasetDraft.findFirst.mockResolvedValueOnce(null);
    const { service } = makeService(prisma);

    await expect(
      service.resplitDraftHoldoutService(USER, 'draft-missing', {
        holdout: { from: '2026-01-01', to: '2026-01-02' },
      }),
    ).rejects.toThrow(AppException);

    expect(prisma.datasetArtifact.findFirst).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it('refuses when the draft has no artifact yet', async () => {
    const prisma = buildPrisma();
    prisma.datasetDraft.findFirst.mockResolvedValueOnce({
      ...DRAFT,
      currentArtifactId: null,
    });
    const { service } = makeService(prisma);

    await expect(
      service.resplitDraftHoldoutService(USER, 'draft-1', {
        holdout: { from: '2026-01-01', to: '2026-01-02' },
      }),
    ).rejects.toThrow(AppException);

    expect(post).not.toHaveBeenCalled();
  });

  it('walks up from a non-root artifact to resolve the BRONZE root, and reads FROM it', async () => {
    const prisma = buildPrisma();
    prisma.datasetDraft.findFirst.mockResolvedValueOnce({
      ...DRAFT,
      currentArtifactId: 'silver-1',
    });
    prisma.datasetArtifact.findFirst
      .mockResolvedValueOnce(SILVER_FOR_WALK)
      .mockResolvedValueOnce(BRONZE_ROOT);
    post.mockResolvedValueOnce({
      object_key: 'drafts/draft-1/artifacts/bronze-2/data.parquet',
      row_count: 88,
      column_count: 4,
      size_bytes: 900,
      missing_pct: 0,
      checksum: 'd'.repeat(64),
      duration_ms: 5,
      validation_row_count: 12,
      validation_holdout_from: '2026-01-11 00:00:00',
    });
    const { service } = makeService(prisma);

    await service.resplitDraftHoldoutService(USER, 'draft-1', {
      holdout: { from: '2026-01-11', to: '2026-01-13' },
    });

    const [, body] = post.mock.calls[0];
    expect((body as { source_key: string }).source_key).toBe(
      BRONZE_ROOT.objectKey,
    );
  });

  it('refuses (422) to re-split a root that was already split at materialize time', async () => {
    const prisma = buildPrisma();
    prisma.datasetDraft.findFirst.mockResolvedValueOnce({
      ...DRAFT,
      currentArtifactId: 'bronze-1',
    });
    prisma.datasetArtifact.findFirst.mockResolvedValueOnce({
      ...BRONZE_ROOT,
      validationRowCount: 30, // already split — a legacy/pre-task artifact
    });
    const { service } = makeService(prisma);

    await expect(
      service.resplitDraftHoldoutService(USER, 'draft-1', {
        holdout: { from: '2026-01-11', to: '2026-01-13' },
      }),
    ).rejects.toThrow(AppException);

    expect(post).not.toHaveBeenCalled();
  });

  it('holdout: null clears the holdout by pointing the draft back at its pristine root, without calling Python', async () => {
    const prisma = buildPrisma();
    prisma.datasetDraft.findFirst.mockResolvedValueOnce({
      ...DRAFT,
      currentArtifactId: 'bronze-1',
    });
    prisma.datasetArtifact.findFirst.mockResolvedValueOnce(BRONZE_ROOT);
    const { service } = makeService(prisma);

    const res = await service.resplitDraftHoldoutService(USER, 'draft-1', {
      holdout: null,
    });

    expect(post).not.toHaveBeenCalled();
    expect(res.data.id).toBe(BRONZE_ROOT.id);
    expect(prisma.datasetDraft.update).toHaveBeenCalledWith({
      where: { id: 'draft-1' },
      data: { currentArtifactId: BRONZE_ROOT.id },
    });
  });

  it('writes the new BRONZE with parentArtifactId set to the pristine root, and moves currentArtifactId to it', async () => {
    const prisma = buildPrisma();
    prisma.datasetDraft.findFirst.mockResolvedValueOnce({
      ...DRAFT,
      currentArtifactId: 'bronze-1',
    });
    prisma.datasetArtifact.findFirst.mockResolvedValueOnce(BRONZE_ROOT);
    post.mockResolvedValueOnce({
      object_key: 'drafts/draft-1/artifacts/bronze-2/data.parquet',
      row_count: 88,
      column_count: 4,
      size_bytes: 900,
      missing_pct: 0,
      checksum: 'd'.repeat(64),
      duration_ms: 5,
      validation_row_count: 12,
      validation_holdout_from: '2026-01-11 00:00:00',
    });
    const { service } = makeService(prisma);

    const res = await service.resplitDraftHoldoutService(USER, 'draft-1', {
      holdout: { from: '2026-01-11', to: '2026-01-13' },
    });

    const created = firstCreateArg(prisma._tx.datasetArtifact.create).data;
    expect(created.parentArtifactId).toBe(BRONZE_ROOT.id);
    expect(created.runId).toBe(BRONZE_ROOT.runId);
    expect(created.type).toBe('BRONZE');
    expect(created.validationRowCount).toBe(12);
    expect(created.validationHoldoutFrom).toEqual(
      new Date('2026-01-11 00:00:00'),
    );
    expect(prisma._tx.datasetDraft.update).toHaveBeenCalledWith({
      where: { id: 'draft-1' },
      data: { currentArtifactId: created.id },
    });
    expect(res.statusCode).toBe(201);
    expect(res.data.validationRowCount).toBe(12);
  });
});

const SILVER_ARTIFACT = {
  id: 'silver-1',
  draftId: 'draft-1',
  runId: 'run-1',
  parentArtifactId: 'bronze-1',
  type: 'SILVER',
  objectKey: 'drafts/draft-1/artifacts/silver-1/data.parquet',
  checksum: 'b'.repeat(64),
  rowCount: 40,
  columnCount: 4,
  missingPct: 2.5,
  sizeBytes: BigInt(2048),
  operations: [],
};

describe('DatasetDraftAuthorizedService — features (DS-LAKE-006-T06)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('404s when the source artifact does not exist in this draft, before calling Python', async () => {
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst.mockResolvedValue(null);
    const { service } = makeService(prisma);

    await expect(
      service.createDraftFeaturesArtifactService(USER, 'draft-1', 'ghost-id', {
        features: [],
        scalers: {},
      }),
    ).rejects.toThrow(AppException);

    expect(post).not.toHaveBeenCalled();
  });

  it('produces a GOLD artifact whose parentArtifactId is the source and whose runId continues the source chain', async () => {
    post.mockResolvedValueOnce({
      object_key: 'drafts/draft-1/artifacts/gold-1/data.parquet',
      row_count: 40,
      column_count: 5,
      size_bytes: 3000,
      missing_pct: 2.5,
      checksum: 'c'.repeat(64),
      duration_ms: 9,
      feature_spec_key: 'drafts/draft-1/artifacts/gold-1/feature_spec.json',
    });
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst.mockResolvedValue(SILVER_ARTIFACT);
    const { service } = makeService(prisma);

    const res = await service.createDraftFeaturesArtifactService(
      USER,
      'draft-1',
      'silver-1',
      {
        features: [{ id: 'f1', kind: 'lag', tag: 'TI-101', k: 1 }],
        scalers: { 'TI-101': 'minmax' },
      },
    );

    expect(res.data.type).toBe('GOLD');
    // runId continues the SILVER source's own chain — a GOLD write is NOT a
    // lineage root, unlike a fresh BRONZE materialize, which mints its own.
    expect(res.data.runId).toBe(SILVER_ARTIFACT.runId);
    expect(res.data.parentArtifactId).toBe('silver-1');
    expect(res.data.featureSpecKey).toBe(
      'drafts/draft-1/artifacts/gold-1/feature_spec.json',
    );

    const [, body] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(body.source_key).toBe(SILVER_ARTIFACT.objectKey);
  });

  it("sends the source artifact's objectKey as source_key and a fresh drafts/-scoped target_key", async () => {
    post.mockResolvedValueOnce({
      object_key: 'drafts/draft-1/artifacts/gold-2/data.parquet',
      row_count: 40,
      column_count: 4,
      size_bytes: 2900,
      missing_pct: 2.5,
      checksum: 'd'.repeat(64),
      duration_ms: 7,
      feature_spec_key: 'drafts/draft-1/artifacts/gold-2/feature_spec.json',
    });
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst.mockResolvedValue(SILVER_ARTIFACT);
    const { service } = makeService(prisma);

    await service.createDraftFeaturesArtifactService(
      USER,
      'draft-1',
      'silver-1',
      {
        features: [],
        selectedColumns: ['TI-101'],
        scalers: {},
      },
    );

    const [, body] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(body.source_key).toBe(SILVER_ARTIFACT.objectKey);
    expect(body.target_key).toContain('drafts/draft-1/artifacts/');
    expect(body.target_key).not.toBe(SILVER_ARTIFACT.objectKey);
    expect(body.selectedColumns).toEqual(['TI-101']);
  });

  it('persists operations (the feature recipe) and a null columnStatsKey on the created row', async () => {
    post.mockResolvedValueOnce({
      object_key: 'drafts/draft-1/artifacts/gold-3/data.parquet',
      row_count: 40,
      column_count: 4,
      size_bytes: 2900,
      missing_pct: 2.5,
      checksum: 'e'.repeat(64),
      duration_ms: 6,
      feature_spec_key: 'drafts/draft-1/artifacts/gold-3/feature_spec.json',
    });
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst.mockResolvedValue(SILVER_ARTIFACT);
    const { service } = makeService(prisma);
    const features = [{ id: 'f1', kind: 'lag' as const, tag: 'TI-101', k: 2 }];

    await service.createDraftFeaturesArtifactService(
      USER,
      'draft-1',
      'silver-1',
      {
        features,
        scalers: {},
      },
    );

    // column_stats.json is a cleaning-op concern (drift/coverage/outlier);
    // /features has nothing to compute it from, so it must stay null rather
    // than silently carrying over the SILVER source's own value.
    const created = firstCreateArg(prisma._tx.datasetArtifact.create);
    expect(created.data.operations).toEqual(features);
    expect(created.data.columnStatsKey).toBeNull();
    expect(created.data.type).toBe('GOLD');
    expect(created.data.parentArtifactId).toBe('silver-1');
  });
});

const VALIDATION_REPORT = {
  status: 'PASS' as const,
  quality_score: 100,
  checks: [
    {
      name: 'schema',
      passed: true,
      skipped: false,
      detail: 'ok',
      offenders: [],
      severity: 'blocking' as const,
    },
  ],
  failed_checks: [],
  advisory_failures: [] as string[],
  validation_report_key:
    'drafts/draft-1/artifacts/gold-1/validation_report.json',
};

describe('DatasetDraftAuthorizedService — validation (DS-LAKE-007-T04)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('404s when the artifact does not exist in this draft, before calling Python', async () => {
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst.mockResolvedValue(null);
    const { service } = makeService(prisma);

    await expect(
      service.validateDraftArtifactService(USER, 'draft-1', 'ghost-id', {}),
    ).rejects.toThrow(AppException);

    expect(post).not.toHaveBeenCalled();
  });

  it('creates no DatasetArtifact row — thin endpoint, response passed straight through', async () => {
    post.mockResolvedValueOnce(VALIDATION_REPORT);
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst.mockResolvedValue({
      objectKey: 'drafts/draft-1/artifacts/gold-1/data.parquet',
      featureSpecKey: null,
    });
    const { service } = makeService(prisma);

    const res = await service.validateDraftArtifactService(
      USER,
      'draft-1',
      'gold-1',
      {},
    );

    expect(res.data).toEqual(VALIDATION_REPORT);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma._tx.datasetArtifact.create).not.toHaveBeenCalled();
  });

  it("uses the artifact's OWN featureSpecKey automatically, not a caller-supplied one", async () => {
    post.mockResolvedValueOnce(VALIDATION_REPORT);
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst.mockResolvedValue({
      objectKey: 'drafts/draft-1/artifacts/gold-1/data.parquet',
      featureSpecKey: 'drafts/draft-1/artifacts/gold-1/feature_spec.json',
    });
    const { service } = makeService(prisma);

    await service.validateDraftArtifactService(USER, 'draft-1', 'gold-1', {});

    const [, body] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(body.feature_spec_key).toBe(
      'drafts/draft-1/artifacts/gold-1/feature_spec.json',
    );
  });

  it('omits feature_spec_key entirely for a BRONZE/SILVER artifact with none', async () => {
    post.mockResolvedValueOnce(VALIDATION_REPORT);
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst.mockResolvedValue({
      objectKey: 'drafts/draft-1/artifacts/silver-1/data.parquet',
      featureSpecKey: null,
    });
    const { service } = makeService(prisma);

    await service.validateDraftArtifactService(USER, 'draft-1', 'silver-1', {});

    const [, body] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect('feature_spec_key' in body).toBe(false);
  });

  it('forwards expectedTags/maxMissingPct/maxOutlierFraction to Python in snake_case', async () => {
    post.mockResolvedValueOnce(VALIDATION_REPORT);
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst.mockResolvedValue({
      objectKey: 'drafts/draft-1/artifacts/gold-1/data.parquet',
      featureSpecKey: null,
    });
    const { service } = makeService(prisma);

    await service.validateDraftArtifactService(USER, 'draft-1', 'gold-1', {
      expectedTags: ['TI-101'],
      maxMissingPct: 5,
      maxOutlierFraction: 0.02,
    });

    const [, body] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(body.expected_tags).toEqual(['TI-101']);
    expect(body.max_missing_pct).toBe(5);
    expect(body.max_outlier_fraction).toBe(0.02);
  });
});

const GOLD_ARTIFACT = {
  id: 'gold-1',
  draftId: 'draft-1',
  runId: 'run-1',
  parentArtifactId: 'silver-1',
  type: 'GOLD',
  objectKey: 'drafts/draft-1/artifacts/gold-1/data.parquet',
  checksum: 'g'.repeat(64),
  rowCount: 40,
  columnCount: 5,
  missingPct: 1.2,
  sizeBytes: BigInt(4096),
  operations: [{ id: 'f1', kind: 'lag', tag: 'TI-101', k: 1 }],
  columnStatsKey: null,
  featureSpecKey: 'drafts/draft-1/artifacts/gold-1/feature_spec.json',
};

describe('DatasetDraftAuthorizedService — promote to FINAL (DS-LAKE-009-T01)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('404s when the source artifact does not exist in this draft, before calling Python', async () => {
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst.mockResolvedValue(null);
    const { service } = makeService(prisma);

    await expect(
      service.promoteDraftArtifactToFinalService(
        USER,
        'draft-1',
        'ghost-id',
        {},
      ),
    ).rejects.toThrow(AppException);

    expect(post).not.toHaveBeenCalled();
  });

  it('re-validates the source itself, using its OWN featureSpecKey, rather than trusting a caller-supplied report', async () => {
    post.mockResolvedValueOnce(VALIDATION_REPORT);
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst.mockResolvedValue(GOLD_ARTIFACT);
    const { service } = makeService(prisma);

    await service.promoteDraftArtifactToFinalService(
      USER,
      'draft-1',
      'gold-1',
      {},
    );

    const [, body] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(body.source_key).toBe(GOLD_ARTIFACT.objectKey);
    expect(body.feature_spec_key).toBe(GOLD_ARTIFACT.featureSpecKey);
  });

  it('refuses (throws) and writes NO row when validation FAILS', async () => {
    post.mockResolvedValueOnce({
      ...VALIDATION_REPORT,
      status: 'FAIL',
      quality_score: 60,
      failed_checks: ['missing_values'],
    });
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst.mockResolvedValue(GOLD_ARTIFACT);
    const { service } = makeService(prisma);

    await expect(
      service.promoteDraftArtifactToFinalService(USER, 'draft-1', 'gold-1', {}),
    ).rejects.toThrow(AppException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma._tx.datasetArtifact.create).not.toHaveBeenCalled();
  });

  it('promotes on PASS: FINAL row shares the source objectKey/checksum verbatim — no byte copy', async () => {
    post.mockResolvedValueOnce(VALIDATION_REPORT);
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst.mockResolvedValue(GOLD_ARTIFACT);
    const { service } = makeService(prisma);

    const res = await service.promoteDraftArtifactToFinalService(
      USER,
      'draft-1',
      'gold-1',
      {},
    );

    expect(res.data.type).toBe('FINAL');
    expect(res.data.parentArtifactId).toBe('gold-1');
    expect(res.data.runId).toBe(GOLD_ARTIFACT.runId);
    expect(res.data.checksum).toBe(GOLD_ARTIFACT.checksum);
    expect(res.data.validationKey).toBe(
      VALIDATION_REPORT.validation_report_key,
    );
    expect(res.data.featureSpecKey).toBe(GOLD_ARTIFACT.featureSpecKey);

    const created = firstCreateArg(prisma._tx.datasetArtifact.create);
    expect(created.data.objectKey).toBe(GOLD_ARTIFACT.objectKey);
    expect(created.data.checksum).toBe(GOLD_ARTIFACT.checksum);
    expect(created.data.rowCount).toBe(GOLD_ARTIFACT.rowCount);
    expect(created.data.sizeBytes).toBe(GOLD_ARTIFACT.sizeBytes);
    expect(created.data.operations).toEqual([]);
    expect(created.data.validationKey).toBe(
      VALIDATION_REPORT.validation_report_key,
    );
    // No Dataset exists yet — adoption is DS-LAKE-009-T02's job, not T01's.
    expect('datasetId' in created.data).toBe(false);
  });

  it("updates the draft's currentArtifactId to point at the new FINAL artifact", async () => {
    post.mockResolvedValueOnce(VALIDATION_REPORT);
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst.mockResolvedValue(GOLD_ARTIFACT);
    const { service } = makeService(prisma);

    await service.promoteDraftArtifactToFinalService(
      USER,
      'draft-1',
      'gold-1',
      {},
    );

    expect(prisma._tx.datasetDraft.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'draft-1' },
        data: expect.objectContaining({
          currentArtifactId: expect.any(String),
        }),
      }),
    );
  });

  it('forwards expectedTags/maxMissingPct/maxOutlierFraction overrides to the re-validation call', async () => {
    post.mockResolvedValueOnce(VALIDATION_REPORT);
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst.mockResolvedValue(GOLD_ARTIFACT);
    const { service } = makeService(prisma);

    await service.promoteDraftArtifactToFinalService(
      USER,
      'draft-1',
      'gold-1',
      { expectedTags: ['TI-101'], maxMissingPct: 5, maxOutlierFraction: 0.02 },
    );

    const [, body] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(body.expected_tags).toEqual(['TI-101']);
    expect(body.max_missing_pct).toBe(5);
    expect(body.max_outlier_fraction).toBe(0.02);
  });
});

const BRONZE_ARTIFACT = {
  id: 'bronze-1',
  draftId: 'draft-1',
  runId: 'run-1',
  parentArtifactId: null,
  type: 'BRONZE',
  objectKey: 'drafts/draft-1/artifacts/bronze-1/data.parquet',
  checksum: 'b'.repeat(64),
  schemaVersion: 1,
  rowCount: 40,
  columnCount: 5,
  featureCount: 0,
  missingPct: 2.0,
  sizeBytes: BigInt(2048),
  featureSpecKey: null,
};

const T02_SILVER_ARTIFACT = {
  id: 'silver-1',
  draftId: 'draft-1',
  runId: 'run-1',
  parentArtifactId: 'bronze-1',
  type: 'SILVER',
  objectKey: 'drafts/draft-1/artifacts/silver-1/data.parquet',
  checksum: 's'.repeat(64),
  schemaVersion: 1,
  rowCount: 40,
  columnCount: 5,
  featureCount: 0,
  missingPct: 1.5,
  sizeBytes: BigInt(3072),
  featureSpecKey: null,
};

const FINAL_ARTIFACT = {
  id: 'final-1',
  draftId: 'draft-1',
  runId: 'run-1',
  parentArtifactId: 'gold-1',
  type: 'FINAL',
  objectKey: 'drafts/draft-1/artifacts/final-1/data.parquet',
  checksum: 'f'.repeat(64),
  schemaVersion: 1,
  rowCount: 40,
  columnCount: 5,
  featureCount: 3,
  missingPct: 1.2,
  sizeBytes: BigInt(4096),
  featureSpecKey: 'drafts/draft-1/artifacts/gold-1/feature_spec.json',
  validationKey: 'drafts/draft-1/artifacts/final-1/validation_report.json',
};

const ARTIFACT_CHAIN: Record<string, unknown> = {
  'bronze-1': BRONZE_ARTIFACT,
  'silver-1': T02_SILVER_ARTIFACT,
  'gold-1': GOLD_ARTIFACT,
};

/** DS-LAKE-005B-B-T01 (Step 5 leg). `schemas.preprocess.MetadataResponse`
 * shape — what `saveDraftAsDatasetService` parses via `PythonMetadataSchema`
 * when `dto.tags` is omitted and it derives the real tag list from the
 * FINAL artifact's own footer instead. */
const PYTHON_METADATA_FOR_SAVE = {
  source_key: FINAL_ARTIFACT.objectKey,
  tags: ['TI-101', 'TI-102', 'FI-201'],
  column_count: 7,
  row_count: FINAL_ARTIFACT.rowCount,
  start_time: '2026-01-01T00:00:00Z',
  end_time: '2026-01-02T00:00:00Z',
};

describe('DatasetDraftAuthorizedService — save draft as Dataset (DS-LAKE-009-T02)', () => {
  beforeEach(() => jest.clearAllMocks());

  function chainedPrisma() {
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst.mockResolvedValue(FINAL_ARTIFACT);
    prisma.datasetArtifact.findUnique.mockImplementation(
      ({ where: { id } }: { where: { id: string } }) =>
        Promise.resolve(ARTIFACT_CHAIN[id] ?? null),
    );
    return prisma;
  }

  it('422s when the draft has no FINAL artifact, before calling Python or opening a transaction', async () => {
    const prisma = buildPrisma();
    prisma.datasetArtifact.findFirst.mockResolvedValue(null);
    const { service } = makeService(prisma);

    await expect(
      service.saveDraftAsDatasetService(USER, 'draft-1', {
        name: 'ds',
      } as never),
    ).rejects.toThrow(AppException);

    expect(post).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('looks up the FINAL artifact explicitly, not draft.currentArtifactId', async () => {
    const prisma = chainedPrisma();
    post.mockResolvedValueOnce(VALIDATION_REPORT);
    const { service } = makeService(prisma);

    await service.saveDraftAsDatasetService(USER, 'draft-1', {
      name: 'ds',
      tags: ['TI-101'],
    } as never);

    expect(prisma.datasetArtifact.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { draftId: 'draft-1', type: 'FINAL' } }),
    );
  });

  it('refuses (422) and writes NO row when the fresh Save-time validation FAILs', async () => {
    const prisma = chainedPrisma();
    post.mockResolvedValueOnce({
      ...VALIDATION_REPORT,
      status: 'FAIL',
      quality_score: 55,
      failed_checks: ['missing_values'],
    });
    const { service } = makeService(prisma);

    await expect(
      service.saveDraftAsDatasetService(USER, 'draft-1', {
        name: 'ds',
      } as never),
    ).rejects.toThrow(AppException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma._tx.dataset.create).not.toHaveBeenCalled();
  });

  it('DS-LAKE-019-T05: freezes only the ADVISORY-failed checks onto the new DatasetVersion, and still saves', async () => {
    const prisma = chainedPrisma();
    post.mockResolvedValueOnce({
      ...VALIDATION_REPORT,
      // A PASS report whose only failure is advisory — the exact case
      // this task exists for. Must save (status is still PASS) and must
      // persist the advisory-failed check, not the passing blocking one.
      checks: [
        VALIDATION_REPORT.checks[0], // schema: passed, blocking
        {
          name: 'statistical',
          passed: false,
          skipped: false,
          detail: '2 tag(s) over the outlier-fraction threshold.',
          measured: 18.1,
          threshold: 10,
          offenders: ['TI-101', 'TI-207'],
          severity: 'advisory' as const,
        },
      ],
      failed_checks: ['statistical'],
      advisory_failures: ['statistical'],
    });
    const { service } = makeService(prisma);

    await service.saveDraftAsDatasetService(USER, 'draft-1', {
      name: 'My Dataset',
      tags: ['TI-101'],
    } as never);

    expect(prisma._tx.dataset.create).toHaveBeenCalledTimes(1);
    const versionArg = firstCreateArg(prisma._tx.datasetVersion.create);
    expect(versionArg.data.validationAdvisory).toEqual([
      {
        name: 'statistical',
        detail: '2 tag(s) over the outlier-fraction threshold.',
        measured: 18.1,
        threshold: 10,
        offenders: ['TI-101', 'TI-207'],
      },
    ]);
  });

  it('creates exactly one Dataset and one DatasetVersion inside a single $transaction', async () => {
    const prisma = chainedPrisma();
    post.mockResolvedValueOnce(VALIDATION_REPORT);
    const { service } = makeService(prisma);

    await service.saveDraftAsDatasetService(USER, 'draft-1', {
      name: 'My Dataset',
      tags: ['TI-101'],
    } as never);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma._tx.dataset.create).toHaveBeenCalledTimes(1);
    expect(prisma._tx.datasetVersion.create).toHaveBeenCalledTimes(1);

    const versionArg = firstCreateArg(prisma._tx.datasetVersion.create);
    expect(versionArg.data).toMatchObject({
      artifactId: FINAL_ARTIFACT.id,
      checksum: FINAL_ARTIFACT.checksum,
      schemaVersion: FINAL_ARTIFACT.schemaVersion,
      rowCount: FINAL_ARTIFACT.rowCount,
      featureCount: FINAL_ARTIFACT.featureCount,
      qualityScore: VALIDATION_REPORT.quality_score,
      status: 'DRAFT',
      versionNumber: 1,
      semanticVersion: '1.0.0',
    });
  });

  it('DS-LAKE-011-T03: enqueues the loader job AFTER the transaction resolves, with the committed dataset/version ids', async () => {
    const prisma = chainedPrisma();
    post.mockResolvedValueOnce(VALIDATION_REPORT);
    const { service, loaderJobs } = makeService(prisma);

    const callOrder: string[] = [];
    prisma.$transaction.mockImplementationOnce(
      async (fn: (tx: unknown) => unknown) => {
        const result = await fn(prisma._tx);
        callOrder.push('transaction');
        return result;
      },
    );
    loaderJobs.enqueue.mockImplementationOnce(async () => {
      callOrder.push('enqueue');
      return 'loader-job-1';
    });

    await service.saveDraftAsDatasetService(USER, 'draft-1', {
      name: 'ds',
      tags: ['TI-101'],
    } as never);

    expect(loaderJobs.enqueue).toHaveBeenCalledWith(
      'dataset-1',
      'version-1',
      USER.id,
    );
    expect(callOrder).toEqual(['transaction', 'enqueue']);
  });

  it('adopts the FINAL artifact by pointer: datasetId set, draftId untouched (still passed through create args)', async () => {
    const prisma = chainedPrisma();
    post.mockResolvedValueOnce(VALIDATION_REPORT);
    const { service } = makeService(prisma);

    await service.saveDraftAsDatasetService(USER, 'draft-1', {
      name: 'ds',
      tags: ['TI-101'],
    } as never);

    expect(prisma._tx.datasetArtifact.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: FINAL_ARTIFACT.id },
        data: { datasetId: 'dataset-1' },
      }),
    );
  });

  it('DS-LAKE-017-T01: adopts the lineage-root BRONZE too, by pointer, ONE POINTER NOT TWO — currentArtifactId still resolves to FINAL only', async () => {
    const prisma = chainedPrisma();
    post.mockResolvedValueOnce(VALIDATION_REPORT);
    const { service } = makeService(prisma);

    await service.saveDraftAsDatasetService(USER, 'draft-1', {
      name: 'ds',
      tags: ['TI-101'],
    } as never);

    expect(prisma._tx.datasetArtifact.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'bronze-1' },
        data: { datasetId: 'dataset-1' },
      }),
    );
    // The "one pointer, not two" half of AC1 — Dataset.currentArtifactId
    // still resolves to FINAL only, never the adopted BRONZE — is asserted
    // by the very next test below (currentArtifactId: FINAL_ARTIFACT.id).
  });

  it('sets Dataset.currentArtifactId/currentVersionId and DatasetDraft.savedDatasetId/status atomically', async () => {
    const prisma = chainedPrisma();
    post.mockResolvedValueOnce(VALIDATION_REPORT);
    const { service } = makeService(prisma);

    await service.saveDraftAsDatasetService(USER, 'draft-1', {
      name: 'ds',
      tags: ['TI-101'],
    } as never);

    expect(prisma._tx.dataset.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'dataset-1' },
        data: {
          currentArtifactId: FINAL_ARTIFACT.id,
          currentVersionId: 'version-1',
        },
      }),
    );
    expect(prisma._tx.datasetDraft.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'draft-1' },
        data: { savedDatasetId: 'dataset-1', status: 'SAVED' },
      }),
    );
  });

  it('freezes the full BRONZE -> SILVER -> GOLD -> FINAL lineage, root-first', async () => {
    const prisma = chainedPrisma();
    post.mockResolvedValueOnce(VALIDATION_REPORT);
    const { service } = makeService(prisma);

    await service.saveDraftAsDatasetService(USER, 'draft-1', {
      name: 'ds',
      tags: ['TI-101'],
    } as never);

    const versionArg = firstCreateArg(prisma._tx.datasetVersion.create);
    const lineage = versionArg.data.lineage as Array<{
      id: string;
      type: string;
    }>;
    expect(lineage.map((l) => l.id)).toEqual([
      'bronze-1',
      'silver-1',
      'gold-1',
      'final-1',
    ]);
    expect(lineage.map((l) => l.type)).toEqual([
      'BRONZE',
      'SILVER',
      'GOLD',
      'FINAL',
    ]);
  });

  it('derives rowCount/missingPct on the Dataset from the FINAL artifact, not the request body', async () => {
    const prisma = chainedPrisma();
    post.mockResolvedValueOnce(VALIDATION_REPORT);
    const { service } = makeService(prisma);

    await service.saveDraftAsDatasetService(USER, 'draft-1', {
      name: 'ds',
      tags: ['TI-101'],
    } as never);

    const datasetArg = firstCreateArg(prisma._tx.dataset.create);
    expect(datasetArg.data.rowCount).toBe(FINAL_ARTIFACT.rowCount);
    expect(datasetArg.data.missingPct).toBe(FINAL_ARTIFACT.missingPct);
    expect(datasetArg.data.workspaceId).toBe(DRAFT.workspaceId);
    expect(datasetArg.data.sourceIds).toEqual(DRAFT.sourceIds);
  });

  it('409s a second save of an already-SAVED draft, before any lookup or Python call (DS-LAKE-009-T03)', async () => {
    const prisma = chainedPrisma();
    prisma.datasetDraft.findFirst.mockResolvedValue({
      ...DRAFT,
      status: 'SAVED',
      savedDatasetId: 'dataset-1',
    });
    const { service } = makeService(prisma);

    await expect(
      service.saveDraftAsDatasetService(USER, 'draft-1', {
        name: 'ds',
      } as never),
    ).rejects.toThrow(AppException);

    expect(prisma.datasetArtifact.findFirst).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('reads versionNumber inside the transaction via tx, not this.prisma, defaulting to 1 for a brand-new dataset', async () => {
    const prisma = chainedPrisma();
    post.mockResolvedValueOnce(VALIDATION_REPORT);
    const { service } = makeService(prisma);

    await service.saveDraftAsDatasetService(USER, 'draft-1', {
      name: 'ds',
      tags: ['TI-101'],
    } as never);

    expect(prisma._tx.datasetVersion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { datasetId: 'dataset-1' },
        orderBy: { versionNumber: 'desc' },
      }),
    );
    const versionArg = firstCreateArg(prisma._tx.datasetVersion.create);
    expect(versionArg.data.versionNumber).toBe(1);
    expect(versionArg.data.semanticVersion).toBe('1.0.0');
  });

  it('allocates the next versionNumber past whatever tx.datasetVersion.findFirst returns', async () => {
    const prisma = chainedPrisma();
    prisma._tx.datasetVersion.findFirst.mockResolvedValue({
      versionNumber: 4,
    });
    post.mockResolvedValueOnce(VALIDATION_REPORT);
    const { service } = makeService(prisma);

    await service.saveDraftAsDatasetService(USER, 'draft-1', {
      name: 'ds',
      tags: ['TI-101'],
    } as never);

    const versionArg = firstCreateArg(prisma._tx.datasetVersion.create);
    expect(versionArg.data.versionNumber).toBe(5);
    expect(versionArg.data.semanticVersion).toBe('5.0.0');
  });

  it('does not forward expectedTags/maxMissingPct/maxOutlierFraction overrides — Save re-checks, it does not let the caller configure the gate (DS-LAKE-009-T04)', async () => {
    const prisma = chainedPrisma();
    post.mockResolvedValueOnce(VALIDATION_REPORT);
    const { service } = makeService(prisma);

    await service.saveDraftAsDatasetService(USER, 'draft-1', {
      name: 'ds',
      tags: ['TI-101'],
      expectedTags: ['should-be-ignored'],
      maxMissingPct: 100,
      maxOutlierFraction: 1,
    } as never);

    const [, body] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(body).not.toHaveProperty('expected_tags');
    expect(body).not.toHaveProperty('max_missing_pct');
    expect(body).not.toHaveProperty('max_outlier_fraction');
  });

  it('fails closed when the re-validation call itself rejects — writes nothing', async () => {
    const prisma = chainedPrisma();
    post.mockRejectedValueOnce(new Error('python unreachable'));
    const { service } = makeService(prisma);

    await expect(
      service.saveDraftAsDatasetService(USER, 'draft-1', {
        name: 'ds',
      } as never),
    ).rejects.toThrow('python unreachable');

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma._tx.dataset.create).not.toHaveBeenCalled();
  });

  // DS-LAKE-005B-B-T01 (Step 5 leg). `tags` joins rowCount/missingPct as an
  // artifact-derived field: omitted by the caller, it comes from the FINAL
  // artifact's own Python `/metadata` read, not a client-computed list.
  it('derives tags from the FINAL artifact via Python /metadata when dto.tags is omitted', async () => {
    const prisma = chainedPrisma();
    post
      .mockResolvedValueOnce(VALIDATION_REPORT)
      .mockResolvedValueOnce(PYTHON_METADATA_FOR_SAVE);
    const { service } = makeService(prisma);

    await service.saveDraftAsDatasetService(USER, 'draft-1', {
      name: 'ds',
    } as never);

    expect(post).toHaveBeenNthCalledWith(
      2,
      '/v1/preprocess/metadata',
      { source_key: FINAL_ARTIFACT.objectKey },
      PYTHON_TIMEOUT.metadata,
    );
    const datasetArg = firstCreateArg(prisma._tx.dataset.create);
    expect(datasetArg.data.tags).toEqual(PYTHON_METADATA_FOR_SAVE.tags);
  });

  it('uses the caller-supplied tags list as-is when dto.tags is provided — no /metadata call', async () => {
    const prisma = chainedPrisma();
    post.mockResolvedValueOnce(VALIDATION_REPORT);
    const { service } = makeService(prisma);

    await service.saveDraftAsDatasetService(USER, 'draft-1', {
      name: 'ds',
      tags: ['TI-999'],
    } as never);

    expect(post).toHaveBeenCalledTimes(1);
    const datasetArg = firstCreateArg(prisma._tx.dataset.create);
    expect(datasetArg.data.tags).toEqual(['TI-999']);
  });

  it('runs the /metadata derivation call BEFORE opening $transaction, not inside it', async () => {
    const prisma = chainedPrisma();
    const callOrder: string[] = [];
    post.mockImplementationOnce(async () => VALIDATION_REPORT);
    post.mockImplementationOnce(async () => {
      callOrder.push('metadata');
      return PYTHON_METADATA_FOR_SAVE;
    });
    prisma.$transaction.mockImplementationOnce(
      async (fn: (tx: unknown) => unknown) => {
        callOrder.push('transaction');
        return fn(prisma._tx);
      },
    );
    const { service } = makeService(prisma);

    await service.saveDraftAsDatasetService(USER, 'draft-1', {
      name: 'ds',
    } as never);

    expect(callOrder).toEqual(['metadata', 'transaction']);
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
    // DS-LAKE-005B-A-V02. Aggregate sidecar only — never a row payload.
    expect(res.data).not.toHaveProperty('rows');
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

describe('DatasetDraftAuthorizedService — heartbeat (DS-LAKE-014-T04)', () => {
  it('bumps updatedAt via a status-filtered updateMany, writing the status the row already has (not an empty data: {})', async () => {
    const prisma = buildPrisma();
    const { service } = makeService(prisma);

    const result = await service.touchDraftService(USER, 'draft-1');

    expect(prisma.datasetDraft.updateMany).toHaveBeenCalledWith({
      where: { id: 'draft-1', status: 'ACTIVE' },
      data: { status: 'ACTIVE' },
    });
    expect(result.data).toEqual({ touched: true });
  });

  it('is a no-op (touched: false) on a draft the filter does not match, e.g. already SAVED/ABANDONED', async () => {
    const prisma = buildPrisma();
    prisma.datasetDraft.updateMany.mockResolvedValue({ count: 0 });
    const { service } = makeService(prisma);

    const result = await service.touchDraftService(USER, 'draft-1');

    expect(result.data).toEqual({ touched: false });
  });

  it('still checks ownership first — a draft the caller cannot access 404s before any updateMany call', async () => {
    const prisma = buildPrisma();
    prisma.datasetDraft.findFirst.mockResolvedValue(null);
    const { service } = makeService(prisma);

    await expect(service.touchDraftService(USER, 'not-mine')).rejects.toThrow(
      AppException,
    );
    expect(prisma.datasetDraft.updateMany).not.toHaveBeenCalled();
  });
});
