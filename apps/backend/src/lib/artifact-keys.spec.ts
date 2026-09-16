import {
  RETENTION_PERMANENT,
  RETENTION_REFERENCED,
  RETENTION_SWEEPABLE,
  classForKey,
  draftRunKey,
  isDraftRunKey,
  modelRunKey,
  tmpKey,
  versionKey,
} from './artifact-keys';

/**
 * MODEL-SERVE-007-T03/V02/V03. The TS half of the resolver.
 *
 * This file exists because the resolver is MIRRORED, not shared: python's
 * `class_for_key` has its own tests in apps/python/tests/test_object_store.py
 * and nothing links the two. A divergence between them is silent — the same
 * key would be classed one way by the write path and another by anything on
 * this side — so both halves carry the same cases deliberately.
 */
describe('classForKey', () => {
  it('gives the shared drafts/ root two different classes (V02)', () => {
    const run = draftRunKey('d1', 'r1', 'model.joblib');
    const artifact = 'drafts/d1/artifacts/a1/data_gold.parquet';

    expect(classForKey(run)).toBe(RETENTION_REFERENCED);
    expect(classForKey(artifact)).toBe(RETENTION_SWEEPABLE);
    // Asserted together on purpose: a resolver dispatching on the first path
    // segment sends both to the same class and still passes a test that
    // checks only one of them.
    expect(classForKey(run)).not.toBe(classForKey(artifact));
  });

  it('classes a rootless legacy dataset key as the dataset class (V03)', () => {
    // No named root at all — the case a first-segment resolver gets wrong.
    expect(classForKey(versionKey('ds-1', 'v-1'))).toBe(RETENTION_SWEEPABLE);
    expect(classForKey('ds-1/artifacts/a1/data.parquet')).toBe(
      RETENTION_SWEEPABLE,
    );
    expect(classForKey(tmpKey('ds-1', 'job-1', 1))).toBe(RETENTION_SWEEPABLE);
  });

  it('classes the operational records as permanent', () => {
    expect(
      classForKey('inference/m1/v1/dt=2026-09-12/hour=09/predictions.parquet'),
    ).toBe(RETENTION_PERMANENT);
    expect(
      classForKey('serving-logs/m1/v1/dt=2026-09-12/hour=09/abc.parquet'),
    ).toBe(RETENTION_PERMANENT);
  });

  it('classes model run outputs as referenced', () => {
    expect(classForKey(modelRunKey('m1', 'r1', 'model.joblib'))).toBe(
      RETENTION_REFERENCED,
    );
  });

  it('classes a batch prediction output as sweepable', () => {
    expect(classForKey('predictions/m1/j1/output.parquet')).toBe(
      RETENTION_SWEEPABLE,
    );
  });
});

describe('isDraftRunKey', () => {
  it('requires exactly four segments with `runs` second', () => {
    expect(isDraftRunKey(draftRunKey('d1', 'r1', 'model.joblib'))).toBe(true);
    expect(isDraftRunKey('drafts/d1/artifacts/a1/data.parquet')).toBe(false);
    expect(isDraftRunKey('drafts/d1/runs/r1/')).toBe(false);
    expect(isDraftRunKey('drafts/d1/runs/r1/extra/model.joblib')).toBe(false);
    expect(isDraftRunKey('models/m1/runs/r1/model.joblib')).toBe(false);
  });

  it('refuses traversal segments', () => {
    expect(isDraftRunKey('drafts/../runs/r1/model.joblib')).toBe(false);
    expect(isDraftRunKey('drafts/d1/runs/./model.joblib')).toBe(false);
  });
});
