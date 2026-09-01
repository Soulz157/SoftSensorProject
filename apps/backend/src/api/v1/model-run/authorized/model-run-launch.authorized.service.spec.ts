import { NotFoundException } from '@nestjs/common';
import { AppException } from '@softsensor/common';
import { ModelRunLaunchAuthorizedService } from './model-run-launch.authorized.service';
import * as pythonClient from '@/lib/python-preprocess-client';
import * as pythonPostClient from '@/lib/python-client';

jest.mock('@/lib/python-preprocess-client');
// PYTHON_TIMEOUT re-declared as a literal, not spread via requireActual
// (which returns `any` and trips no-unsafe-return) — launchDraftRun only
// reads `.metadata` off it, as a bare number `postToPython`'s call site
// forwards, so its exact value has no bearing on what these tests assert.
jest.mock('@/lib/python-client', () => ({
  PYTHON_TIMEOUT: { test: 15_000, metadata: 300_000, fetch: 120_000 },
  postToPython: jest.fn(),
}));

const mockedRunPredictions = pythonClient.runPredictions as jest.Mock;
const mockedFetchArtifactMetadata =
  pythonClient.fetchArtifactMetadata as jest.Mock;
const mockedPostToPython = pythonPostClient.postToPython as jest.Mock;

/**
 * MODEL-FLOW-004: `getDraftRunPredictionsService`. Role is 'ADMIN' throughout
 * — `assertHasAccess` bypasses the workspace/member lookup for that role, so
 * these tests isolate the method under test rather than re-proving
 * `assertHasAccess` itself, which has no dedicated coverage of its own to
 * duplicate here.
 */
