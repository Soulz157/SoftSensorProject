import { NotFoundException } from '@nestjs/common';
import { AppException } from '@softsensor/common';
import { ModelRunLaunchAuthorizedService } from './model-run-launch.authorized.service';
import * as pythonClient from '@/lib/python-preprocess-client';

jest.mock('@/lib/python-preprocess-client');

const mockedRunPredictions = pythonClient.runPredictions as jest.Mock;

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
