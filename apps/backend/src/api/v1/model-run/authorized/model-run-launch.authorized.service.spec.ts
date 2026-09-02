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
 * MODEL-FLOW-016-T11. `getDraftRunService` attaches a CV run's cv_folds.json
 * (never a second client-facing endpoint — the `lossHistory` precedent in
 * `advanceJobForRun` reads the same way, attached to a response the client
 * already fetches). Three claims, none covered elsewhere: the read is
 * skipped entirely for a non-CV run (no wasted python round-trip on the
 * poll loop's own hot path), it is attempted for a CV run and its result
 * attached verbatim, and a read failure is soft — logged, `cvFolds: null`,
 * never a failed run fetch over one auxiliary table.
 */
describe('ModelRunLaunchAuthorizedService.getDraftRunService — cv_folds attach', () => {
  const DRAFT = { id: 'draft-1', workspaceId: 'ws-1', status: 'TRAINED' };
  const CV_FOLDS = {
    algorithm: 'ridge',
    n_splits: 3,
    folds: [
      {
        fold: 1,
        cut_timestamp: '2026-01-01T00:00:00.000Z',
        train_rows: 100,
        test_rows: 25,
        distinct: 8,
        r2: 0.5,
        rmse: 0.2,
        mae: 0.15,
        train_r2: 0.6,
        train_rmse: 0.18,
        train_mae: 0.13,
      },
    ],
  };

  function makePrisma(run: Record<string, unknown>) {
    return {
      modelDraft: { findUnique: jest.fn().mockResolvedValue(DRAFT) },
      modelTrainingRun: { findFirst: jest.fn().mockResolvedValue(run) },
    };
  }

  const mockedGetRunCvFolds = pythonClient.getRunCvFolds as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('skips the read entirely for a non-CV run (cvFoldsKey null)', async () => {
    const prisma = makePrisma({ id: 'run-1', cvFoldsKey: null, logs: [] });
    const service = new ModelRunLaunchAuthorizedService(
      prisma as never,
      {} as never,
    );
    const result = await service.getDraftRunService(
      'draft-1',
      'run-1',
      'u1',
      'ADMIN',
    );
    expect(mockedGetRunCvFolds).not.toHaveBeenCalled();
    expect((result.data as { cvFolds: unknown }).cvFolds).toBeNull();
  });

  it('reads and attaches cv_folds.json verbatim for a CV run', async () => {
    mockedGetRunCvFolds.mockResolvedValue(CV_FOLDS);
    const prisma = makePrisma({
      id: 'run-1',
      cvFoldsKey: 'drafts/draft-1/runs/run-1/cv_folds.json',
      logs: [],
    });
    const service = new ModelRunLaunchAuthorizedService(
      prisma as never,
      {} as never,
    );
    const result = await service.getDraftRunService(
      'draft-1',
      'run-1',
      'u1',
      'ADMIN',
    );
    expect(mockedGetRunCvFolds).toHaveBeenCalledWith(
      'drafts/draft-1/runs/run-1/cv_folds.json',
    );
    expect((result.data as { cvFolds: unknown }).cvFolds).toEqual(CV_FOLDS);
  });

  it('soft-fails a read error to cvFolds: null, never failing the run fetch', async () => {
    mockedGetRunCvFolds.mockRejectedValue(new Error('minio unreachable'));
    const prisma = makePrisma({
      id: 'run-1',
      cvFoldsKey: 'drafts/draft-1/runs/run-1/cv_folds.json',
      logs: [],
    });
    const service = new ModelRunLaunchAuthorizedService(
      prisma as never,
      {} as never,
    );
    const result = await service.getDraftRunService(
      'draft-1',
      'run-1',
      'u1',
      'ADMIN',
    );
    expect((result.data as { cvFolds: unknown }).cvFolds).toBeNull();
    expect(result.statusCode).toBe(200);
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
    // MODEL-FLOW-016-T02. ALWAYS present now, in both modes — required by
    // PythonSplitStatsSchema.
    distinct_labelled_values: 40,
    max_admissible_k: 4,
    n_splits: null,
    folds: null,
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

/**
 * MODEL-FLOW-016-T03/T07. Creating a CROSS-VALIDATION run: the splitSpec it
 * commits, and the two refusals that must land BEFORE a container spawns —
 * this feature's own requirement is to refuse "before k fits are paid for",
 * and a container that spawns only to die on train.py's own backstop has
 * already cost the artifact download and the queue slot.
 */
describe('ModelRunLaunchAuthorizedService.launchDraftRun — cross-validation runs', () => {
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

  const CV_DTO = {
    goldArtifactId: 'art-1',
    targetY: 'TI-101',
    algorithm: 'ols',
    hyperparameters: {},
    nSplits: 5,
  } as never;

  function makePrisma(
    holdout: Record<string, unknown> | null = {
      type: 'SILVER',
      objectKey: 'ds-1/artifacts/silver-1/data.parquet',
      validationRowCount: 878,
      validationHoldoutFrom: null,
    },
  ) {
    const created = { id: 'run-1', modelDraftId: 'draft-1', status: 'QUEUED' };
    const createSpy = jest.fn().mockResolvedValue(created);
    const prisma = {
      modelDraft: {
        findUnique: jest.fn().mockResolvedValue({ status: 'DRAFT' }),
        update: jest.fn().mockResolvedValue({}),
      },
      datasetArtifact: {
        findUnique: jest.fn().mockResolvedValue(ARTIFACT),
        // findHoldoutArtifact's own second query.
        findFirst: jest.fn().mockResolvedValue(holdout),
      },
      modelTrainingRun: { update: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn().mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) =>
          await fn({
            modelTrainingRun: { create: createSpy },
            modelDraft: { update: jest.fn().mockResolvedValue({}) },
          }),
      ),
    };
    return { prisma, createSpy };
  }

  function makeService(prisma: unknown) {
    return new ModelRunLaunchAuthorizedService(
      prisma as never,
      {
        imageDigest: 'sha256:image',
        spawn: jest.fn().mockResolvedValue(undefined),
      } as never,
    );
  }

  // MODEL-FLOW-016-T02's CV-mode response: the ratio-mode fields are
  // present-but-null (never absent), and the fold plan replaces the single
  // cut. PythonSplitStatsSchema requires every key in both modes.
  const CV_SPLIT_STATS_RESPONSE = {
    source_key: ARTIFACT.objectKey,
    target_y: 'TI-101',
    split_ratio: null,
    cut_timestamp: null,
    train_labelled_rows: null,
    test_labelled_rows: null,
    source_rows: 1000,
    train: null,
    test: null,
    distinct_labelled_values: 40,
    max_admissible_k: 4,
    n_splits: 5,
    folds: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedFetchArtifactMetadata.mockResolvedValue(METADATA);
    mockedPostToPython.mockResolvedValue(CV_SPLIT_STATS_RESPONSE);
  });

  it("commits method cv_expanding with n_splits — the fold cuts are the container's to fill", async () => {
    const { prisma, createSpy } = makePrisma();

    await makeService(prisma).launchDraftRun('draft-1', CV_DTO);

    const [[created]] = createSpy.mock.calls;
    expect(created.data.splitSpec).toEqual({
      method: 'cv_expanding',
      n_splits: 5,
    });
  });

  it('REFUSES a dataset with no validation holdout, before any container spawns (V06)', async () => {
    const { prisma, createSpy } = makePrisma(null);

    // A CV run writes no predictions by design, so with no holdout its
    // model could never be scored at all — the user would pay for k+1
    // fits and get nothing they could act on.
    await expect(
      makeService(prisma).launchDraftRun('draft-1', CV_DTO),
    ).rejects.toThrow(/no validation holdout/);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it.each(['lstm', 'gru'])(
    'REFUSES %s + CV at config time — sequence models split on window count (T01(c))',
    async (algorithm) => {
      const { prisma, createSpy } = makePrisma();

      await expect(
        makeService(prisma).launchDraftRun('draft-1', {
          ...(CV_DTO as object),
          algorithm,
        } as never),
      ).rejects.toThrow(/not available for/);
      expect(createSpy).not.toHaveBeenCalled();
    },
  );

  it('freezes the split stats with n_splits, NOT split_ratio', async () => {
    const { prisma } = makePrisma();

    await makeService(prisma).launchDraftRun('draft-1', CV_DTO);
    await new Promise((resolve) => setImmediate(resolve));

    // The endpoint takes EXACTLY ONE of the two. Sending split_ratio for a
    // CV run would freeze a plausible-looking ratio-mode cut the run never
    // used — the "looks like success" failure this ledger keeps naming.
    expect(mockedPostToPython).toHaveBeenCalledWith(
      '/v1/preprocess/split-stats',
      {
        source_key: ARTIFACT.objectKey,
        tags: ['TI-101'],
        target_y: 'TI-101',
        n_splits: 5,
      },
      expect.any(Number),
    );
  });

  it('a non-CV run is unaffected — still chronological, still split_ratio', async () => {
    const { prisma, createSpy } = makePrisma();

    await makeService(prisma).launchDraftRun('draft-1', {
      goldArtifactId: 'art-1',
      targetY: 'TI-101',
      algorithm: 'ols',
      hyperparameters: {},
    } as never);
    await new Promise((resolve) => setImmediate(resolve));

    const [[created]] = createSpy.mock.calls;
    expect(created.data.splitSpec).toEqual({
      method: 'chronological',
      ratio: 0.8,
    });
    expect(mockedPostToPython).toHaveBeenCalledWith(
      '/v1/preprocess/split-stats',
      expect.objectContaining({ split_ratio: 0.8 }),
      expect.any(Number),
    );
    // The holdout lookup is a CV-only cost — a chronological run must not
    // pay for a query it has no use for.
    expect(prisma.datasetArtifact.findFirst).not.toHaveBeenCalled();
  });
});