describe('ModelRunLaunchAuthorizedService.getDraftRunPredictionsService', () => {
  const DRAFT = { id: 'draft-1', workspaceId: 'ws-1', status: 'TRAINED' };

  function makePrisma(
    overrides: {
      draft?: Record<string, unknown> | null;
      run?: Record<string, unknown> | null;
    } = {},
  ) {
    const draft = overrides.draft === undefined ? DRAFT : overrides.draft;
    const run =
      overrides.run === undefined
        ? {
            status: 'SUCCEEDED',
            predictionsKey: 'drafts/draft-1/runs/run-1/predictions.parquet',
            manifestKey: 'drafts/draft-1/runs/run-1/run_manifest.json',
          }
        : overrides.run;

    return {
      modelDraft: { findUnique: jest.fn().mockResolvedValue(draft) },
      modelTrainingRun: { findFirst: jest.fn().mockResolvedValue(run) },
    };
  }

  const PREDICTIONS = {
    source_key: 'drafts/draft-1/runs/run-1/predictions.parquet',
    row_count: 2,
    residual_sd: 0.1,
    residual_rmse_check: 0.1,
    y_true_min: 1,
    y_true_max: 2,
    y_pred_min: 1.1,
    y_pred_max: 1.9,
    points: [
      { timestamp: '2026-01-01 00:00:00', y_true: 1, y_pred: 1.1 },
      { timestamp: '2026-01-01 00:10:00', y_true: 2, y_pred: 1.9 },
    ],
    derived_from_target: [],
    target_scaled: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedRunPredictions.mockResolvedValue(PREDICTIONS);
  });

  it('refuses (404) when the draft does not exist', async () => {
    const prisma = makePrisma({ draft: null });
    const service = new ModelRunLaunchAuthorizedService(
      prisma as never,
      {} as never,
    );
    await expect(
      service.getDraftRunPredictionsService('draft-1', 'run-1', 'u1', 'ADMIN'),
    ).rejects.toThrow(NotFoundException);
    expect(mockedRunPredictions).not.toHaveBeenCalled();
  });

  it('refuses (404) when the run does not exist under that draft', async () => {
    const prisma = makePrisma({ run: null });
    const service = new ModelRunLaunchAuthorizedService(
      prisma as never,
      {} as never,
    );
    await expect(
      service.getDraftRunPredictionsService('draft-1', 'run-1', 'u1', 'ADMIN'),
    ).rejects.toThrow(NotFoundException);
    expect(mockedRunPredictions).not.toHaveBeenCalled();
  });

  it('refuses (404) a run that has not SUCCEEDED, naming its status', async () => {
    const prisma = makePrisma({
      run: {
        status: 'RUNNING',
        predictionsKey: null,
        manifestKey: null,
      },
    });
    const service = new ModelRunLaunchAuthorizedService(
      prisma as never,
      {} as never,
    );
    await expect(
      service.getDraftRunPredictionsService('draft-1', 'run-1', 'u1', 'ADMIN'),
    ).rejects.toMatchObject(
      expect.objectContaining({
        statusCode: 404,
        message: expect.stringContaining('RUNNING'),
      }),
    );
    expect(mockedRunPredictions).not.toHaveBeenCalled();
  });

  it('refuses (404) a SUCCEEDED run with no predictionsKey', async () => {
    const prisma = makePrisma({
      run: { status: 'SUCCEEDED', predictionsKey: null, manifestKey: null },
    });
    const service = new ModelRunLaunchAuthorizedService(
      prisma as never,
      {} as never,
    );
    await expect(
      service.getDraftRunPredictionsService('draft-1', 'run-1', 'u1', 'ADMIN'),
    ).rejects.toBeInstanceOf(AppException);
    expect(mockedRunPredictions).not.toHaveBeenCalled();
  });

  it('resolves the key off the run row and returns the envelope on success', async () => {
    const prisma = makePrisma();
    const service = new ModelRunLaunchAuthorizedService(
      prisma as never,
      {} as never,
    );
    const result = await service.getDraftRunPredictionsService(
      'draft-1',
      'run-1',
      'u1',
      'ADMIN',
    );

    expect(mockedRunPredictions).toHaveBeenCalledWith({
      source_key: 'drafts/draft-1/runs/run-1/predictions.parquet',
      manifest_key: 'drafts/draft-1/runs/run-1/run_manifest.json',
    });
    expect(result).toEqual({
      statusCode: 200,
      message: 'Training run predictions fetched',
      type: 'SUCCESS',
      data: PREDICTIONS,
    });
  });
});

/**
 * MODEL-FLOW-014-T06. `freezeSplitStats` is the one fire-and-forget path in
 * this feature — called from inside `launchDraftRun`, never awaited by it,
 * so a wiring bug here is silent by construction (the run itself is
 * created and returned regardless of whether the freeze succeeds). Three
 * claims, none covered anywhere else in this repo (confirmed by `find` for
 * launch specs before writing this): it fires exactly once for a single
 * run, it does NOT fire for a candidate run, and its own failure cannot
 * touch the run that was already returned to the caller.
 */
