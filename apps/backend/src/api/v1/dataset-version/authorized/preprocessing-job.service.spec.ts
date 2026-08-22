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
