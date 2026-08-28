import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  TUNING_GRID,
  TUNE_VARIANTS_PER_JOB,
  tuningCandidatesFor,
} from './tuning-grid';

/**
 * MODEL-FLOW-013-T11. A static source guard, not a hand-copied table:
 * mirrors `apps/client/lib/run-params.test.ts`'s existing precedent — reads
 * `images/trainer/train.py` itself and extracts exactly the keys each
 * `build_model` branch reads via `hyperparameters.get("KEY", ...)`. If
 * TUNING_GRID names a key the trainer never reads for that algorithm, this
 * fails — a hand-typed grid would keep passing while a tuning variant
 * silently changed nothing the estimator saw.
 */
const TRAINER_FILE = path.resolve(
  __dirname,
  '../../../../images/trainer/train.py',
);

function readTrainer(): string {
  return readFileSync(TRAINER_FILE, 'utf-8');
}

function extractBuildModelBody(source: string): string {
  const start = source.indexOf('def build_model(');
  if (start === -1) {
    throw new Error(
      'build_model not found in train.py — has it moved or been renamed?',
    );
  }
  const rest = source.slice(start);
  const nextDef = rest.indexOf('\ndef ', 1);
  return nextDef === -1 ? rest : rest.slice(0, nextDef);
}

const HEADER_TO_ALGORITHM: { pattern: RegExp; algorithm: string }[] = [
  {
    pattern: /if algorithm in \("hgb", "hist_gradient_boosting"\):/,
    algorithm: 'hist_gradient_boosting',
  },
  { pattern: /if algorithm == "ridge":/, algorithm: 'ridge' },
  { pattern: /if algorithm == "ols":/, algorithm: 'ols' },
  { pattern: /if algorithm == "svm":/, algorithm: 'svm' },
  { pattern: /if algorithm == "mlp":/, algorithm: 'mlp' },
  { pattern: /if algorithm == "grp":/, algorithm: 'grp' },
  { pattern: /if algorithm == "pls":/, algorithm: 'pls' },
  { pattern: /if algorithm == "random_forest":/, algorithm: 'random_forest' },
  { pattern: /if algorithm == "lightgbm":/, algorithm: 'lightgbm' },
  { pattern: /if algorithm == "xgboost":/, algorithm: 'xgboost' },
];

function extractConsumedKeys(body: string): Record<string, string[]> {
  const headers = HEADER_TO_ALGORITHM.map(({ pattern, algorithm }) => {
    const match = pattern.exec(body);
    if (!match) {
      throw new Error(
        `train.py no longer has a build_model branch matching ${pattern} ` +
          `(expected for "${algorithm}") — TUNING_GRID is stale.`,
      );
    }
    return { algorithm, index: match.index };
  }).sort((a, b) => a.index - b.index);

  const result: Record<string, string[]> = {};
  headers.forEach(({ algorithm, index }, i) => {
    const next = headers[i + 1];
    const end = next ? next.index : body.length;
    const block = body.slice(index, end);
    const keys = [...block.matchAll(/hyperparameters\.get\(\s*"([^"]+)"/g)]
      .map((m) => m[1])
      .filter((k): k is string => k !== undefined);
    result[algorithm] = [...new Set(keys)];
  });
  return result;
}

describe('TUNING_GRID matches images/trainer/train.py, read live', () => {
  const body = extractBuildModelBody(readTrainer());
  const actual = extractConsumedKeys(body);

  for (const algorithm of Object.keys(TUNING_GRID)) {
    it(`${algorithm}: every grid variant uses only keys build_model actually reads`, () => {
      const consumed = new Set(actual[algorithm] ?? []);
      for (const variant of TUNING_GRID[algorithm] ?? []) {
        for (const key of Object.keys(variant)) {
          expect(consumed.has(key)).toBe(true);
        }
      }
    });
  }

  it('lstm/gru have no grid entry — they never reach build_model', () => {
    expect(TUNING_GRID['lstm']).toBeUndefined();
    expect(TUNING_GRID['gru']).toBeUndefined();
  });
});

describe('tuningCandidatesFor', () => {
  it('excludes a variant identical to what already ran', () => {
    const result = tuningCandidatesFor('ridge', { alpha: 0.1 });
    expect(result.some((v) => v.alpha === 0.1)).toBe(false);
  });

  it('runs whatever exists, even a single variant (ols has only one)', () => {
    const result = tuningCandidatesFor('ols', { fit_intercept: true });
    expect(result).toEqual([{ fit_intercept: false }]);
  });

  it('caps at TUNE_VARIANTS_PER_JOB', () => {
    const result = tuningCandidatesFor('xgboost', {});
    expect(result.length).toBeLessThanOrEqual(TUNE_VARIANTS_PER_JOB);
  });

  it('returns [] for lstm/gru and an unknown algorithm, never throws', () => {
    expect(tuningCandidatesFor('lstm', {})).toEqual([]);
    expect(tuningCandidatesFor('gru', {})).toEqual([]);
    expect(tuningCandidatesFor('not-a-real-algorithm', {})).toEqual([]);
  });
});
