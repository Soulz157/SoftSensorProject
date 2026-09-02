import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ModelRunScoreAuthorizedService } from './model-run-score.authorized.service';
import * as pythonClient from '@/lib/python-preprocess-client';

jest.mock('@/lib/python-preprocess-client');

const mockedPresignRunObject = pythonClient.presignRunObject as jest.Mock;
const mockedGetRunManifest = pythonClient.getRunManifest as jest.Mock;

/**
 * MODEL-FLOW-016-T07. The scoring phase's own invariants, none of which
 * the trainer image is needed to prove: what the trigger REFUSES before
 * paying for a container, what the container may upload, and — the one
 * that matters most — that `/score-complete` cannot reach back and
 * rewrite a training run's already-recorded outcome.
 */

const SUCCEEDED_CV_RUN = {
  id: 'run-1',
  modelId: null as string | null,
  modelDraftId: 'draft-1' as string | null,
  datasetId: 'ds-1',
  goldArtifactId: 'gold-1',
  goldObjectKey: 'ds-1/artifacts/gold-1/data_gold.parquet',
  artifactChecksum: 'gold-checksum',
  featureSpecKey: 'ds-1/artifacts/gold-1/feature_spec.json' as string | null,
  targetY: 'TI-101',
  algorithm: 'ridge',
  imageDigest: 'sha256:abc',
  status: 'SUCCEEDED',
  cvFoldsKey: 'drafts/draft-1/runs/run-1/cv_folds.json' as string | null,
  modelKey: 'drafts/draft-1/runs/run-1/model.joblib' as string | null,
  manifestKey: 'drafts/draft-1/runs/run-1/run_manifest.json' as string | null,
  scoringContainerId: null as string | null,
};

function makeDeps(
  overrides: {
    run?: Record<string, unknown>;
    holdoutArtifact?: Record<string, unknown> | null;
  } = {},
) {
  const run = { ...SUCCEEDED_CV_RUN, ...overrides.run };
  const holdoutArtifact =
    overrides.holdoutArtifact === undefined
      ? {
          type: 'SILVER',
          objectKey: 'ds-1/artifacts/silver-1/data.parquet',
          validationRowCount: 878,
          validationHoldoutFrom: null,
        }
      : overrides.holdoutArtifact;

  const prisma = {
    modelTrainingRun: {
      findUnique: jest.fn().mockResolvedValue(run),
      findFirst: jest.fn().mockResolvedValue(run),
      update: jest.fn().mockResolvedValue(run),
    },
    datasetArtifact: {
      findUnique: jest.fn().mockResolvedValue({ runId: 'wizard-run-1' }),
      findFirst: jest.fn().mockResolvedValue(holdoutArtifact),
    },
  };

  const runs = {
    resolveHoldoutForRun: jest.fn().mockResolvedValue({
      holdoutDataUrl: 'https://minio.example/validate_ready.parquet',
      holdoutArtifactChecksum: 'holdout-checksum',
      holdoutRowCount: 878,
      holdoutDroppedBadRows: 4,
    }),
    mintUploadUrls: jest
      .fn()
      .mockResolvedValue({ upload_urls: {}, expires_at: 'later' }),
    appendLog: jest.fn().mockResolvedValue({}),
  };

  const launch = { assertDraftWritable: jest.fn().mockResolvedValue({}) };
  const runner = { spawn: jest.fn().mockResolvedValue(undefined) };

  const service = new ModelRunScoreAuthorizedService(
    prisma as unknown as ConstructorParameters<
      typeof ModelRunScoreAuthorizedService
    >[0],
    runs as unknown as ConstructorParameters<
      typeof ModelRunScoreAuthorizedService
    >[1],
    launch as unknown as ConstructorParameters<
      typeof ModelRunScoreAuthorizedService
    >[2],
    runner as unknown as ConstructorParameters<
      typeof ModelRunScoreAuthorizedService
    >[3],
  );

  return { service, prisma, runs, launch, runner };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedPresignRunObject.mockResolvedValue({
    data_url: 'https://minio.example/model.joblib',
    sidecar_urls: {},
    checksum: 'model-checksum',
    row_count: null,
    expires_at: 'later',
  });
  mockedGetRunManifest.mockResolvedValue({
    framework_versions: { sklearn: '1.5.2' },
    model_sha256: 'abc',
    feature_columns: ['TI-100', 'FI-200'],
  });
});

