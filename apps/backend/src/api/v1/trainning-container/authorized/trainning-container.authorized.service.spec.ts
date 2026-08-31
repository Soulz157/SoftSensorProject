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

function buildPrisma(options: { runs: RunRow[]; findUniqueStatus?: string }) {
  return {
    modelTrainingRun: {
      findMany: jest.fn().mockResolvedValue(options.runs),
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

    expect(watchSpy).toHaveBeenCalledWith('run-1', container);
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
    expect(watchSpy).toHaveBeenCalledWith('run-live', expect.anything());

    watchSpy.mockRestore();
  });
});