describe('ModelRunLaunchAuthorizedService.launchDraftRun — freezeSplitStats', () => {
  const ARTIFACT = {
    id: 'art-1',
    type: 'FINAL',
    checksum: 'sha256:abc',
    datasetId: 'ds-1',
    objectKey: 'datasets/ds-1/final/data.parquet',
    featureSpecKey: 'feature_spec.json',
  };

  const METADATA = {
    tags: ['TI-101', 'PI-201'],
    column_count: 2,
    row_count: 1000,
    start_time: null,
    end_time: null,
  };

  const DTO = {
    goldArtifactId: 'art-1',
    targetY: 'TI-101',
    algorithm: 'ols',
    hyperparameters: {},
  } as never;

  const SPLIT_STATS_RESPONSE = {
    source_key: ARTIFACT.objectKey,
    target_y: 'TI-101',
    split_ratio: 0.8,
    cut_timestamp: '2026-06-01T00:00:00.000Z',
    train_labelled_rows: 800,
    test_labelled_rows: 200,
    source_rows: 1000,
    train: { tags: [], insufficient_tags: [] },
    test: { tags: [], insufficient_tags: [] },
  };

  function makePrisma() {
    const created = {
      id: 'run-1',
      modelDraftId: 'draft-1',
      status: 'QUEUED',
    };
    return {
      modelDraft: {
        findUnique: jest.fn().mockResolvedValue({ status: 'DRAFT' }),
        update: jest.fn().mockResolvedValue({}),
      },
      datasetArtifact: {
        findUnique: jest.fn().mockResolvedValue(ARTIFACT),
      },
      modelTrainingRun: {
        update: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn().mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) =>
          await fn({
            modelTrainingRun: {
              create: jest.fn().mockResolvedValue(created),
            },
            modelDraft: { update: jest.fn().mockResolvedValue({}) },
          }),
      ),
    };
  }

  function makeRunner() {
    return {
      imageDigest: 'sha256:image',
      spawn: jest.fn().mockResolvedValue(undefined),
    };
  }

  // Flushes the microtask queue past freezeSplitStats' own `.then()`/
  // `.catch()` chain — launchDraftRun returns before that chain settles
  // (it is fire-and-forget by design), so a test asserting on its OUTCOME,
  // not just that it was started, needs to wait past it explicitly.
  async function flushFireAndForget() {
    await new Promise((resolve) => setImmediate(resolve));
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockedFetchArtifactMetadata.mockResolvedValue(METADATA);
    mockedPostToPython.mockResolvedValue(SPLIT_STATS_RESPONSE);
  });

  it('fires once for a single run (no candidateJobId) and records the parsed result on that run', async () => {
    const prisma = makePrisma();
    const service = new ModelRunLaunchAuthorizedService(
      prisma as never,
      makeRunner() as never,
    );

    const run = await service.launchDraftRun('draft-1', DTO);
    await flushFireAndForget();

    expect(mockedPostToPython).toHaveBeenCalledTimes(1);
    expect(mockedPostToPython).toHaveBeenCalledWith(
      '/v1/preprocess/split-stats',
      {
        source_key: ARTIFACT.objectKey,
        tags: ['TI-101'], // defaults to [dto.targetY] — DTO sends no splitStatsTags
        target_y: 'TI-101',
        split_ratio: 0.8, // dto.trainTestSplit ?? 0.8 — the RESOLVED ratio
      },
      expect.any(Number),
    );
    expect(prisma.modelTrainingRun.update).toHaveBeenCalledWith({
      where: { id: run.id },
      data: { splitStats: SPLIT_STATS_RESPONSE },
    });
  });

  it('does NOT fire for a candidate run (candidateJobId set) — a candidate shares its split with its job, not this column', async () => {
    const prisma = makePrisma();
    const service = new ModelRunLaunchAuthorizedService(
      prisma as never,
      makeRunner() as never,
    );

    await service.launchDraftRun('draft-1', DTO, 'job-1');
    await flushFireAndForget();

    expect(mockedPostToPython).not.toHaveBeenCalled();
    expect(prisma.modelTrainingRun.update).not.toHaveBeenCalled();
  });

  it('a rejected postToPython leaves the returned run unaffected — the freeze is structurally incapable of failing the run', async () => {
    mockedPostToPython.mockRejectedValue(new Error('python unreachable'));
    const prisma = makePrisma();
    const service = new ModelRunLaunchAuthorizedService(
      prisma as never,
      makeRunner() as never,
    );

    // The run creation itself must not reject or even wait on the freeze.
    const run = await service.launchDraftRun('draft-1', DTO);
    expect(run.id).toBe('run-1');

    await flushFireAndForget();

    // The failed freeze never reaches the update call — splitStats stays
    // unset (honest-legacy-null), and nothing about the run row changes.
    expect(prisma.modelTrainingRun.update).not.toHaveBeenCalled();
  });
});