describe('triggerScoringService — what it refuses BEFORE spawning a container', () => {
  it('refuses a run that is not SUCCEEDED', async () => {
    const { service, runner } = makeDeps({ run: { status: 'RUNNING' } });

    await expect(
      service.triggerScoringService('draft-1', 'run-1', 'u1', 'USER'),
    ).rejects.toThrow(BadRequestException);
    expect(runner.spawn).not.toHaveBeenCalled();
  });

  it('refuses a NON-CV run — its holdout was already scored inline during training', async () => {
    const { service, runner } = makeDeps({ run: { cvFoldsKey: null } });

    await expect(
      service.triggerScoringService('draft-1', 'run-1', 'u1', 'USER'),
    ).rejects.toThrow(/not a Cross-Validation run/);
    expect(runner.spawn).not.toHaveBeenCalled();
  });

  it('refuses a run already being scored, rather than spawning a second container', async () => {
    const { service, runner } = makeDeps({
      run: { scoringContainerId: 'already-running' },
    });

    await expect(
      service.triggerScoringService('draft-1', 'run-1', 'u1', 'USER'),
    ).rejects.toThrow(/already being scored/);
    expect(runner.spawn).not.toHaveBeenCalled();
  });

  it('refuses a dataset with NO holdout — the phase could never produce a score (V06)', async () => {
    const { service, runner } = makeDeps({ holdoutArtifact: null });

    await expect(
      service.triggerScoringService('draft-1', 'run-1', 'u1', 'USER'),
    ).rejects.toThrow(/no validation holdout/);
    expect(runner.spawn).not.toHaveBeenCalled();
  });

  it('mints a FRESH token and spawns in score mode — the training token is already dead by now', async () => {
    const { service, prisma, runner } = makeDeps();

    await service.triggerScoringService('draft-1', 'run-1', 'u1', 'USER');

    const [[update]] = prisma.modelTrainingRun.update.mock.calls;
    expect(update.data.tokenHash).toEqual(expect.any(String));
    // Not new Date(0) — a live credential, unlike the one complete() closed.
    expect(update.data.tokenExpiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(runner.spawn).toHaveBeenCalledWith(
      'run-1',
      expect.any(String),
      'score',
    );
  });

  it('checks draft access before anything else', async () => {
    const { service, launch } = makeDeps();
    launch.assertDraftWritable.mockRejectedValue(new NotFoundException());

    await expect(
      service.triggerScoringService('draft-1', 'run-1', 'u1', 'USER'),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('scoreClaimService', () => {
  it('hands back the model + holdout + the manifest feature columns', async () => {
    const { service } = makeDeps();

    const claim = await service.scoreClaimService('run-1');

    expect(claim.modelUrl).toBe('https://minio.example/model.joblib');
    expect(claim.modelChecksum).toBe('model-checksum');
    expect(claim.featureColumns).toEqual(['TI-100', 'FI-200']);
    expect(claim.holdoutDataUrl).toBe(
      'https://minio.example/validate_ready.parquet',
    );
    // DS-LAKE-023-T05's own count, passed through so the container can
    // publish it beside the score rather than reporting an unstated subset.
    expect(claim.holdoutDroppedBadRows).toBe(4);
  });

  it('REFUSES a manifest with no feature_columns rather than guessing a column order', async () => {
    const { service } = makeDeps();
    mockedGetRunManifest.mockResolvedValue({
      framework_versions: null,
      model_sha256: null,
      feature_columns: null,
    });

    // A wrong column set predicts fine and scores plausibly — the
    // "looks like success" failure this feature's ledger keeps naming.
    await expect(service.scoreClaimService('run-1')).rejects.toThrow(
      /no recorded feature_columns/,
    );
  });

  it('fails loudly when the holdout vanished between trigger and claim', async () => {
    const { service, runs } = makeDeps();
    runs.resolveHoldoutForRun.mockResolvedValue(null);

    // Unlike claim()'s own soft-fail for a legitimately holdout-less
    // non-CV run, reaching here means trigger already found one.
    await expect(service.scoreClaimService('run-1')).rejects.toThrow(
      /could not be resolved at scoring-claim/,
    );
  });
});

describe('scoreUploadUrlsService — the write-path allowlist', () => {
  it('allows predictions.parquet', async () => {
    const { service, runs } = makeDeps();

    await service.scoreUploadUrlsService('run-1', ['predictions.parquet']);

    expect(runs.mintUploadUrls).toHaveBeenCalledWith('run-1', [
      'predictions.parquet',
    ]);
  });

  // Refused SYNCHRONOUSLY, before any promise exists — the guard runs
  // ahead of the mintUploadUrls call it protects, so a caller cannot
  // observe a half-started mint.
  it.each([
    'model.joblib',
    'metrics.json',
    'run_manifest.json',
    'cv_folds.json',
  ])(
    "REFUSES %s — a scoring container must not be able to overwrite the training run's own artifacts",
    (filename) => {
      const { service, runs } = makeDeps();

      expect(() => service.scoreUploadUrlsService('run-1', [filename])).toThrow(
        BadRequestException,
      );
      expect(runs.mintUploadUrls).not.toHaveBeenCalled();
    },
  );

  it('refuses a mixed request outright, rather than minting the allowed half', () => {
    const { service, runs } = makeDeps();

    expect(() =>
      service.scoreUploadUrlsService('run-1', [
        'predictions.parquet',
        'model.joblib',
      ]),
    ).toThrow(/model\.joblib/);
    expect(runs.mintUploadUrls).not.toHaveBeenCalled();
  });
});

describe('scoreCompleteService — a terminal run stays terminal', () => {
  it('writes ONLY predictionsKey + holdoutMetrics, clears the marker, closes the token', async () => {
    const { service, prisma } = makeDeps({
      run: { scoringContainerId: 'c-score' },
    });

    await service.scoreCompleteService('run-1', {
      status: 'SUCCEEDED',
      holdoutMetrics: { r2: 0.71, rmse: 1.2, mae: 0.9 },
      uploaded: ['predictions.parquet'],
    });

    const [[update]] = prisma.modelTrainingRun.update.mock.calls;
    expect(update.data.predictionsKey).toBe(
      'drafts/draft-1/runs/run-1/predictions.parquet',
    );
    expect(update.data.holdoutMetrics).toEqual({
      r2: 0.71,
      rmse: 1.2,
      mae: 0.9,
    });
    expect(update.data.scoringContainerId).toBeNull();
    expect(update.data.tokenExpiresAt).toEqual(new Date(0));

    // The invariant this whole controller/guard split exists to protect:
    // scoring must never re-open a run's own recorded training outcome.
    for (const forbidden of [
      'status',
      'finishedAt',
      'metrics',
      'splitSpec',
      'modelKey',
      'metricsKey',
      'manifestKey',
      'cvFoldsKey',
      'failureReason',
    ]) {
      expect(update.data).not.toHaveProperty(forbidden);
    }
  });

  it('a FAILED score clears the marker too — a failed phase is finished, not stuck', async () => {
    const { service, prisma, runs } = makeDeps({
      run: { scoringContainerId: 'c-score' },
    });

    await service.scoreCompleteService('run-1', {
      status: 'FAILED',
      failureReason: 'holdout had no labelled rows',
    });

    const [[update]] = prisma.modelTrainingRun.update.mock.calls;
    expect(update.data.scoringContainerId).toBeNull();
    // No predictions were uploaded, so the column must be left alone (a
    // previous successful score's key must not be nulled by a later
    // failed re-score).
    expect(update.data.predictionsKey).toBeUndefined();
    expect(update.data).not.toHaveProperty('status');
    expect(runs.appendLog).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ level: 'error' }),
    );
  });

  it('404s an unknown run', async () => {
    const { service, prisma } = makeDeps();
    prisma.modelTrainingRun.findUnique.mockResolvedValue(null);

    await expect(
      service.scoreCompleteService('nope', {
        status: 'SUCCEEDED',
        holdoutMetrics: { r2: 1 },
        uploaded: ['predictions.parquet'],
      }),
    ).rejects.toThrow(NotFoundException);
  });
});
