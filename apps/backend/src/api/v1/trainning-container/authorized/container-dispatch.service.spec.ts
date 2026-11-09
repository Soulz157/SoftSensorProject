import { DelayedError, Worker } from 'bullmq';
import { ContainerDispatchService } from './container-dispatch.service';

jest.mock('@softsensor/prisma', () => ({ PrismaService: class {} }));
jest.mock('./trainning-container.authorized.service', () => ({
  TrainningContainerAuthorizedService: class {},
}));
jest.mock('bullmq', () => {
  class FakeQueue {
    add = jest.fn().mockResolvedValue({});
    getJob = jest.fn().mockResolvedValue(undefined);
    remove = jest.fn().mockResolvedValue(1);
    rateLimit = jest.fn().mockResolvedValue(undefined);
    on = jest.fn();
    close = jest.fn().mockResolvedValue(undefined);
  }
  class FakeWorker {
    static RateLimitError() {
      return new Error('bullmq:rateLimitExceeded');
    }
    on = jest.fn();
    run = jest.fn().mockResolvedValue(undefined);
    close = jest.fn().mockResolvedValue(undefined);
  }
  class FakeDelayedError extends Error {}
  return {
    Queue: FakeQueue,
    Worker: FakeWorker,
    DelayedError: FakeDelayedError,
  };
});

const GIB = 1024 ** 3;

function makeDeps() {
  const prisma = {
    modelTrainingRun: {
      findUnique: jest.fn().mockResolvedValue({
        status: 'QUEUED',
        model: null,
        modelDraft: { workspaceId: 'ws1' },
      }),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    modelTrainingRunLog: { create: jest.fn().mockResolvedValue({}) },
    predictionJob: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    inferenceWindow: {
      findUnique: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const runner = {
    adopt: jest.fn().mockResolvedValue(false),
    listRunning: jest.fn().mockResolvedValue([]),
    dockerInfo: jest.fn().mockResolvedValue({ NCPU: 10, MemTotal: 16 * GIB }),
    spawn: jest.fn().mockResolvedValue(undefined),
    kill: jest.fn().mockResolvedValue(undefined),
  };
  const service = new ContainerDispatchService(
    prisma as never,
    runner as never,
  );
  service.onModuleInit();
  const internals = service as unknown as {
    admission: {
      add: jest.Mock;
      getJob: jest.Mock;
      remove: jest.Mock;
      rateLimit: jest.Mock;
    };
    prep: { add: jest.Mock };
    processAdmission(job: unknown, token?: string): Promise<void>;
  };
  return { service, prisma, runner, internals };
}

function job(mode: string, id = 'r1') {
  return {
    id: `${mode}-${id}`,
    data: { mode, id },
    moveToDelayed: jest.fn().mockResolvedValue(undefined),
  };
}

const running = (mode: string, workspaceId: string | null = 'other') => ({
  mode,
  workspaceId,
  containerId: `c-${mode}`,
  runId: `run-${mode}`,
  startedAtMs: Date.now(),
});

describe('ContainerDispatchService admission', () => {
  it('does nothing for a row that stopped waiting, such as a canceled run', async () => {
    const { prisma, runner, internals } = makeDeps();
    prisma.modelTrainingRun.findUnique.mockResolvedValue({
      status: 'CANCELED',
    });

    await internals.processAdmission(job('train'));

    expect(runner.spawn).not.toHaveBeenCalled();
    expect(runner.adopt).not.toHaveBeenCalled();
  });

  it('adopts an existing container instead of starting a second one', async () => {
    const { runner, internals } = makeDeps();
    runner.adopt.mockResolvedValue(true);

    await internals.processAdmission(job('train'));

    expect(runner.spawn).not.toHaveBeenCalled();
  });

  it('mints a token at admission and stores only its hash', async () => {
    const { prisma, runner, internals } = makeDeps();

    await internals.processAdmission(job('train'));

    const [id, token, mode, workspaceId] = runner.spawn.mock
      .calls[0] as string[];
    expect([id, mode, workspaceId]).toEqual(['r1', 'train', 'ws1']);
    const [[write]] = prisma.modelTrainingRun.updateMany.mock.calls as [
      [{ where: unknown; data: { tokenHash: string; tokenExpiresAt: Date } }],
    ];
    expect(write.where).toEqual({ id: 'r1', status: 'QUEUED' });
    expect(write.data.tokenHash).not.toBe(token);
    expect(write.data.tokenExpiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('starts nothing when the run is canceled just before the token write', async () => {
    const { prisma, runner, internals } = makeDeps();
    prisma.modelTrainingRun.updateMany.mockResolvedValue({ count: 0 });

    await internals.processAdmission(job('train'));

    expect(runner.spawn).not.toHaveBeenCalled();
  });

  it('pauses the queue and returns the job when the host is full', async () => {
    const { prisma, runner, internals } = makeDeps();
    runner.listRunning.mockResolvedValue([
      running('train'),
      running('train'),
      running('train'),
    ]);

    await expect(internals.processAdmission(job('train'))).rejects.toThrow(
      Worker.RateLimitError().message,
    );

    expect(internals.admission.rateLimit).toHaveBeenCalledTimes(1);
    expect(runner.spawn).not.toHaveBeenCalled();
    expect(prisma.modelTrainingRun.updateMany).not.toHaveBeenCalled();
  });

  it('delays only this job when its workspace is at the cap', async () => {
    const { runner, internals } = makeDeps();
    runner.listRunning.mockResolvedValue([
      running('train', 'ws1'),
      running('batch', 'ws1'),
    ]);
    const queued = job('train');

    await expect(
      internals.processAdmission(queued, 'lock'),
    ).rejects.toBeInstanceOf(DelayedError);

    expect(queued.moveToDelayed).toHaveBeenCalledWith(
      expect.any(Number),
      'lock',
    );
    expect(internals.admission.rateLimit).not.toHaveBeenCalled();
  });

  it('fails a job the host can never run, with the reason on the row', async () => {
    const { prisma, runner, internals } = makeDeps();
    runner.dockerInfo.mockResolvedValue({ NCPU: 10, MemTotal: 2 * GIB });

    await internals.processAdmission(job('train'));

    expect(runner.spawn).not.toHaveBeenCalled();
    expect(prisma.modelTrainingRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          failureReason: expect.stringContaining('this server') as string,
        }) as object,
      }),
    );
  });

  it('marks the row FAILED when the container cannot start', async () => {
    const { prisma, runner, internals } = makeDeps();
    runner.spawn.mockRejectedValue(new Error('no docker daemon'));

    await internals.processAdmission(job('train'));

    expect(prisma.modelTrainingRun.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          failureReason: 'Could not start container: no docker daemon',
        }) as object,
      }),
    );
  });

  it('keeps a run terminal when its scoring cannot start', async () => {
    const { prisma, runner, internals } = makeDeps();
    prisma.modelTrainingRun.findUnique.mockResolvedValue({
      scoringQueuedAt: new Date(),
      scoringContainerId: null,
    });
    runner.spawn.mockRejectedValue(new Error('no docker daemon'));

    await internals.processAdmission(job('score'));

    expect(prisma.modelTrainingRun.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'r1' },
      data: { scoringQueuedAt: null },
    });
    expect(prisma.modelTrainingRunLog.create).toHaveBeenCalledTimes(1);
  });
});

