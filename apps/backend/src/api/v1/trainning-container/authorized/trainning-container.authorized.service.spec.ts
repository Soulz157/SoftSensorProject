import { TrainningContainerAuthorizedService } from './trainning-container.authorized.service';

/**
 * MODEL-FLOW-011-T04. Previously a 20-line CLI stub with no PrismaService and
 * `expect(service).toBeDefined()` as its only assertion — zero real coverage
 * on `watch()`'s exit-code branch or the boot reconcile this task adds.
 *
 * `dockerode` is mocked at the module level so `resolveDigest()` (which
 * always runs first in `onModuleInit`) never touches a real Docker socket.
 */

const mockGetImageInspect = jest.fn();
const mockGetContainer = jest.fn();

jest.mock('dockerode', () =>
  jest.fn().mockImplementation(() => ({
    getImage: () => ({ inspect: mockGetImageInspect }),
    getContainer: mockGetContainer,
    pull: jest.fn(),
    modem: { followProgress: jest.fn() },
  })),
);

interface RunRow {
  id: string;
  containerId: string | null;
}

interface ScoringRunRow {
  id: string;
  scoringContainerId: string | null;
}

/**
 * MODEL-FLOW-016-T07. `findMany` now runs TWICE per boot reconcile — the
 * pre-existing `status: 'RUNNING'` sweep, and a second `scoringContainerId`
 * sweep. Discriminated by `where` shape rather than call order, so each
 * test can supply either independently of the other (`runs` defaults to
 * `[]`-equivalent behaviour when omitted, same as `scoringRuns`).
 */
/**
 * MODEL-SERVE-003-V01. A third findMany — predictionJob, its own model, not
 * a discriminated modelTrainingRun.findMany call the way the scoring sweep
 * is. Defaults to `[]` so every existing test above (which builds a
 * prisma mock with no `jobs` option) is unaffected.
 */
function buildPrisma(options: {
  runs: RunRow[];
  scoringRuns?: ScoringRunRow[];
  jobs?: RunRow[];
  findUniqueStatus?: string;
}) {
  return {
    modelTrainingRun: {
      findMany: jest
        .fn()
        .mockImplementation((args: { where: Record<string, unknown> }) =>
          Promise.resolve(
            'status' in args.where ? options.runs : (options.scoringRuns ?? []),
          ),
        ),
      findUnique: jest
        .fn()
        .mockResolvedValue({ status: options.findUniqueStatus ?? 'RUNNING' }),
      update: jest.fn().mockResolvedValue({}),
    },
    predictionJob: {
      findMany: jest.fn().mockResolvedValue(options.jobs ?? []),
      findUnique: jest
        .fn()
        .mockResolvedValue({ status: options.findUniqueStatus ?? 'RUNNING' }),
      update: jest.fn().mockResolvedValue({}),
    },
  };
}

function makeService(prisma: ReturnType<typeof buildPrisma>) {
  return new TrainningContainerAuthorizedService(
    prisma as unknown as ConstructorParameters<
      typeof TrainningContainerAuthorizedService
    >[0],
  );
}

