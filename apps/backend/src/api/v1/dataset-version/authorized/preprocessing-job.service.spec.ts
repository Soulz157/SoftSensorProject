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
  duration_ms: 120,
};

interface TxMock {
  datasetVersion: { findFirst: jest.Mock; create: jest.Mock };
  preprocessingJob: { update: jest.Mock };
  dataset: { update: jest.Mock };
}

function buildTx(): TxMock {
  return {
    datasetVersion: {
      findFirst: jest.fn().mockResolvedValue({ versionNumber: 1 }),
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: { id: string } }) =>
          Promise.resolve({ ...data }),
        ),
    },
    preprocessingJob: { update: jest.fn() },
    dataset: { update: jest.fn() },
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
    sourceVersionId: 'v-1',
    stage: 'CLEAN',
    attempts: 0,
    operations: {
      operations: [
        { type: 'drop_missing' },
        { type: 'remove_outlier', method: 'iqr' },
      ],
      precision: { 'TI-101': 1 },
    },
    sourceVersion: { objectKey: 'ds-1/v-1.parquet' },
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

    expect(first.source_key).toBe('ds-1/v-1.parquet');
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
    expect(String(last.target_key)).toMatch(/^ds-1\/[0-9a-f-]{36}\.parquet$/);
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

    const version = firstWrite(tx.datasetVersion.create);
    expect(version.stage).toBe('CLEAN');
    expect(version.parentVersionId).toBe('v-1');
    expect(version.versionNumber).toBe(2); // previous max was 1
    expect(version.rowCount).toBe(ARTIFACT.row_count);
    expect(version.columnCount).toBe(ARTIFACT.column_count);

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
    expect(tx.datasetVersion.create).toHaveBeenCalled();
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
      buildJob({ sourceVersion: null, sourceVersionId: null }),
    );
    await (service as unknown as Runnable).run('job-1');

    expect(post).not.toHaveBeenCalled();
    expect(prisma.preprocessingJob.update).not.toHaveBeenCalled();
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
