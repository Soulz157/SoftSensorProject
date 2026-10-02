import {
  ModelRunPredictionsQuerySchema,
  RunCompleteSchema,
  RunUploadUrlsSchema,
  SplitSpecSchema,
} from './model-run.authorized.dto';

/**
 * MODEL-FLOW-016-T03/V07. `SplitSpecSchema` gained a third
 * discriminated-union member (`cv_expanding`) — MODEL-FLOW-009-T04's own
 * windowed variant was found ONE REVIEW SHORT of 400ing a successful run's
 * own /complete call because the schema was never tested against the exact
 * shape the trainer actually sends. This file exists so a CV run's
 * completion payload is proven to validate BEFORE a live run can discover
 * otherwise.
 */
describe('SplitSpecSchema — cv_expanding variant', () => {
  const validCvSplitSpec = {
    method: 'cv_expanding' as const,
    n_splits: 3,
    source_rows: 8350,
    labelled_rows: 8350,
    distinct_labelled_values: 32,
    folds: [
      {
        cut_timestamp: '2026-02-05 14:15:00',
        train_rows: 2089,
        test_rows: 2087,
      },
      {
        cut_timestamp: '2026-02-12 20:15:00',
        train_rows: 4176,
        test_rows: 2087,
      },
      {
        cut_timestamp: '2026-02-20 02:10:00',
        train_rows: 6263,
        test_rows: 2087,
      },
    ],
  };

  it('accepts a well-formed cv_expanding splitSpec — the exact shape train.py sends', () => {
    const result = SplitSpecSchema.safeParse(validCvSplitSpec);
    expect(result.success).toBe(true);
  });

  it('rejects a cv_expanding splitSpec carrying an unknown field (.strict())', () => {
    const result = SplitSpecSchema.safeParse({
      ...validCvSplitSpec,
      ratio: 0.8, // a chronological-mode field that must not leak in here
    });
    expect(result.success).toBe(false);
  });

  it('rejects n_splits outside [2, 10]', () => {
    expect(
      SplitSpecSchema.safeParse({ ...validCvSplitSpec, n_splits: 1 }).success,
    ).toBe(false);
    expect(
      SplitSpecSchema.safeParse({ ...validCvSplitSpec, n_splits: 11 }).success,
    ).toBe(false);
  });

  it('MODEL-SERVE-027 — accepts an Existing + new run’s split record (the one that 400’d live), still refuses an unknown field', () => {
    const live = {
      method: 'chronological',
      ratio: 0.7,
      cut_timestamp: '2025-09-29 03:00:00',
      train_rows: 2187,
      test_rows: 928,
      source_rows: 3115,
      labelled_rows: 3115,
      new_data_from: '2025-11-07 19:01:00',
      new_train_rows: 24,
    };
    expect(SplitSpecSchema.safeParse(live).success).toBe(true);
    expect(SplitSpecSchema.safeParse({ ...live, surprise: 1 }).success).toBe(
      false,
    );
  });

  it('the two pre-existing variants still validate unchanged', () => {
    expect(
      SplitSpecSchema.safeParse({
        method: 'chronological',
        ratio: 0.8,
        cut_timestamp: '2026-01-01',
        train_rows: 80,
        test_rows: 20,
        source_rows: 100,
        labelled_rows: 100,
      }).success,
    ).toBe(true);
    expect(
      SplitSpecSchema.safeParse({
        method: 'chronological_windowed',
        ratio: 0.8,
        cut_timestamp: '2026-01-01',
        sequence_length: 24,
        train_rows: 80,
        test_rows: 20,
        source_rows: 100,
        labelled_rows: 100,
      }).success,
    ).toBe(true);
  });

  it('MODEL-FLOW-016-V07: a real CV run completion payload validates end to end against RunCompleteSchema', () => {
    const result = RunCompleteSchema.safeParse({
      status: 'SUCCEEDED',
      metrics: {
        cv_r2_mean: 0.8949,
        cv_r2_std: 0.0589,
        cv_rmse_mean: 0.584,
        cv_rmse_std: 0.0423,
        cv_mae_mean: 0.4933,
        cv_mae_std: 0.0202,
        n_splits: 3,
        refit_rows: 8350,
        feature_count: 12,
      },
      splitSpec: validCvSplitSpec,
      uploaded: [
        'model.joblib',
        'metrics.json',
        'run_manifest.json',
        'cv_folds.json',
      ],
    });
    expect(result.success).toBe(true);
  });
});

/**
 * MODEL-SERVE-020-T06. A trainer image that WRITES the new-data series is
 * useless if the API refuses to mint its upload URL or to accept it in
 * `uploaded` — the container's upload would fail (or, worse, be silently
 * dropped) on a request nothing in the trainer's own tests can reach. Both
 * schemas derive from RUN_UPLOAD_FILENAMES, so this pins that one list.
 */
describe('new_data_holdout_predictions.parquet — the API admits the artifact', () => {
  it('mints an upload URL for it', () => {
    const r = RunUploadUrlsSchema.safeParse({
      filenames: ['model.joblib', 'new_data_holdout_predictions.parquet'],
    });
    expect(r.success).toBe(true);
  });

  it('accepts it in a completed run’s `uploaded`', () => {
    const r = RunCompleteSchema.safeParse({
      status: 'SUCCEEDED',
      uploaded: ['model.joblib', 'new_data_holdout_predictions.parquet'],
    });
    expect(r.success).toBe(true);
  });

  it('still refuses a filename that is not a run output', () => {
    const r = RunUploadUrlsSchema.safeParse({ filenames: ['../../secret'] });
    expect(r.success).toBe(false);
  });
});

describe('ModelRunPredictionsQuerySchema (MODEL-SERVE-020-T04)', () => {
  it.each(['test', 'holdout', 'new_data_holdout'])(
    'accepts %s',
    (population) => {
      expect(
        ModelRunPredictionsQuerySchema.safeParse({ population }).success,
      ).toBe(true);
    },
  );

  it('defaults to nothing (the service defaults to test) and refuses anything else', () => {
    expect(ModelRunPredictionsQuerySchema.safeParse({}).success).toBe(true);
    expect(
      ModelRunPredictionsQuerySchema.safeParse({ population: 'train' }).success,
    ).toBe(false);
    expect(
      ModelRunPredictionsQuerySchema.safeParse({ population: 'test', x: 1 })
        .success,
    ).toBe(false);
  });
});
