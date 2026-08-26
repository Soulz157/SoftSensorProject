import { AppException } from '@softsensor/common';
import { PreprocessingJobService } from './preprocessing-job.service';
import { postToPython } from '@/lib/python-client';

jest.mock('@/lib/python-client', () => ({
  postToPython: jest.fn(),
  PYTHON_TIMEOUT: { test: 1, metadata: 2, fetch: 3, preprocess: 4 },
}));

const post = postToPython as jest.MockedFunction<typeof postToPython>;

/**
 * Tests for the in-process job runner.
 *
 * The runner is fire-and-forget: the HTTP request has already returned 202, so
 * nothing downstream is watching. A bug here does not surface as a failed
 * request — it surfaces as a dataset that is quietly wrong, or a job row stuck
 * at RUNNING that the UI polls forever. Hence the state transitions are pinned
 * individually rather than through a single happy-path test.
 *
 * `run` is private and `start` is deliberately un-awaitable, so these reach it
 * through an explicit typed cast rather than `any`.
 */
type Runnable = { run(jobId: string): Promise<void> };

const ARTIFACT = {
  object_key: 'ds-1/v-new.parquet',
  row_count: 90,
  column_count: 3,
  size_bytes: 4096,
  missing_pct: 1.5,
  // Required by ArtifactStatsSchema since DS-LAKE-003. Omitting it made the
  // zod parse throw on the FIRST clean call, so the runner aborted after one
  // step and six tests failed on downstream symptoms (wrong call counts, no
  // committed version) rather than on the actual cause. 64 chars because the
  // schema pins the length — a shorter string fails for a different reason.
  checksum: 'a'.repeat(64),
  duration_ms: 120,
};

interface TxMock {
  /**
   * Kept so a test can still assert the runner does NOT touch it. DS-LAKE-005
   * commits a SILVER artifact; a cleaning run must create no DatasetVersion.
   */
  datasetVersion: { findFirst: jest.Mock; create: jest.Mock };
  datasetArtifact: { create: jest.Mock };
  preprocessingJob: { update: jest.Mock };
  dataset: { update: jest.Mock };
  datasetDraft: { update: jest.Mock };
}

function buildTx(): TxMock {
  const echo = () =>
    jest
      .fn()
      .mockImplementation(({ data }: { data: { id: string } }) =>
        Promise.resolve({ ...data }),
      );
  return {
    datasetVersion: {
      findFirst: jest.fn().mockResolvedValue({ versionNumber: 1 }),
      create: echo(),
    },
    datasetArtifact: { create: echo() },
    preprocessingJob: { update: jest.fn() },
    dataset: { update: jest.fn() },
    datasetDraft: { update: jest.fn() },
  };
}

function buildPrismaMock(tx: TxMock, job: Record<string, unknown> | null) {
  return {
    preprocessingJob: {
      findUnique: jest.fn().mockResolvedValue(job),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: jest.fn((cb: (t: TxMock) => Promise<unknown>) => cb(tx)),
  };
}

function buildJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    datasetId: 'ds-1',
    createdById: 'user-1',
    sourceArtifactId: 'a-1',
    sourceVersionId: null,
    stage: 'CLEAN',
    attempts: 0,
    operations: {
      operations: [
        { type: 'drop_missing' },
        { type: 'remove_outlier', method: 'iqr' },
      ],
      precision: { 'TI-101': 1 },
    },
    sourceVersion: null,
    sourceArtifact: {
      objectKey: 'ds-1/artifacts/a-1/data.parquet',
      runId: 'run-1',
    },
    ...overrides,
  };
}

function makeService(job: Record<string, unknown> | null = buildJob()) {
  const tx = buildTx();
  const prisma = buildPrismaMock(tx, job);
  const service = new PreprocessingJobService(
    prisma as unknown as ConstructorParameters<
      typeof PreprocessingJobService
    >[0],
  );
  return { service, prisma, tx };
}

function cleanCalls() {
  return post.mock.calls.filter(([path]) => path === '/v1/preprocess/clean');
}

/**
 * `jest.Mock.mock.calls` is `any[][]`, so reading `[0][0].data` inline trips
 * no-unsafe-member-access at every call site. One typed accessor keeps the
 * assertions readable and the lint honest.
 */
type PrismaWriteArg = {
  where?: Record<string, unknown>;
  data: Record<string, unknown>;
};

function writeArgs(mock: jest.Mock): PrismaWriteArg[] {
  return mock.mock.calls.map((call) => (call as [PrismaWriteArg])[0]);
}

function firstWrite(mock: jest.Mock): Record<string, unknown> {
  return writeArgs(mock)[0].data;
}

function lastWrite(mock: jest.Mock): Record<string, unknown> {
  return writeArgs(mock).at(-1)!.data;
}

function cleanupCalled() {
  return post.mock.calls.some(([path]) => path === '/v1/preprocess/cleanup');
}

/**
 * Answer each path with the shape that endpoint actually returns.
 *
 * A single blanket `mockResolvedValue(ARTIFACT)` looked green but was not: the
 * cleanup call's zod parse failed on every test and was swallowed by the
 * best-effort catch, so the success path was never really exercised.
 */
