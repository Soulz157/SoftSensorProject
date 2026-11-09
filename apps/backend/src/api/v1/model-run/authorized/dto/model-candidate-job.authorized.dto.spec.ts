import { CreateCandidateJobSchema } from './model-candidate-job.authorized.dto';

const BASE = {
  goldArtifactId: '3f6a4b6e-0b9f-4f9d-9a4e-1d2c3b4a5f60',
  targetY: 'TI-101',
  kind: 'HYPERPARAMETER_SEARCH',
  candidates: [{ algorithm: 'ridge', hyperparameters: { alpha: 1 } }],
} as const;

describe('CreateCandidateJobSchema — MODEL-FLOW-038 paramGrid', () => {
  const parse = (extra: Record<string, unknown>) =>
    CreateCandidateJobSchema.safeParse({ ...BASE, ...extra });

  it('accepts a grid over the algorithm’s own keys', () => {
    expect(parse({ paramGrid: { alpha: [0.1, 1, 10] } }).success).toBe(true);
  });

  it('accepts a job with no grid, as before', () => {
    expect(parse({}).success).toBe(true);
  });

  it.each([
    ['a sweep', { kind: 'ALGORITHM_SWEEP' }],
    [
      'two candidates',
      {
        candidates: [
          { algorithm: 'ridge', hyperparameters: {} },
          { algorithm: 'svm', hyperparameters: {} },
        ],
      },
    ],
  ])('refuses a grid on %s', (_label, extra) => {
    expect(parse({ ...extra, paramGrid: { alpha: [1, 2] } }).success).toBe(
      false,
    );
  });

  it('refuses a grid beside extraVariants', () => {
    const result = parse({
      paramGrid: { alpha: [1, 2] },
      extraVariants: [{ alpha: 5 }],
    });
    expect(result.success).toBe(false);
  });

  it('refuses lstm/gru, which keep the curated path', () => {
    const result = parse({
      candidates: [{ algorithm: 'lstm', hyperparameters: {} }],
      paramGrid: { epochs: [10, 20] },
    });
    expect(result.success).toBe(false);
  });

  it('refuses a key the algorithm does not search', () => {
    expect(parse({ paramGrid: { C: [1, 2] } }).success).toBe(false);
  });

  it('refuses an empty list, duplicates, and more than 10 values', () => {
    expect(parse({ paramGrid: { alpha: [] } }).success).toBe(false);
    expect(parse({ paramGrid: { alpha: [1, 1] } }).success).toBe(false);
    expect(
      parse({
        paramGrid: { alpha: Array.from({ length: 11 }, (_, i) => i + 1) },
      }).success,
    ).toBe(false);
  });

  it('refuses a product over the 64-combination cap', () => {
    const result = parse({
      candidates: [{ algorithm: 'svm', hyperparameters: {} }],
      paramGrid: {
        C: [1, 2, 3, 4, 5, 6, 7, 8, 9],
        kernel: ['rbf', 'linear', 'poly'],
        epsilon: [0.01, 0.1, 0.2],
      },
    });
    expect(result.success).toBe(false);
  });
});
