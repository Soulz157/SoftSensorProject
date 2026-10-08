import { PatchModelDraftSchema } from './model-draft.authorized.dto';

/**
 * MODEL-FLOW-006. `hyperparameters` narrowed from `z.unknown()` to the same
 * scalar constraint the run path enforces — pins the case the wider type let
 * through: a draft holding a value training would refuse, discovered only
 * when the user clicks Start Training.
 */
describe('PatchModelDraftSchema', () => {
  it('accepts scalar hyperparameter values, unchanged from before', () => {
    const result = PatchModelDraftSchema.parse({
      hyperparameters: { fit_intercept: true, C: 1, kernel: 'rbf', tol: null },
    });
    expect(result.hyperparameters).toEqual({
      fit_intercept: true,
      C: 1,
      kernel: 'rbf',
      tol: null,
    });
  });

  it('refuses a non-scalar hyperparameter value — previously accepted under z.unknown()', () => {
    expect(() =>
      PatchModelDraftSchema.parse({
        hyperparameters: { layers: [64, 32] },
      }),
    ).toThrow();
  });

  it('still refuses splitRatio outside the fraction range', () => {
    expect(() => PatchModelDraftSchema.parse({ splitRatio: 80 })).toThrow();
  });
});