function respondByPath(): void {
  post.mockImplementation((path: string) =>
    path === '/v1/preprocess/cleanup'
      ? Promise.resolve({ prefix: 'ds-1/tmp/job-1/', deleted: 1 })
      : Promise.resolve(ARTIFACT),
  );
}

beforeEach(() => {
  post.mockReset();
  respondByPath();
});

describe('PreprocessingJobService — chaining and commit', () => {
  it('TC-01: sends one call per operation and chains the object keys', async () => {
    const { service } = makeService();
    await (service as unknown as Runnable).run('job-1');

    const cleans = cleanCalls();
    expect(cleans).toHaveLength(2);

    const first = cleans[0][1] as Record<string, unknown>;
    const second = cleans[1][1] as Record<string, unknown>;

    expect(first.source_key).toBe('ds-1/artifacts/a-1/data.parquet');
    expect(first.target_key).toBe('ds-1/tmp/job-1/1.parquet');
    // The second step reads what the first WROTE, not the original source.
    expect(second.source_key).toBe('ds-1/tmp/job-1/1.parquet');
  });

  it('TC-02: only the last step writes the committed key, and never with overwrite', async () => {
    const { service } = makeService();
    await (service as unknown as Runnable).run('job-1');

    const cleans = cleanCalls();
    const first = cleans[0][1] as Record<string, unknown>;
    const last = cleans[1][1] as Record<string, unknown>;

    // tmp may be rewritten by a retry; a committed version key may not.
    expect(first.overwrite).toBe(true);
    expect(last.overwrite).toBe(false);
    // DS-LAKE-016: a fresh CLEAN-job commit writes a SILVER-suffixed key now,
    // not legacy `data.parquet` — the whole point of this feature.
    expect(String(last.target_key)).toMatch(
      /^ds-1\/artifacts\/[0-9a-f-]{36}\/data_silver\.parquet$/,
    );
    expect(String(last.target_key)).not.toContain('/tmp/');
  });

  it('TC-03: passes precision through with every operation', async () => {
    const { service } = makeService();
    await (service as unknown as Runnable).run('job-1');

    for (const [, body] of cleanCalls()) {
      // Precision is part of the recipe: replaying without it rounds
      // differently, so the version would not reproduce later.
      expect((body as Record<string, unknown>).precision).toEqual({
        'TI-101': 1,
      });
    }
  });

  it('TC-04: commits the version, the job status and the dataset pointer together', async () => {
    const { service, prisma, tx } = makeService();
    await (service as unknown as Runnable).run('job-1');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);

    // DS-LAKE-005: a cleaning run commits a SILVER ARTIFACT and NO version.
    // The negative assertion is the load-bearing one — it is what stops the
    // persistence boundary from silently regressing.
    expect(tx.datasetVersion.create).not.toHaveBeenCalled();

    const artifact = firstWrite(tx.datasetArtifact.create);
    expect(artifact.type).toBe('SILVER');
    expect(artifact.parentArtifactId).toBe('a-1');
    // The silver output joins its bronze parent's run rather than starting one.
    expect(artifact.runId).toBe('run-1');
    expect(artifact.checksum).toBe(ARTIFACT.checksum);
    expect(artifact.rowCount).toBe(ARTIFACT.row_count);
    expect(artifact.columnCount).toBe(ARTIFACT.column_count);

    expect(firstWrite(tx.preprocessingJob.update)).toMatchObject({
      status: 'SUCCEEDED',
      progress: 100,
    });
    // A committed artifact the dataset does not point at is invisible.
    expect(tx.dataset.update).toHaveBeenCalled();
  });

  it('TC-05: clears the tmp prefix after a successful run', async () => {
    const { service } = makeService();
    await (service as unknown as Runnable).run('job-1');

    const cleanup = post.mock.calls.find(
      ([path]) => path === '/v1/preprocess/cleanup',
    );
    expect(cleanup?.[1]).toEqual({ prefix: 'ds-1/tmp/job-1/' });
  });

  it('TC-06: a cleanup failure does not turn a successful run into a failed one', async () => {
    const { service, prisma, tx } = makeService();
    post.mockImplementation((path: string) =>
      path === '/v1/preprocess/cleanup'
        ? Promise.reject(new Error('storage down'))
        : Promise.resolve(ARTIFACT),
    );

    await (service as unknown as Runnable).run('job-1');

    // The version was committed; orphaned intermediates cost storage, not
    // correctness.
    expect(tx.datasetArtifact.create).toHaveBeenCalled();
    const statuses = writeArgs(prisma.preprocessingJob.update).map(
      (arg) => arg.data.status,
    );
    expect(statuses).not.toContain('FAILED');
  });
});

