import { ModelRunAutoScoreAuthorizedService } from './model-run-auto-score.authorized.service';
import { findHoldoutArtifact } from '@/lib/holdout-artifact';

jest.mock('@/lib/holdout-artifact', () => ({
  findHoldoutArtifact: jest.fn(),
}));

const mockedFindHoldout = findHoldoutArtifact as jest.MockedFunction<
  typeof findHoldoutArtifact
>;

/**
 * MODEL-FLOW-019-T39. `autoScoreRunsService` only — the system-triggered
 * path that fires when a candidate job finishes. Its whole contract is
 * WHICH runs it spawns a container for and which it silently skips, so
 * every case here asserts against `runner.spawn`.
 */
function makeService(run: Record<string, unknown> | null) {
  const prisma = {
    modelTrainingRun: {
      findUnique: jest.fn().mockResolvedValue(run),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const runner = { spawn: jest.fn().mockResolvedValue(undefined) };
  const service = new ModelRunAutoScoreAuthorizedService(
    prisma as never,
    runner as never,
  );
  return { service, prisma, runner };
}

const okRun = (over: Record<string, unknown> = {}) => ({
  id: 'run-1',
  status: 'SUCCEEDED',
  algorithm: 'xgboost',
  featureSpecKey: 'spec.json',
  modelKey: 'model.joblib',
  goldArtifactId: 'gold-1',
  holdoutMetrics: null,
  scoringContainerId: null,
  ...over,
});

describe('autoScoreRunsService (MODEL-FLOW-019-T39)', () => {
  beforeEach(() => {
    mockedFindHoldout.mockReset();
    mockedFindHoldout.mockResolvedValue({
      type: 'SILVER',
      objectKey: 'k',
      validationRowCount: 743,
      validationHoldoutFrom: new Date(),
      validationAlreadyScaled: false,
    } as never);
  });

  it('spawns a scoring container for a SUCCEEDED, unscored run with a holdout', async () => {
    // The case the whole feature exists for: a holdout the user cut, and a
    // run that would otherwise sit unscored until someone found the button.
    const { service, runner, prisma } = makeService(okRun());

    await service.autoScoreRunsService(['run-1']);

    expect(prisma.modelTrainingRun.update).toHaveBeenCalled();
    expect(runner.spawn).toHaveBeenCalledWith(
      'run-1',
      expect.any(String),
      'score',
    );
  });

  it('skips a run that is already scored — re-entering completion must not double-spawn', async () => {
    const { service, runner } = makeService(
      okRun({ holdoutMetrics: { rmse: 1 } }),
    );

    await service.autoScoreRunsService(['run-1']);

    expect(runner.spawn).not.toHaveBeenCalled();
  });

  it('skips a run already being scored', async () => {
    const { service, runner } = makeService(
      okRun({ scoringContainerId: 'container-9' }),
    );

    await service.autoScoreRunsService(['run-1']);

    expect(runner.spawn).not.toHaveBeenCalled();
  });

  it('skips a dataset with no holdout — nothing to score against, and not an error', async () => {
    mockedFindHoldout.mockResolvedValue(null);
    const { service, runner } = makeService(okRun());

    await service.autoScoreRunsService(['run-1']);

    expect(runner.spawn).not.toHaveBeenCalled();
  });

  it.each(['lstm', 'gru'])(
    'skips %s — score.py has no windowing path',
    async (algorithm) => {
      const { service, runner } = makeService(okRun({ algorithm }));

      await service.autoScoreRunsService(['run-1']);

      expect(runner.spawn).not.toHaveBeenCalled();
    },
  );

  it('skips a run that never finished', async () => {
    const { service, runner } = makeService(okRun({ status: 'FAILED' }));

    await service.autoScoreRunsService(['run-1']);

    expect(runner.spawn).not.toHaveBeenCalled();
  });

  it('never throws when a spawn fails — job completion must not fail with it', async () => {
    const { service, runner } = makeService(okRun());
    runner.spawn.mockRejectedValue(new Error('no docker daemon'));

    await expect(
      service.autoScoreRunsService(['run-1']),
    ).resolves.toBeUndefined();
  });

  it('keeps going after one run fails, so a bad candidate cannot silence the rest', async () => {
    const prisma = {
      modelTrainingRun: {
        findUnique: jest
          .fn()
          .mockRejectedValueOnce(new Error('row vanished'))
          .mockResolvedValueOnce(okRun({ id: 'run-2' })),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const runner = { spawn: jest.fn().mockResolvedValue(undefined) };
    const service = new ModelRunAutoScoreAuthorizedService(
      prisma as never,
      runner as never,
    );

    await service.autoScoreRunsService(['run-1', 'run-2']);

    expect(runner.spawn).toHaveBeenCalledTimes(1);
    expect(runner.spawn).toHaveBeenCalledWith(
      'run-2',
      expect.any(String),
      'score',
    );
  });
});
