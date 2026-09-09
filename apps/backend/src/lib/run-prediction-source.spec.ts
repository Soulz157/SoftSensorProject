import {
  predictionKeyFor,
  type RunPredictionKeys,
} from './run-prediction-source';

/**
 * MODEL-FLOW-019-T20. The asymmetry pinned from both sides, because getting
 * it backwards produces a chart that looks entirely plausible: serving a CV
 * run's `predictionsKey` as a "test split" would plot real holdout rows
 * under a test-split caption, which is the precise conflation this whole
 * feature exists to prevent and which this codebase has shipped once before.
 */

const CV = 'drafts/d1/runs/r1/cv_folds.json';
const HOLDOUT = 'drafts/d1/runs/r1/holdout_predictions.parquet';
const TEST = 'drafts/d1/runs/r1/predictions.parquet';

function run(overrides: Partial<RunPredictionKeys> = {}): RunPredictionKeys {
  return {
    cvFoldsKey: null,
    predictionsKey: TEST,
    holdoutPredictionsKey: null,
    ...overrides,
  };
}

describe('predictionKeyFor — a non-CV run', () => {
  it('serves predictionsKey as its TEST split, which is what it holds', () => {
    expect(predictionKeyFor(run(), 'test')).toBe(TEST);
  });

  it('has no holdout series until scoring writes one', () => {
    expect(predictionKeyFor(run(), 'holdout')).toBeNull();
  });

  it('serves holdoutPredictionsKey once scored, WITHOUT losing its test split', () => {
    const scored = run({ holdoutPredictionsKey: HOLDOUT });
    expect(predictionKeyFor(scored, 'holdout')).toBe(HOLDOUT);
    // The whole reason the second column exists.
    expect(predictionKeyFor(scored, 'test')).toBe(TEST);
  });
});

describe('predictionKeyFor — a CV run', () => {
  it('has NO test split, and is never served one', () => {
    // The dangerous case: predictionsKey is non-null here, so a reader that
    // skipped this helper would happily serve a holdout as a test split.
    const scoredCv = run({ cvFoldsKey: CV, predictionsKey: TEST });
    expect(predictionKeyFor(scoredCv, 'test')).toBeNull();
  });

  it('serves its predictionsKey as the HOLDOUT — unchanged by T20', () => {
    const scoredCv = run({ cvFoldsKey: CV, predictionsKey: TEST });
    expect(predictionKeyFor(scoredCv, 'holdout')).toBe(TEST);
  });

  it('has neither before its scoring phase runs', () => {
    const unscoredCv = run({ cvFoldsKey: CV, predictionsKey: null });
    expect(predictionKeyFor(unscoredCv, 'test')).toBeNull();
    expect(predictionKeyFor(unscoredCv, 'holdout')).toBeNull();
  });
});