describe('TrainningContainerAuthorizedService — boot reconcile (MODEL-FLOW-011-T04)', () => {
  beforeEach(() => {
    mockGetImageInspect.mockReset().mockResolvedValue({
      RepoDigests: ['scgc/soft-sensor-trainer@sha256:test'],
      Id: 'sha256:test',
    });
    mockGetContainer.mockReset();
  });

  it('does nothing when there are no RUNNING rows', async () => {
    const prisma = buildPrisma({ runs: [] });
    const service = makeService(prisma);

    await service.onModuleInit();

    expect(mockGetContainer).not.toHaveBeenCalled();
    expect(prisma.modelTrainingRun.update).not.toHaveBeenCalled();
  });

  it('queries exactly the RUNNING rows, by id and containerId only', async () => {
    const prisma = buildPrisma({ runs: [] });
    const service = makeService(prisma);

    await service.onModuleInit();

    expect(prisma.modelTrainingRun.findMany).toHaveBeenCalledWith({
      where: { status: 'RUNNING' },
      select: { id: true, containerId: true },
    });
  });

  it('a run with no containerId FAILS with a reason naming that it never spawned', async () => {
    const prisma = buildPrisma({ runs: [{ id: 'run-1', containerId: null }] });
    const service = makeService(prisma);

    await service.onModuleInit();

    expect(mockGetContainer).not.toHaveBeenCalled();
    expect(prisma.modelTrainingRun.update).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: {
        status: 'FAILED',
        failureReason: expect.stringContaining('never spawned'),
        finishedAt: expect.any(Date),
      },
    });
  });

  it('a run whose container no longer exists FAILS, naming the container id', async () => {
    mockGetContainer.mockReturnValue({
      inspect: jest.fn().mockRejectedValue(new Error('no such container: c1')),
    });
    const prisma = buildPrisma({ runs: [{ id: 'run-1', containerId: 'c1' }] });
    const service = makeService(prisma);

    await service.onModuleInit();

    expect(prisma.modelTrainingRun.update).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: {
        status: 'FAILED',
        failureReason: expect.stringContaining('c1'),
        finishedAt: expect.any(Date),
      },
    });
    const [[{ data }]] = prisma.modelTrainingRun.update.mock.calls;
    expect(data.failureReason).toContain('no longer exists');
  });

  it('a run whose container still exists is re-attached to watch(), not failed directly', async () => {
    const watchSpy = jest
      .spyOn(
        TrainningContainerAuthorizedService.prototype as unknown as Record<
          string,
          (...args: unknown[]) => Promise<void>
        >,
        'watch',
      )
      .mockResolvedValue(undefined);
    const container = {
      id: 'c1',
      inspect: jest
        .fn()
        .mockResolvedValue({ Id: 'c1', State: { Running: true } }),
    };
    mockGetContainer.mockReturnValue(container);
    const prisma = buildPrisma({ runs: [{ id: 'run-1', containerId: 'c1' }] });
    const service = makeService(prisma);

    await service.onModuleInit();

    expect(watchSpy).toHaveBeenCalledWith('run-1', container, 'train');
    // The reconcile loop itself never writes FAILED for an existing
    // container — only watch()'s own exit-code branch may, and it is
    // mocked away here.
    expect(prisma.modelTrainingRun.update).not.toHaveBeenCalled();

    watchSpy.mockRestore();
  });

  it('a container that already exited reaches FAILED through the SAME watch() branch the live watcher uses — not a second copy of that logic here', async () => {
    const watchSpy = jest.spyOn(
      TrainningContainerAuthorizedService.prototype as unknown as Record<
        string,
        (...args: unknown[]) => Promise<void>
      >,
      'watch',
    );
    const container = {
      id: 'c1',
      inspect: jest
        .fn()
        .mockResolvedValue({ Id: 'c1', State: { Running: false } }),
      wait: jest.fn().mockResolvedValue({ StatusCode: 1 }),
      logs: jest.fn().mockResolvedValue(Buffer.from('boom')),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    mockGetContainer.mockReturnValue(container);
    const prisma = buildPrisma({ runs: [{ id: 'run-1', containerId: 'c1' }] });
    const service = makeService(prisma);

    await service.onModuleInit();
    // reconcileOrphanedRuns fires watch() with `void` — wait for the same
    // promise watch() itself returned before asserting on its effect.
    await watchSpy.mock.results[0].value;

    expect(prisma.modelTrainingRun.update).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: {
        status: 'FAILED',
        failureReason: expect.stringContaining('Container exited 1'),
        finishedAt: expect.any(Date),
      },
    });
    expect(container.remove).toHaveBeenCalled();

    watchSpy.mockRestore();
  });

  it('reconciles every orphaned run independently — one failure does not block the others', async () => {
    mockGetContainer.mockImplementation((id: string) => {
      if (id === 'gone') {
        return { inspect: jest.fn().mockRejectedValue(new Error('404')) };
      }
      return {
        inspect: jest
          .fn()
          .mockResolvedValue({ Id: id, State: { Running: true } }),
      };
    });
    const watchSpy = jest
      .spyOn(
        TrainningContainerAuthorizedService.prototype as unknown as Record<
          string,
          (...args: unknown[]) => Promise<void>
        >,
        'watch',
      )
      .mockResolvedValue(undefined);
    const prisma = buildPrisma({
      runs: [
        { id: 'run-no-container', containerId: null },
        { id: 'run-gone', containerId: 'gone' },
        { id: 'run-live', containerId: 'alive' },
      ],
    });
    const service = makeService(prisma);

    await service.onModuleInit();

    expect(prisma.modelTrainingRun.update).toHaveBeenCalledTimes(2);
    expect(prisma.modelTrainingRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'run-no-container' } }),
    );
    expect(prisma.modelTrainingRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'run-gone' } }),
    );
    expect(watchSpy).toHaveBeenCalledWith(
      'run-live',
      expect.anything(),
      'train',
    );

    watchSpy.mockRestore();
  });

  it('a scoring container that no longer exists clears scoringContainerId — the training run status/metrics are untouched', async () => {
    mockGetContainer.mockReturnValue({
      inspect: jest.fn().mockRejectedValue(new Error('no such container: s1')),
    });
    const prisma = buildPrisma({
      runs: [],
      scoringRuns: [{ id: 'run-1', scoringContainerId: 's1' }],
    });
    const service = makeService(prisma);

    await service.onModuleInit();

    expect(prisma.modelTrainingRun.update).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: { scoringContainerId: null },
    });
  });

  it('a scoring container that still exists is re-attached to watch() in score mode', async () => {
    const watchSpy = jest
      .spyOn(
        TrainningContainerAuthorizedService.prototype as unknown as Record<
          string,
          (...args: unknown[]) => Promise<void>
        >,
        'watch',
      )
      .mockResolvedValue(undefined);
    const container = {
      id: 's1',
      inspect: jest
        .fn()
        .mockResolvedValue({ Id: 's1', State: { Running: true } }),
    };
    mockGetContainer.mockReturnValue(container);
    const prisma = buildPrisma({
      runs: [],
      scoringRuns: [{ id: 'run-1', scoringContainerId: 's1' }],
    });
    const service = makeService(prisma);

    await service.onModuleInit();

    expect(watchSpy).toHaveBeenCalledWith('run-1', container, 'score');
    // Same discipline as the training case — the reconcile loop itself
    // never writes for an existing container, only watch()'s own
    // exit-code branch may, and it is mocked away here.
    expect(prisma.modelTrainingRun.update).not.toHaveBeenCalled();

    watchSpy.mockRestore();
  });

  // MODEL-SERVE-003-V01. Same existence-check sweep, own model
  // (predictionJob, not modelTrainingRun) — mirrors the training-run cases
  // above exactly, since it is the identical per-row discipline applied to
  // a different table.
  it('a prediction job with no containerId FAILS with a reason naming that it never spawned', async () => {
    const prisma = buildPrisma({
      runs: [],
      jobs: [{ id: 'job-1', containerId: null }],
    });
    const service = makeService(prisma);

    await service.onModuleInit();

    expect(mockGetContainer).not.toHaveBeenCalled();
    expect(prisma.predictionJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: {
        status: 'FAILED',
        failureReason: expect.stringContaining('never spawned'),
        finishedAt: expect.any(Date),
      },
    });
  });

  it('a prediction job whose container no longer exists FAILS, naming the container id', async () => {
    mockGetContainer.mockReturnValue({
      inspect: jest.fn().mockRejectedValue(new Error('no such container: b1')),
    });
    const prisma = buildPrisma({
      runs: [],
      jobs: [{ id: 'job-1', containerId: 'b1' }],
    });
    const service = makeService(prisma);

    await service.onModuleInit();

    const [[{ data }]] = prisma.predictionJob.update.mock.calls;
    expect(data.status).toBe('FAILED');
    expect(data.failureReason).toContain('b1');
    expect(data.failureReason).toContain('no longer exists');
  });

  it('a prediction job whose container still exists is re-attached to watch() in batch mode', async () => {
    const watchSpy = jest
      .spyOn(
        TrainningContainerAuthorizedService.prototype as unknown as Record<
          string,
          (...args: unknown[]) => Promise<void>
        >,
        'watch',
      )
      .mockResolvedValue(undefined);
    const container = {
      id: 'b1',
      inspect: jest
        .fn()
        .mockResolvedValue({ Id: 'b1', State: { Running: true } }),
    };
    mockGetContainer.mockReturnValue(container);
    const prisma = buildPrisma({
      runs: [],
      jobs: [{ id: 'job-1', containerId: 'b1' }],
    });
    const service = makeService(prisma);

    await service.onModuleInit();

    expect(watchSpy).toHaveBeenCalledWith('job-1', container, 'batch');
    expect(prisma.predictionJob.update).not.toHaveBeenCalled();

    watchSpy.mockRestore();
  });
});