describe('PreprocessingJobService — failure and cancellation', () => {
  it('TC-07: a failed step records FAILED and KEEPS tmp for inspection', async () => {
    const { service, prisma, tx } = makeService();
    post.mockRejectedValue(
      new AppException({
        statusCode: 422,
        message: 'Operation targets unknown columns',
        type: 'ERROR',
      }),
    );

    await (service as unknown as Runnable).run('job-1');

    expect(tx.datasetVersion.create).not.toHaveBeenCalled();
    const final = { data: lastWrite(prisma.preprocessingJob.update) };
    expect(final.data.status).toBe('FAILED');
    expect(final.data.error).toBe('Operation targets unknown columns');
    // The partial artifacts are the only evidence of which step went wrong.
    expect(cleanupCalled()).toBe(false);
  });

  it('TC-08: a non-AppException error is not surfaced verbatim', async () => {
    const { service, prisma } = makeService();
    // A driver error can embed a connection string, and this message is
    // persisted on the job row and shown to the user.
    post.mockRejectedValue(
      new Error('postgres://user:hunter2@db:5432 refused'),
    );

    await (service as unknown as Runnable).run('job-1');

    const final = { data: lastWrite(prisma.preprocessingJob.update) };
    expect(final.data.error).not.toContain('hunter2');
    expect(final.data.error).toContain('See the server logs');
  });

  it('TC-09: cancelling mid-run records CANCELED, commits nothing and clears tmp', async () => {
    const { service, prisma, tx } = makeService();
    // Abort while the first operation is in flight.
    post.mockImplementation((path: string) => {
      if (path === '/v1/preprocess/clean') {
        service.cancel('job-1');
        return Promise.resolve(ARTIFACT);
      }
      return Promise.resolve({ prefix: 'ds-1/tmp/job-1/', deleted: 1 });
    });

    await (service as unknown as Runnable).run('job-1');

    expect(tx.datasetVersion.create).not.toHaveBeenCalled();
    const final = { data: lastWrite(prisma.preprocessingJob.update) };
    expect(final.data.status).toBe('CANCELED');
    // Nothing was committed, so the intermediates are pure waste.
    expect(cleanupCalled()).toBe(true);
  });

  it('TC-10: cancel reports whether it had a live job to abort', () => {
    const { service } = makeService();
    expect(service.cancel('job-nobody-is-running')).toBe(false);
    expect(service.isRunning('job-1')).toBe(false);
  });

  it('TC-11: a job with no source version refuses to run rather than guessing', async () => {
    const { service, prisma } = makeService(
      // BOTH pointers must be null. The runner falls back to sourceVersion for
      // jobs queued before DS-LAKE-005, so nulling only one still gives it a
      // source and the refusal never fires.
      buildJob({
        sourceVersion: null,
        sourceVersionId: null,
        sourceArtifact: null,
        sourceArtifactId: null,
      }),
    );
    await (service as unknown as Runnable).run('job-1');

    expect(post).not.toHaveBeenCalled();
    expect(prisma.preprocessingJob.update).not.toHaveBeenCalled();
  });

  it('TC-12 (DS-LAKE-009-T07): a legacy sourceVersion resolves its key through its OWN artifact pointer, not a column DatasetVersion no longer has', async () => {
    post.mockResolvedValue(ARTIFACT);
    const { service } = makeService(
      buildJob({
        sourceArtifact: null,
        sourceArtifactId: null,
        sourceVersionId: 'v-legacy-1',
        // The registry reshape (DS-LAKE-009-T06) dropped `objectKey` off
        // DatasetVersion — a legacy job resolves it through the version's
        // OWN `artifact` relation instead (populated by this same task's
        // migration backfill for real pre-reshape rows).
        sourceVersion: {
          runId: null,
          artifact: { objectKey: 'ds-1/legacy/v-legacy-1.parquet' },
        },
      }),
    );

    await (service as unknown as Runnable).run('job-1');

    const [, firstBody] = post.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(firstBody.source_key).toBe('ds-1/legacy/v-legacy-1.parquet');
  });
});

describe('PreprocessingJobService — lifecycle', () => {
  it('TC-12: the boot sweep moves stale RUNNING rows to FAILED', async () => {
    const { service, prisma } = makeService();
    prisma.preprocessingJob.updateMany.mockResolvedValue({ count: 2 });

    await service.onModuleInit();

    const call = writeArgs(prisma.preprocessingJob.updateMany)[0];
    // This process just started, so a RUNNING row cannot be true. Left alone,
    // the UI polls a job that will never move.
    expect(call.where?.status).toBe('RUNNING');
    expect(call.data.status).toBe('FAILED');
    expect(call.data.error).toContain('restarted');
  });

  it('TC-13: shutdown aborts in-flight work and records why', async () => {
    const { service, prisma } = makeService();
    let aborted = false;
    post.mockImplementation(
      (
        _path: string,
        _body: unknown,
        _timeout?: number,
        signal?: AbortSignal,
      ) => {
        signal?.addEventListener('abort', () => {
          aborted = true;
        });
        if (_path === '/v1/preprocess/cleanup') {
          return Promise.resolve({ prefix: 'ds-1/tmp/job-1/', deleted: 1 });
        }
        return service
          .onApplicationShutdown()
          .then(() => Promise.resolve(ARTIFACT));
      },
    );

    await (service as unknown as Runnable).run('job-1');

    expect(aborted).toBe(true);
    // A job killed by a deploy must stay distinguishable from one that failed
    // on its own.
    const sweep = { data: lastWrite(prisma.preprocessingJob.updateMany) };
    expect(sweep.data.error).toContain('shutdown');
  });

  it('TC-13b: the FINAL row after a shutdown blames the shutdown, not the user', async () => {
    const { service, prisma } = makeService();
    post.mockImplementation((path: string) => {
      if (path === '/v1/preprocess/cleanup') {
        return Promise.resolve({ prefix: 'ds-1/tmp/job-1/', deleted: 1 });
      }
      return service
        .onApplicationShutdown()
        .then(() => Promise.resolve(ARTIFACT));
    });

    await (service as unknown as Runnable).run('job-1');

    // TC-13 checks the shutdown sweep's own updateMany. That is not enough: the
    // run's catch block writes AFTER the sweep, and a shutdown aborts the same
    // token a user cancel does. Keying only off `signal.aborted` made the last
    // write say "Canceled by the user" on a job nobody touched.
    const final = lastWrite(prisma.preprocessingJob.update);
    expect(final.status).toBe('FAILED');
    expect(final.error).toBe('Interrupted by server shutdown.');
    // And no cleanup during shutdown — the process is going away, and the
    // intermediates show how far the job got.
    expect(cleanupCalled()).toBe(false);
  });

  it('TC-14: the cancellation token reaches postToPython', async () => {
    const { service } = makeService();
    await (service as unknown as Runnable).run('job-1');

    const signal = cleanCalls()[0][3];
    // Without this, cancel would only take effect BETWEEN operations — up to
    // PYTHON_TIMEOUT.preprocess (5 min) after the user clicked it.
    expect(signal).toBeInstanceOf(AbortSignal);
  });
});

