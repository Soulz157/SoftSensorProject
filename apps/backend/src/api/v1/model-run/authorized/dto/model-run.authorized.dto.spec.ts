import { RunCompleteSchema, SplitSpecSchema } from './model-run.authorized.dto';

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
