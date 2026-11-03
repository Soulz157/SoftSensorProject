import {
  DEFAULT_SEQUENCE_LENGTH,
  contextRowsFor,
  sequenceLengthFor,
} from './sequence-model';

describe('sequenceLengthFor (MODEL-SERVE-043)', () => {
  it('is null for every non-sequence algorithm', () => {
    for (const algorithm of ['random_forest', 'xgboost', 'ridge', 'mlp']) {
      expect(sequenceLengthFor(algorithm, { sequence_length: 12 })).toBeNull();
    }
  });

  it('reads the version hyperparameter for lstm and gru', () => {
    expect(sequenceLengthFor('lstm', { sequence_length: 12 })).toBe(12);
    expect(sequenceLengthFor('gru', { sequence_length: '36' })).toBe(36);
  });

  it('falls back to the trainer default when unset or unusable', () => {
    expect(sequenceLengthFor('lstm', {})).toBe(DEFAULT_SEQUENCE_LENGTH);
    expect(sequenceLengthFor('lstm', null)).toBe(DEFAULT_SEQUENCE_LENGTH);
    expect(sequenceLengthFor('gru', { sequence_length: 0 })).toBe(24);
    expect(sequenceLengthFor('gru', { sequence_length: 2.5 })).toBe(24);
    expect(sequenceLengthFor('gru', [24])).toBe(24);
  });
});

describe('contextRowsFor (MODEL-SERVE-043)', () => {
  it('is L - 1 for a sequence model and 0 otherwise', () => {
    expect(contextRowsFor(24)).toBe(23);
    expect(contextRowsFor(1)).toBe(0);
    expect(contextRowsFor(null)).toBe(0);
  });
});
