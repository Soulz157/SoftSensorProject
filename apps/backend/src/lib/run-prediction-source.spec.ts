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

/**
 * MODEL-FLOW-028-T01. A CV run's out-of-fold series is a THIRD population: no
 * run column records its key, so it is resolved beside `cvFoldsKey`, and it
 * must never be mistaken for (or substitute for) the test split or holdout.
 */
describe("predictionKeyFor — 'cv-oof'", () => {
  const OOF = 'drafts/d1/runs/r1/cv_oof_predictions.parquet';

  it('resolves beside cv_folds.json under the same run prefix', () => {
    expect(predictionKeyFor(run({ cvFoldsKey: CV }), 'cv-oof')).toBe(OOF);
  });

  it('also resolves for a model-scoped (saved) run prefix', () => {
    const saved = run({ cvFoldsKey: 'models/m1/runs/r1/cv_folds.json' });
    expect(predictionKeyFor(saved, 'cv-oof')).toBe(
      'models/m1/runs/r1/cv_oof_predictions.parquet',
    );
  });

  it('has none for a non-CV run', () => {
    expect(predictionKeyFor(run(), 'cv-oof')).toBeNull();
  });

  it('leaves a CV run test and holdout answers unchanged', () => {
    const scoredCv = run({ cvFoldsKey: CV, predictionsKey: TEST });
    expect(predictionKeyFor(scoredCv, 'test')).toBeNull();
    expect(predictionKeyFor(scoredCv, 'holdout')).toBe(TEST);
  });

  it('is independent of scoring: an unscored CV run still has one', () => {
    const unscoredCv = run({ cvFoldsKey: CV, predictionsKey: null });
    expect(predictionKeyFor(unscoredCv, 'cv-oof')).toBe(OOF);
  });
});