describe('ContainerDispatchService enqueue', () => {
  it('dedupes by row and sets priority', async () => {
    const { service, internals } = makeDeps();

    await service.enqueue('infer', 'w1', { live: false });

    expect(internals.admission.add).toHaveBeenCalledWith(
      'infer',
      { mode: 'infer', id: 'w1' },
      expect.objectContaining({ jobId: 'infer-w1', priority: 5 }),
    );
  });

  it('reports failure instead of rejecting when Redis refuses', async () => {
    const { service, internals } = makeDeps();
    internals.admission.add.mockRejectedValue(new Error('down'));

    await expect(service.enqueue('train', 'r1')).resolves.toBe(false);
  });

  it('gives up when a Redis call never settles', async () => {
    jest.useFakeTimers();
    try {
      const { service, internals } = makeDeps();
      internals.admission.add.mockReturnValue(new Promise(() => undefined));

      const out = service.enqueue('train', 'r1');
      await jest.advanceTimersByTimeAsync(2_001);

      await expect(out).resolves.toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('skips preparing a window already waiting for admission', async () => {
    const { service, internals } = makeDeps();
    internals.admission.getJob.mockResolvedValue({ id: 'infer-w1' });

    await service.enqueueInferencePrep('w1', true);

    expect(internals.prep.add).not.toHaveBeenCalled();
  });
});

describe('ContainerDispatchService sweep', () => {
  it('re-adds waiting rows and is safe to repeat', async () => {
    const { service, prisma, internals } = makeDeps();
    prisma.modelTrainingRun.findMany.mockImplementation(
      ({ where }: { where: { status?: string } }) =>
        Promise.resolve(
          where.status === 'QUEUED'
            ? [{ id: 'r1', createdAt: new Date() }]
            : [{ id: 's1', scoringQueuedAt: new Date() }],
        ),
    );
    prisma.predictionJob.findMany.mockResolvedValue([
      { id: 'b1', createdAt: new Date() },
    ]);

    await service.sweep();
    await service.sweep();

    const calls = internals.admission.add.mock.calls as [
      string,
      unknown,
      { jobId: string },
    ][];
    const ids = calls.map((c) => c[2].jobId);
    expect(ids).toEqual([
      'train-r1',
      'batch-b1',
      'score-s1',
      'train-r1',
      'batch-b1',
      'score-s1',
    ]);
  });

  it('fails a row that has waited past the limit', async () => {
    const { service, prisma, internals } = makeDeps();
    prisma.modelTrainingRun.findMany.mockImplementation(
      ({ where }: { where: { status?: string } }) =>
        Promise.resolve(
          where.status === 'QUEUED'
            ? [{ id: 'r1', createdAt: new Date(0) }]
            : [],
        ),
    );

    await service.sweep();

    expect(internals.admission.add).not.toHaveBeenCalled();
    expect(internals.admission.remove).toHaveBeenCalledWith('train-r1');
    expect(prisma.modelTrainingRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED' }) as object,
      }),
    );
  });

  it('writes the reason before killing a container past its runtime', async () => {
    const { service, prisma, runner } = makeDeps();
    const calls: string[] = [];
    prisma.modelTrainingRun.updateMany.mockImplementation(() => {
      calls.push('fail');
      return Promise.resolve({ count: 1 });
    });
    runner.kill.mockImplementation(() => {
      calls.push('kill');
      return Promise.resolve();
    });
    runner.listRunning.mockResolvedValue([
      { ...running('train'), startedAtMs: 0 },
      running('infer'),
    ]);

    await service.sweep();

    expect(calls).toEqual(['fail', 'kill']);
    expect(runner.kill).toHaveBeenCalledWith('c-train');
  });
});
