import { CombineForRetrainResponseSchemaForTest as Schema } from './python-preprocess-client';

// MODEL-SERVE-027, found live 2026-10-02. Once python's response model
// declared frozen_eval_to / combined_end_time / frozen_eval_dropped_rows,
// they started ARRIVING — and New Data Only sends null for the ones that
// describe a frozen slice it never carves. Both strategies' real shapes must
// parse.
const base = {
  object_key: 'ds/artifacts/g/data_gold.parquet',
  row_count: 5486,
  column_count: 45,
  size_bytes: 98716,
  missing_pct: 0,
  checksum: 'abc',
  column_stats_key: 'ds/artifacts/g/column_stats.json',
  feature_spec_key: 'ds/artifacts/g/feature_spec.json',
  dedupe_dropped: 0,
  new_train_row_count: 5486,
};

describe('CombineForRetrainSchema (MODEL-SERVE-027)', () => {
  it('parses a New Data Only response — no frozen slice, so its fields are null', () => {
    const r = Schema.safeParse({
      ...base,
      base_train_row_count: 0,
      validation_row_count: null,
      validation_holdout_from: null,
      validation_missing_pct: null,
      frozen_eval_checksum: null,
      frozen_eval_to: '2025-11-06 19:01:00',
      combined_end_time: '2026-06-22 23:01:00',
      frozen_eval_dropped_rows: null,
      new_validation_row_count: 169,
      new_validation_checksum: 'def',
      new_validation_from: '2026-06-23 13:01:00',
      new_validation_to: '2026-06-30 13:01:00',
    });
    expect(r.success).toBe(true);
  });

  it('parses an Existing + new response with every frozen-slice figure present', () => {
    const r = Schema.safeParse({
      ...base,
      base_train_row_count: 3091,
      validation_row_count: 1,
      validation_holdout_from: '2025-11-06 19:00:00',
      validation_missing_pct: 0,
      frozen_eval_checksum: 'ghi',
      frozen_eval_to: '2025-11-06 19:01:00',
      combined_end_time: '2026-06-30 13:01:00',
      frozen_eval_dropped_rows: 0,
    });
    expect(r.success).toBe(true);
  });

  it('still refuses a negative dropped-row count', () => {
    expect(
      Schema.safeParse({
        ...base,
        base_train_row_count: 1,
        frozen_eval_checksum: null,
        frozen_eval_dropped_rows: -1,
      }).success,
    ).toBe(false);
  });
});
