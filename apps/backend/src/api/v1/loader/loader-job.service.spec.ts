import { AppException } from '@softsensor/common';
import { LoaderJobService } from './loader-job.service';
import type { LoaderSink } from './loader-sink.interface';

/**
 * DS-LAKE-011. Covers V01 (sink throws -> job lands FAILED, nothing about
 * Save itself is touched here — that half is proven at the call site in
 * dataset-draft.authorized.service.spec.ts), V02 (retry creates a fresh
 * row, original history untouched) and the boot-sweep half of V03 (a
 * process restart's RUNNING row is swept to FAILED — the "kill the backend
 * mid-load" scenario, at the level this test CAN exercise without an
 * actual process kill).
 */

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    loaderJob: {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    ...overrides,
  };
}

function makeService(
  prisma: ReturnType<typeof buildPrisma>,
  sink: Partial<LoaderSink> = {},
) {
  const fullSink: LoaderSink = {
    load: jest.fn().mockResolvedValue(undefined),
    ...sink,
  };
  const service = new LoaderJobService(
    prisma as unknown as ConstructorParameters<typeof LoaderJobService>[0],
    fullSink,
  );
  return { service, sink: fullSink };
}

// Flush the fire-and-forget `run()` chain `start()`/`enqueue()` kick off
// without awaiting.
const flush = () => new Promise((r) => setImmediate(r));

describe('LoaderJobService — onModuleInit boot sweep (DS-LAKE-011-T04 / V03)', () => {
  it('sweeps every RUNNING row to FAILED on startup', async () => {
    const prisma = buildPrisma();
    prisma.loaderJob.updateMany.mockResolvedValue({ count: 2 });
    const { service } = makeService(prisma);

    await service.onModuleInit();

    expect(prisma.loaderJob.updateMany).toHaveBeenCalledWith({
      where: { status: 'RUNNING' },
      data: expect.objectContaining({
        status: 'FAILED',
        error: expect.stringContaining('Interrupted'),
      }),
    });
  });
});

describe('LoaderJobService — enqueue and run (DS-LAKE-011-T01/T03)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('DS-LAKE-011-V01: a throwing sink lands the job FAILED, with the error recorded', async () => {
    const prisma = buildPrisma();
    prisma.loaderJob.create.mockResolvedValue({
      id: 'job-1',
      datasetId: 'ds-1',
      versionId: 'v-1',
    });
    prisma.loaderJob.findUnique.mockResolvedValue({
      id: 'job-1',
      datasetId: 'ds-1',
      versionId: 'v-1',
    });
    const { service, sink } = makeService(prisma, {
      load: jest.fn().mockRejectedValue(new Error('sink unreachable')),
    });

    const jobId = await service.enqueue('ds-1', 'v-1', 'user-1');
    await flush();

    expect(jobId).toBe('job-1');
    expect(sink.load).toHaveBeenCalledWith({
      datasetId: 'ds-1',
      versionId: 'v-1',
    });
    // RUNNING transition, then FAILED — both real writes, not skipped.
    expect(prisma.loaderJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: expect.objectContaining({ status: 'RUNNING' }),
    });
    expect(prisma.loaderJob.update).toHaveBeenLastCalledWith({
      where: { id: 'job-1' },
      data: expect.objectContaining({
        status: 'FAILED',
        error: 'sink unreachable',
      }),
    });
  });

  it('enqueue does not throw even when the sink fails — the caller (Save) is never blocked', async () => {
    const prisma = buildPrisma();
    prisma.loaderJob.create.mockResolvedValue({
      id: 'job-1',
      datasetId: 'ds-1',
      versionId: 'v-1',
    });
    prisma.loaderJob.findUnique.mockResolvedValue({
      id: 'job-1',
      datasetId: 'ds-1',
      versionId: 'v-1',
    });
    const { service } = makeService(prisma, {
      load: jest.fn().mockRejectedValue(new Error('sink unreachable')),
    });

    await expect(service.enqueue('ds-1', 'v-1', 'user-1')).resolves.toBe(
      'job-1',
    );
    await flush(); // let the background failure settle, proving it was caught
  });

  it('a succeeding sink lands the job SUCCEEDED', async () => {
    const prisma = buildPrisma();
    prisma.loaderJob.create.mockResolvedValue({
      id: 'job-1',
      datasetId: 'ds-1',
      versionId: 'v-1',
    });
    prisma.loaderJob.findUnique.mockResolvedValue({
      id: 'job-1',
      datasetId: 'ds-1',
      versionId: 'v-1',
    });
    const { service } = makeService(prisma);

    await service.enqueue('ds-1', 'v-1', 'user-1');
    await flush();

    expect(prisma.loaderJob.update).toHaveBeenLastCalledWith({
      where: { id: 'job-1' },
      data: expect.objectContaining({ status: 'SUCCEEDED' }),
    });
  });
});

describe('LoaderJobService — retry (DS-LAKE-011-T04 / V02)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('404s when the job does not exist', async () => {
    const prisma = buildPrisma();
    prisma.loaderJob.findUnique.mockResolvedValue(null);
    const { service } = makeService(prisma);

    await expect(service.retry('ghost')).rejects.toThrow(AppException);
  });

  it('refuses to retry a job that is not FAILED or CANCELED', async () => {
    const prisma = buildPrisma();
    prisma.loaderJob.findUnique.mockResolvedValue({
      id: 'job-1',
      status: 'RUNNING',
    });
    const { service } = makeService(prisma);

    await expect(service.retry('job-1')).rejects.toThrow(AppException);
    expect(prisma.loaderJob.create).not.toHaveBeenCalled();
  });

  it('DS-LAKE-011-V02: creates a NEW row referencing the same dataset/version, carrying attempts forward, leaving the original untouched', async () => {
    const prisma = buildPrisma();
    prisma.loaderJob.findUnique
      .mockResolvedValueOnce({
        id: 'job-1',
        datasetId: 'ds-1',
        versionId: 'v-1',
        status: 'FAILED',
        attempts: 1,
        createdById: 'user-1',
      })
      .mockResolvedValue({
        id: 'job-2',
        datasetId: 'ds-1',
        versionId: 'v-1',
      });
    prisma.loaderJob.create.mockResolvedValue({
      id: 'job-2',
      datasetId: 'ds-1',
      versionId: 'v-1',
      attempts: 1,
    });
    const { service } = makeService(prisma);

    const result = await service.retry('job-1');
    await flush();

    expect(result).toEqual({ jobId: 'job-2', retryOf: 'job-1' });
    // A NEW row was created — the original ('job-1') was never written to.
    expect(prisma.loaderJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        datasetId: 'ds-1',
        versionId: 'v-1',
        status: 'QUEUED',
        attempts: 1, // carried forward, not reset to 0
        createdById: 'user-1',
      }),
    });
    // The runner then increments attempts on start (existing convention,
    // mirrors PreprocessingJobService) -- update() only ever targets job-2.
    for (const call of prisma.loaderJob.update.mock.calls) {
      expect(call[0].where.id).toBe('job-2');
    }
  });
});