describe('PreprocessingJobService — stored recipe shape', () => {
  it('TC-15: reads operations from the {operations, precision} envelope', async () => {
    const { service } = makeService();
    await (service as unknown as Runnable).run('job-1');
    expect(cleanCalls()).toHaveLength(2);
  });

  it('TC-16: tolerates a bare array of operations', async () => {
    const { service } = makeService(
      buildJob({ operations: [{ type: 'drop_missing' }] }),
    );
    await (service as unknown as Runnable).run('job-1');

    const cleans = cleanCalls();
    expect(cleans).toHaveLength(1);
    // No precision envelope means no rounding overrides, not a crash.
    expect((cleans[0][1] as Record<string, unknown>).precision).toEqual({});
  });
});

describe('PreprocessingJobService — draft-owned runs (DS-LAKE-005)', () => {
  it('TC-18: a draft job writes under drafts/{draftId}/ and never under a dataset key', async () => {
    const { service } = makeService(
      buildJob({ datasetId: null, draftId: 'draft-1' }),
    );
    await (service as unknown as Runnable).run('job-1');

    const keys = post.mock.calls
      .filter(([path]) => path === '/v1/preprocess/clean')
      .map(([, body]) => String((body as { target_key: string }).target_key));

    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(key).toMatch(/^drafts\/draft-1\//);
    // The discriminating half: without the draft scope these would have been
    // built from `job.datasetId` and landed at the bare dataset namespace.
    expect(keys.some((k) => k.startsWith('ds-1/'))).toBe(false);
  });

  it('TC-19: a draft job advances the DRAFT pointer, not the dataset', async () => {
    const { service, tx } = makeService(
      buildJob({ datasetId: null, draftId: 'draft-1' }),
    );
    await (service as unknown as Runnable).run('job-1');

    expect(tx.datasetDraft.update).toHaveBeenCalled();
    // Touching Dataset here would create exactly the orphan-record problem the
    // draft-first decision exists to prevent.
    expect(tx.dataset.update).not.toHaveBeenCalled();
    expect(tx.datasetVersion.create).not.toHaveBeenCalled();
  });

  it('TC-20: a job owned by neither a dataset nor a draft refuses to run', async () => {
    const { service } = makeService(
      buildJob({ datasetId: null, draftId: null }),
    );
    await (service as unknown as Runnable).run('job-1');

    expect(post).not.toHaveBeenCalled();
  });
});

describe('PreprocessingJobService — FEATURE stage (DS-LAKE-006-T06 reversal)', () => {
  const FEATURE_ARTIFACT = {
    ...ARTIFACT,
    feature_spec_key: 'ds-1/artifacts/g-1/feature_spec.json',
  };

  function buildFeatureJob(overrides: Record<string, unknown> = {}) {
    return buildJob({
      stage: 'FEATURE',
      operations: {
        features: [{ id: 'f1', kind: 'lag', tag: 'TI-101', k: 1 }],
        selectedColumns: null,
        scalers: { 'TI-101': 'minmax' },
      },
      ...overrides,
    });
  }

  it('FEAT-01: sends ONE call to /v1/preprocess/features, not /clean', async () => {
    post.mockResolvedValue(FEATURE_ARTIFACT);
    const { service } = makeService(buildFeatureJob());
    await (service as unknown as Runnable).run('job-1');

    expect(cleanCalls()).toHaveLength(0);
    const featureCalls = post.mock.calls.filter(
      ([path]) => path === '/v1/preprocess/features',
    );
    expect(featureCalls).toHaveLength(1);

    const [, body] = featureCalls[0] as [string, Record<string, unknown>];
    expect(body.source_key).toBe('ds-1/artifacts/a-1/data.parquet');
    // DS-LAKE-016: a FEATURE job commits GOLD, not SILVER — the two branches
    // sharing one `committedKey`/`artifactType` variable must not collapse
    // to the same suffix.
    expect(String(body.target_key)).toMatch(
      /^ds-1\/artifacts\/[0-9a-f-]{36}\/data_gold\.parquet$/,
    );
    expect(body.features).toEqual([
      { id: 'f1', kind: 'lag', tag: 'TI-101', k: 1 },
    ]);
    // Field casing mirrors the inline /features route exactly.
    expect(body.selectedColumns).toBeNull();
    expect(body.scalers).toEqual({ 'TI-101': 'minmax' });
  });

  it('FEAT-02: reports totalSteps as 1, not features.length — one combined call has no per-step progress', async () => {
    post.mockResolvedValue(FEATURE_ARTIFACT);
    const { service, prisma } = makeService(
      buildFeatureJob({
        operations: {
          features: [
            { id: 'f1', kind: 'lag', tag: 'TI-101', k: 1 },
            { id: 'f2', kind: 'lag', tag: 'TI-101', k: 2 },
            { id: 'f3', kind: 'lag', tag: 'TI-101', k: 3 },
          ],
          selectedColumns: null,
          scalers: {},
        },
      }),
    );
    await (service as unknown as Runnable).run('job-1');

    const runningWrite = firstWrite(prisma.preprocessingJob.update);
    expect(runningWrite.totalSteps).toBe(1);
  });

  it('FEAT-03: commits a GOLD artifact with featureSpecKey set, completedSteps 1', async () => {
    post.mockResolvedValue(FEATURE_ARTIFACT);
    const { service, tx } = makeService(buildFeatureJob());
    await (service as unknown as Runnable).run('job-1');

    const artifact = firstWrite(tx.datasetArtifact.create);
    expect(artifact.type).toBe('GOLD');
    expect(artifact.featureSpecKey).toBe(FEATURE_ARTIFACT.feature_spec_key);
    expect(artifact.parentArtifactId).toBe('a-1');

    const jobWrite = firstWrite(tx.preprocessingJob.update);
    expect(jobWrite).toMatchObject({ status: 'SUCCEEDED', completedSteps: 1 });
  });

  it('FEAT-04: a CLEAN-shaped payload on a FEATURE-stage job FAILS rather than committing a zero-feature GOLD', async () => {
    // The exact failure mode readFeatureRecipe exists to prevent: a
    // mis-stored row must not silently run with an empty recipe and
    // report SUCCEEDED.
    const { service, prisma, tx } = makeService(
      buildFeatureJob({
        operations: { operations: [{ type: 'drop_missing' }], precision: {} },
      }),
    );
    await (service as unknown as Runnable).run('job-1');

    expect(post).not.toHaveBeenCalled();
    expect(tx.datasetArtifact.create).not.toHaveBeenCalled();
    const final = { data: lastWrite(prisma.preprocessingJob.update) };
    expect(final.data.status).toBe('FAILED');
    expect(final.data.error).toContain('feature recipe');
  });

  it('FEAT-05: a FEATURE-shaped payload on a CLEAN-stage job FAILS rather than running zero operations', async () => {
    const { service, prisma, tx } = makeService(
      buildJob({
        stage: 'CLEAN',
        operations: {
          features: [{ id: 'f1', kind: 'lag', tag: 'TI-101', k: 1 }],
        },
      }),
    );
    await (service as unknown as Runnable).run('job-1');

    expect(post).not.toHaveBeenCalled();
    expect(tx.datasetArtifact.create).not.toHaveBeenCalled();
    const final = { data: lastWrite(prisma.preprocessingJob.update) };
    expect(final.data.status).toBe('FAILED');
    expect(final.data.error).toContain('cleaning pipeline');
  });
});

const EXPORT_ARTIFACT = {
  object_key: 'ds-1/artifacts/a-1/export.csv',
  row_count: 500,
  column_count: 3,
  size_bytes: 20480,
  checksum: 'b'.repeat(64),
};

function buildExportJob(overrides: Record<string, unknown> = {}) {
  return buildJob({
    stage: 'EXPORT',
    operations: { kind: 'export' },
    ...overrides,
  });
}

describe('EXPORT stage', () => {
  it('EXP-01: commits an EXPORT artifact with parentArtifactId set to the source', async () => {
    post.mockResolvedValue(EXPORT_ARTIFACT);
    const { service, tx } = makeService(buildExportJob());
    await (service as unknown as Runnable).run('job-1');

    const artifact = firstWrite(tx.datasetArtifact.create);
    expect(artifact.type).toBe('EXPORT');
    expect(artifact.parentArtifactId).toBe('a-1');
    expect(artifact.objectKey).toBe(EXPORT_ARTIFACT.object_key);
    expect(artifact.rowCount).toBe(500);
    // DS-LAKE-021 final-review fix: an EXPORT row holds a CSV, not a parquet
    // file, so it must not silently take the schema's "parquet" default.
    expect(artifact.format).toBe('csv');

    const jobWrite = firstWrite(tx.preprocessingJob.update);
    expect(jobWrite).toMatchObject({ status: 'SUCCEEDED', completedSteps: 1 });
  });

  it('EXP-02: calls /v1/preprocess/export with the source artifact objectKey and its own target_key', async () => {
    post.mockResolvedValue(EXPORT_ARTIFACT);
    const { service } = makeService(buildExportJob());
    await (service as unknown as Runnable).run('job-1');

    const exportCalls = post.mock.calls.filter(
      ([path]) => path === '/v1/preprocess/export',
    );
    expect(exportCalls).toHaveLength(1);
    const [, body] = exportCalls[0] as [string, Record<string, unknown>];
    expect(body.source_key).toBe('ds-1/artifacts/a-1/data.parquet');
    // DS-LAKE-021-T04: EXPORT writes into its OWN artifact-id-keyed prefix
    // now, same mechanism FEATURE's GOLD target_key already uses — not a
    // sidecar of the source's key.
    expect(String(body.target_key)).toMatch(
      /^ds-1\/artifacts\/[0-9a-f-]{36}\/export\.csv$/,
    );
  });

  it('EXP-03: a CLEAN-shaped payload on an EXPORT-stage job FAILS rather than silently exporting nothing', async () => {
    const { service, prisma, tx } = makeService(
      buildExportJob({
        operations: { operations: [{ type: 'drop_missing' }], precision: {} },
      }),
    );
    await (service as unknown as Runnable).run('job-1');

    expect(post).not.toHaveBeenCalled();
    expect(tx.datasetArtifact.create).not.toHaveBeenCalled();
    const final = { data: lastWrite(prisma.preprocessingJob.update) };
    expect(final.data.status).toBe('FAILED');
    expect(final.data.error).toContain('export');
  });

  it('EXP-04: an EXPORT-shaped payload on a CLEAN-stage job FAILS rather than running zero operations', async () => {
    const { service, prisma, tx } = makeService(
      buildJob({ stage: 'CLEAN', operations: { kind: 'export' } }),
    );
    await (service as unknown as Runnable).run('job-1');

    expect(post).not.toHaveBeenCalled();
    expect(tx.datasetArtifact.create).not.toHaveBeenCalled();
    const final = { data: lastWrite(prisma.preprocessingJob.update) };
    expect(final.data.status).toBe('FAILED');
  });

  it('EXP-05: does NOT advance the dataset/draft currentArtifactId pointer — an export is a read-only rendering, not a new lineage stage', async () => {
    post.mockResolvedValue(EXPORT_ARTIFACT);
    const { service, tx } = makeService(buildExportJob());
    await (service as unknown as Runnable).run('job-1');

    expect(tx.dataset.update).not.toHaveBeenCalled();
    expect(tx.datasetDraft.update).not.toHaveBeenCalled();
  });
});

/**
 * DS-LAKE-022-T03 — the stage remap.
 *
 * The reorder swaps what SILVER and GOLD mean:
 *
 *   legacy  BRONZE -> clean(SILVER) -> features+scale(GOLD) -> FINAL
 *   reorder BRONZE -> features(SILVER) -> clean+scale(GOLD) -> FINAL
 *
 * Both are live at once, chosen per job by the recipe the client stored, so
 * every test here comes in pairs: the legacy shape must be untouched, and the
 * reordered shape must take the new path. A test that only exercised the new
 * path would not notice the old one breaking, which is the whole risk of
 * landing this before the wizard renumber (T04..T07).
 */
describe('PreprocessingJobService — DS-LAKE-022 stage remap', () => {
  const SCALE_RECIPE = {
    features: [{ id: 'f1', kind: 'lag', tag: 'TI-101', k: 1 }],
    selectedColumns: ['TI-101'],
    scalers: { 'TI-101': 'minmax' },
    targetY: 'TI-101',
  };
  const SCALED_ARTIFACT = {
    ...ARTIFACT,
    feature_spec_key: 'ds-1/artifacts/g-1/feature_spec.json',
    // /scale writes column_stats.json too — every write path does. RMP-10
    // pins that it reaches the row rather than being dropped by a branch.
    column_stats_key: 'ds-1/artifacts/g-1/column_stats.json',
  };

  function buildReorderedCleanJob(overrides: Record<string, unknown> = {}) {
    return buildJob({
      stage: 'CLEAN',
      operations: {
        operations: [{ type: 'drop_missing', tags: ['TI-101'] }],
        precision: {},
        scaleRecipe: SCALE_RECIPE,
        ...(overrides.operations as Record<string, unknown>),
      },
    });
  }

  it('RMP-01: a legacy CLEAN job (no scaleRecipe) still commits SILVER with pipelineVersion null', async () => {
    post.mockResolvedValue(ARTIFACT);
    const { service, tx } = makeService(
      buildJob({
        stage: 'CLEAN',
        operations: {
          operations: [{ type: 'drop_missing', tags: ['TI-101'] }],
          precision: {},
        },
      }),
    );
    await (service as unknown as Runnable).run('job-1');

    const artifact = firstWrite(tx.datasetArtifact.create);
    expect(artifact.type).toBe('SILVER');
    // NULL, not 1 — the same value every pre-reorder artifact carries.
    expect(artifact.pipelineVersion).toBeNull();
    // No scale call at all: the legacy order scales inside /features later.
    expect(
      post.mock.calls.filter(([path]) => path === '/v1/preprocess/scale'),
    ).toHaveLength(0);
  });

  it('RMP-02: a reordered CLEAN job commits GOLD with pipelineVersion 2 and calls /scale last', async () => {
    post.mockResolvedValue(SCALED_ARTIFACT);
    const { service, tx } = makeService(buildReorderedCleanJob());
    await (service as unknown as Runnable).run('job-1');

    const artifact = firstWrite(tx.datasetArtifact.create);
    expect(artifact.type).toBe('GOLD');
    expect(artifact.pipelineVersion).toBe(2);

    // Filtered to the transform calls: the runner also posts /cleanup to
    // clear its tmp prefix on success, which is not part of the ordering
    // under test.
    const paths = post.mock.calls
      .map(([path]) => path)
      .filter((p) => p !== '/v1/preprocess/cleanup');
    expect(paths).toEqual(['/v1/preprocess/clean', '/v1/preprocess/scale']);
  });

  it('RMP-03: under the reorder the cleaning step writes tmp, and only /scale writes the committed GOLD key', async () => {
    post.mockResolvedValue(SCALED_ARTIFACT);
    const { service } = makeService(buildReorderedCleanJob());
    await (service as unknown as Runnable).run('job-1');

    const [, cleanBody] = post.mock.calls.find(
      ([path]) => path === '/v1/preprocess/clean',
    ) as [string, Record<string, unknown>];
    const [, scaleBody] = post.mock.calls.find(
      ([path]) => path === '/v1/preprocess/scale',
    ) as [string, Record<string, unknown>];

    // The regression this pins: if the final clean kept writing the committed
    // key, /scale would then try to write it a second time and put_frame
    // refuses to overwrite a committed key — the job fails AFTER doing all
    // the work. So the last clean must be a tmp write, overwrite:true.
    expect(String(cleanBody.target_key)).toContain('/tmp/');
    expect(cleanBody.overwrite).toBe(true);

    expect(String(scaleBody.target_key)).toMatch(
      /^ds-1\/artifacts\/[0-9a-f-]{36}\/data_gold\.parquet$/,
    );
    expect(scaleBody.overwrite).toBe(false);
    // /scale reads what the cleaning chain produced, not the original source.
    expect(scaleBody.source_key).toBe(cleanBody.target_key);
  });

  it('RMP-04: the scale call carries the recipe so feature_spec.json is written at the stage that now owns it', async () => {
    post.mockResolvedValue(SCALED_ARTIFACT);
    const { service, tx } = makeService(buildReorderedCleanJob());
    await (service as unknown as Runnable).run('job-1');

    const [, scaleBody] = post.mock.calls.find(
      ([path]) => path === '/v1/preprocess/scale',
    ) as [string, Record<string, unknown>];
    expect(scaleBody.features).toEqual(SCALE_RECIPE.features);
    expect(scaleBody.selectedColumns).toEqual(['TI-101']);
    expect(scaleBody.scalers).toEqual({ 'TI-101': 'minmax' });
    expect(scaleBody.target_y).toBe('TI-101');

    // And the key it returns must land on the row. The old code read
    // featureSpecKey only when isFeatureJob, which would have discarded this
    // and left the GOLD (and the FINAL that copies it) with none.
    const artifact = firstWrite(tx.datasetArtifact.create);
    expect(artifact.featureSpecKey).toBe(SCALED_ARTIFACT.feature_spec_key);
  });

  it('RMP-05: a reordered CLEAN job with ZERO operations still produces GOLD via /scale', async () => {
    post.mockResolvedValue(SCALED_ARTIFACT);
    const { service, tx } = makeService(
      buildReorderedCleanJob({ operations: { operations: [] } }),
    );
    await (service as unknown as Runnable).run('job-1');

    // A draft with features but no cleaning rules is a real case; it must not
    // fail the "needs at least one operation" guard, because under the new
    // order the scale call is what produces the artifact.
    const paths = post.mock.calls
      .map(([path]) => path)
      .filter((p) => p !== '/v1/preprocess/cleanup');
    expect(paths).toEqual(['/v1/preprocess/scale']);
    const artifact = firstWrite(tx.datasetArtifact.create);
    expect(artifact.type).toBe('GOLD');
    // /scale reads the source artifact directly when nothing was cleaned.
    const [, scaleBody] = post.mock.calls.find(
      ([path]) => path === '/v1/preprocess/scale',
    ) as [string, Record<string, unknown>];
    expect(scaleBody.source_key).toBe('ds-1/artifacts/a-1/data.parquet');
  });

  it('RMP-06: a CLEAN job with zero operations AND no scaleRecipe still FAILS rather than committing an empty artifact', async () => {
    const { service, prisma, tx } = makeService(
      buildJob({
        stage: 'CLEAN',
        operations: { operations: [], precision: {} },
      }),
    );
    await (service as unknown as Runnable).run('job-1');

    // Relaxing `.min(1)` on the DTO moved this refusal one layer later; it
    // must still refuse, or a caller that sends nothing gets a SUCCEEDED job
    // and an artifact nothing was applied to.
    expect(tx.datasetArtifact.create).not.toHaveBeenCalled();
    const final = lastWrite(prisma.preprocessingJob.update);
    expect(final.status).toBe('FAILED');
  });

  it('RMP-07: a reordered FEATURE job (scale:false) commits SILVER with pipelineVersion 2 and forwards scale', async () => {
    post.mockResolvedValue(ARTIFACT);
    const { service, tx } = makeService(
      buildJob({
        stage: 'FEATURE',
        operations: {
          features: [{ id: 'f1', kind: 'lag', tag: 'TI-101', k: 1 }],
          selectedColumns: null,
          scalers: {},
          scale: false,
        },
      }),
    );
    await (service as unknown as Runnable).run('job-1');

    const artifact = firstWrite(tx.datasetArtifact.create);
    expect(artifact.type).toBe('SILVER');
    expect(artifact.pipelineVersion).toBe(2);

    const [, body] = post.mock.calls.find(
      ([path]) => path === '/v1/preprocess/features',
    ) as [string, Record<string, unknown>];
    expect(body.scale).toBe(false);
    // The object key must follow the row's type, not stay on the old suffix.
    expect(String(body.target_key)).toMatch(/data_silver\.parquet$/);
  });

  it('RMP-08: a legacy FEATURE job omits `scale` entirely so Python owns the default', async () => {
    post.mockResolvedValue(ARTIFACT);
    const { service, tx } = makeService(
      buildJob({
        stage: 'FEATURE',
        operations: {
          features: [{ id: 'f1', kind: 'lag', tag: 'TI-101', k: 1 }],
          selectedColumns: null,
          scalers: {},
        },
      }),
    );
    await (service as unknown as Runnable).run('job-1');

    const [, body] = post.mock.calls.find(
      ([path]) => path === '/v1/preprocess/features',
    ) as [string, Record<string, unknown>];
    // Not `false`, not `true` — ABSENT. Sending an explicit true would put a
    // second copy of the legacy default in the backend, free to drift.
    expect('scale' in body).toBe(false);

    const artifact = firstWrite(tx.datasetArtifact.create);
    expect(artifact.type).toBe('GOLD');
    expect(artifact.pipelineVersion).toBeNull();
  });

  it('RMP-11: a FEATURE job with a holdout forwards it to Python and writes all three validation_* columns onto the SILVER row', async () => {
    post.mockResolvedValue({
      ...ARTIFACT,
      validation_row_count: 5,
      validation_holdout_from: '2026-01-16 00:00:00',
      validation_missing_pct: 0,
    });
    const { service, tx } = makeService(
      buildJob({
        stage: 'FEATURE',
        operations: {
          features: [{ id: 'f1', kind: 'lag', tag: 'TI-101', k: 1 }],
          selectedColumns: null,
          scalers: {},
          scale: false,
          holdout: { from: '2026-01-16', to: '2026-01-20' },
        },
      }),
    );
    await (service as unknown as Runnable).run('job-1');

    const [, body] = post.mock.calls.find(
      ([path]) => path === '/v1/preprocess/features',
    ) as [string, Record<string, unknown>];
    expect(body.holdout).toEqual({
      from_time: '2026-01-16',
      to_time: '2026-01-20',
    });

    const artifact = firstWrite(tx.datasetArtifact.create);
    expect(artifact.validationRowCount).toBe(5);
    expect(artifact.validationHoldoutFrom).toEqual(
      new Date('2026-01-16 00:00:00'),
    );
    expect(artifact.validationMissingPct).toBe(0);
  });

  it('RMP-12: a FEATURE job with no holdout omits it from the Python body and writes null validation_* columns', async () => {
    post.mockResolvedValue(ARTIFACT);
    const { service, tx } = makeService(
      buildJob({
        stage: 'FEATURE',
        operations: {
          features: [{ id: 'f1', kind: 'lag', tag: 'TI-101', k: 1 }],
          selectedColumns: null,
          scalers: {},
          scale: false,
        },
      }),
    );
    await (service as unknown as Runnable).run('job-1');

    const [, body] = post.mock.calls.find(
      ([path]) => path === '/v1/preprocess/features',
    ) as [string, Record<string, unknown>];
    expect('holdout' in body).toBe(false);

    const artifact = firstWrite(tx.datasetArtifact.create);
    expect(artifact.validationRowCount).toBeNull();
    expect(artifact.validationHoldoutFrom).toBeNull();
    expect(artifact.validationMissingPct).toBeNull();
  });

  it('RMP-10: the reordered GOLD keeps the SOURCE artifact as its parent and joins its run', async () => {
    post.mockResolvedValue(SCALED_ARTIFACT);
    const { service, tx } = makeService(buildReorderedCleanJob());
    await (service as unknown as Runnable).run('job-1');

    const artifact = firstWrite(tx.datasetArtifact.create);
    // The chain is BRONZE -> features(SILVER) -> clean+scale(GOLD). The tmp
    // keys the cleaning steps wrote are scaffolding, not lineage: the GOLD's
    // parent must still be the artifact the job was given, or the lineage
    // walk skips the feature stage entirely.
    expect(artifact.parentArtifactId).toBe('a-1');
    expect(artifact.columnStatsKey).toBe(SCALED_ARTIFACT.column_stats_key);
  });

  it('RMP-09: a malformed scaleRecipe FAILS the job rather than silently degrading to the legacy order', async () => {
    const { service, prisma, tx } = makeService(
      buildReorderedCleanJob({
        // `features` must be an array of valid configs; a string is not.
        operations: { scaleRecipe: { features: 'not-an-array' } },
      }),
    );
    await (service as unknown as Runnable).run('job-1');

    // Degrading silently would commit SILVER bytes while the caller believed
    // it asked for a scaled GOLD — the exact confusion pipelineVersion exists
    // to prevent, reintroduced one layer down.
    expect(post).not.toHaveBeenCalled();
    expect(tx.datasetArtifact.create).not.toHaveBeenCalled();
    const final = lastWrite(prisma.preprocessingJob.update);
    expect(final.status).toBe('FAILED');
  });
});
