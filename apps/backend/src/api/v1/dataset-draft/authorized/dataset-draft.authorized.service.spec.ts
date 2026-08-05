import { AppException } from '@softsensor/common';
import { postToPython } from '@/lib/python-client';
import { DatasetDraftAuthorizedService } from './dataset-draft.authorized.service';
import type { PreprocessingJobService } from '../../dataset-version/authorized/preprocessing-job.service';
import type { CreateRawVersionDto } from '../../dataset-version/authorized/dto/dataset-version.authorized.dto';

jest.mock('@/lib/python-client', () => ({
  postToPython: jest.fn(),
  PYTHON_TIMEOUT: { test: 1, metadata: 2, fetch: 3, preprocess: 4 },
}));

jest.mock('@/lib/crypto', () => ({
  decryptSecret: jest.fn().mockReturnValue('decrypted-secret'),
}));

const post = postToPython as jest.MockedFunction<typeof postToPython>;

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
