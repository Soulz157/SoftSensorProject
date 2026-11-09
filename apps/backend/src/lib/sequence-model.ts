/**
 * MODEL-SERVE-043. Sequence models (lstm/gru) score row i from rows
 * [i-L+1, i], so every scoring path outside training needs `L` — and the
 * pickled model never recorded it. This is the one place the backend
 * resolves it, from the version's own hyperparameters.
 *
 * MIRRORED: `SEQUENCE_ALGORITHMS` and `DEFAULT_SEQUENCE_LENGTH` copy
 * images/trainer/app/models.py and windows.py (images/trainer/app/MIRRORS.md
 * entry 13). Training falls back to 24 when the run never set
 * `sequence_length`; a different default here would window a model on a
 * history length it was never trained on, with nothing to say so.
 */
export const SEQUENCE_ALGORITHMS: ReadonlySet<string> = new Set([
  'lstm',
  'gru',
]);

export const DEFAULT_SEQUENCE_LENGTH = 24;

/** `sequence_length` for a sequence model, `null` for every other algorithm. */
export function sequenceLengthFor(
  algorithm: string,
  hyperparameters: unknown,
): number | null {
  if (!SEQUENCE_ALGORITHMS.has(algorithm)) return null;
  const raw =
    hyperparameters &&
    typeof hyperparameters === 'object' &&
    !Array.isArray(hyperparameters)
      ? (hyperparameters as Record<string, unknown>).sequence_length
      : undefined;
  const value = typeof raw === 'string' ? Number(raw) : raw;
  return typeof value === 'number' && Number.isInteger(value) && value >= 1
    ? value
    : DEFAULT_SEQUENCE_LENGTH;
}

/** Rows of history before a window a sequence model needs: `L - 1`. */
export function contextRowsFor(sequenceLength: number | null): number {
  return sequenceLength && sequenceLength > 1 ? sequenceLength - 1 : 0;
}
