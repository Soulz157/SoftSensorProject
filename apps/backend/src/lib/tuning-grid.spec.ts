import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  SIZE_TIER_LOWER_BOUNDS,
  TUNING_GRID,
  TUNING_GRID_OVERRIDES,
  TUNE_VARIANTS_PER_JOB,
  batchSizeBand,
  sizeTierFor,
  tuningCandidatesFor,
  tuningVariantsFor,
  type SizeTier,
} from './tuning-grid';

/**
 * MODEL-FLOW-013-T11. A static source guard, not a hand-copied table:
 * mirrors `apps/client/lib/run-params.test.ts`'s existing precedent — reads
 * the trainer's own `build_model` source and extracts exactly the keys each
 * branch reads via `hyperparameters.get("KEY", ...)`. If TUNING_GRID names a
 * key the trainer never reads for that algorithm, this fails — a hand-typed
 * grid would keep passing while a tuning variant silently changed nothing the
 * estimator saw.
 *
 * Points at `app/models.py`, not `train.py`: the trainer image was split into
 * a package and `build_model` moved to its own module, leaving `train.py` as
 * the mode dispatch alone. Note that a wrong path here fails at readFileSync
 * with ENOENT, BEFORE the "has it moved or been renamed?" guard below can
 * report it — so if that module moves again, this constant is the first thing
 * to fix, not that message.
 */
const MODELS_FILE = path.resolve(
  __dirname,
  '../../../../images/trainer/app/models.py',
);

function readTrainer(): string {
  return readFileSync(MODELS_FILE, 'utf-8');
}

function extractBuildModelBody(source: string): string {
  const start = source.indexOf('def build_model(');
  if (start === -1) {
    throw new Error(
      'build_model not found in app/models.py — has it moved or been renamed?',
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
  // MODEL-FLOW-024. lstm and gru share ONE branch, so one header serves both;
  // `extractConsumedKeys` copies its keys onto `gru`. Listing it also ends
  // xgboost's block where it should — before this header existed xgboost's
  // block ran to the end of build_model and "consumed" the sequence keys too.
  { pattern: /if algorithm in SEQUENCE_ALGORITHMS:/, algorithm: 'lstm' },
];

function extractConsumedKeys(body: string): Record<string, string[]> {
  const headers = HEADER_TO_ALGORITHM.map(({ pattern, algorithm }) => {
    const match = pattern.exec(body);
    if (!match) {
      throw new Error(
        `app/models.py no longer has a build_model branch matching ${pattern} ` +
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
  result['gru'] = result['lstm'] ?? [];
  return result;
}

describe('TUNING_GRID matches images/trainer/app/models.py, read live', () => {
  const body = extractBuildModelBody(readTrainer());
  const actual = extractConsumedKeys(body);

  // MODEL-FLOW-024. The key-set guard runs over EVERY tier, not just the
  // medium table: an override could otherwise name a key the trainer never
  // reads and nothing would notice until a tuning variant silently changed
  // nothing. An algorithm a tier does not override reads the medium table, so
  // it is covered by the `medium` row.
  const tables: [string, Record<string, Record<string, unknown>[]>][] = [
    ['medium', TUNING_GRID],
    ...(['tiny', 'small', 'large'] as const).map(
      (tier): [string, Record<string, Record<string, unknown>[]>] => [
        tier,
        TUNING_GRID_OVERRIDES[tier],
      ],
    ),
  ];

  for (const [tier, table] of tables) {
    for (const algorithm of Object.keys(table)) {
      it(`${tier}/${algorithm}: every grid variant uses only keys build_model actually reads`, () => {
        const consumed = new Set(actual[algorithm] ?? []);
        expect(consumed.size).toBeGreaterThan(0);
        for (const variant of table[algorithm] ?? []) {
          for (const key of Object.keys(variant)) {
            expect(consumed.has(key)).toBe(true);
          }
        }
      });
    }
  }

  it('lstm and gru have a grid, and it does not name sequence_length', () => {
    // MODEL-FLOW-024. sequence_length feeds windowing and the split spec, not
    // build_model — it belongs to the base run and is carried across by
    // tuningCandidatesFor, so it must never appear in the table itself.
    for (const algorithm of ['lstm', 'gru']) {
      expect(TUNING_GRID[algorithm]?.length).toBeGreaterThan(0);
      for (const variant of TUNING_GRID[algorithm] ?? []) {
        expect(Object.keys(variant)).not.toContain('sequence_length');
      }
    }
  });
});

describe('sizeTierFor', () => {
  it.each([
    [0, 'tiny'],
    [49, 'tiny'],
    [SIZE_TIER_LOWER_BOUNDS.small, 'small'],
    [149, 'small'],
    [SIZE_TIER_LOWER_BOUNDS.medium, 'medium'],
    [499, 'medium'],
    [SIZE_TIER_LOWER_BOUNDS.large, 'large'],
    [46_070, 'large'],
  ] as [number, SizeTier][])('%d distinct labelled values is %s', (n, tier) => {
    expect(sizeTierFor(n)).toBe(tier);
  });

  it('resolves an unknown figure to medium, never to a tighter tier', () => {
    expect(sizeTierFor(null)).toBe('medium');
    expect(sizeTierFor(undefined)).toBe('medium');
    expect(sizeTierFor(Number.NaN)).toBe('medium');
  });

  it('puts every dataset this system has measured (19, 32, 59, 97) in a low tier', () => {
    expect([19, 32, 59, 97].map((n) => sizeTierFor(n))).toEqual([
      'tiny',
      'tiny',
      'small',
      'small',
    ]);
  });
});

describe('batchSizeBand', () => {
  it('is the old fixed 16-128 band for an unknown row count and for 1,024+ rows', () => {
    expect(batchSizeBand(null)).toEqual({ min: 16, max: 128 });
    expect(batchSizeBand(undefined)).toEqual({ min: 16, max: 128 });
    expect(batchSizeBand(1_024)).toEqual({ min: 16, max: 128 });
    expect(batchSizeBand(15_441)).toEqual({ min: 16, max: 128 });
  });

  it('caps at an eighth of the rows, with a floor of 8 on the cap', () => {
    expect(batchSizeBand(400)).toEqual({ min: 12, max: 50 });
    expect(batchSizeBand(100)).toEqual({ min: 4, max: 12 });
    expect(batchSizeBand(20)).toEqual({ min: 4, max: 8 });
    expect(batchSizeBand(0)).toEqual({ min: 4, max: 8 });
  });

  it('never returns an empty band', () => {
    for (const rows of [0, 1, 7, 8, 63, 64, 65, 500, 1_023, 1_024, 99_999]) {
      const { min, max } = batchSizeBand(rows);
      expect(min).toBeLessThan(max);
    }
  });
});

describe('tuningVariantsFor', () => {
  it('is TUNING_GRID itself, by reference, when no size is given or the tier is medium', () => {
    expect(tuningVariantsFor('ridge')).toBe(TUNING_GRID.ridge);
    expect(tuningVariantsFor('ridge', { distinctLabelled: 200 })).toBe(
      TUNING_GRID.ridge,
    );
  });

  it('serves the tier override where one exists, and the medium table where it does not', () => {
    expect(tuningVariantsFor('ridge', { distinctLabelled: 32 })).toBe(
      TUNING_GRID_OVERRIDES.tiny.ridge,
    );
    expect(tuningVariantsFor('ridge', { distinctLabelled: 900 })).toBe(
      TUNING_GRID_OVERRIDES.large.ridge,
    );
    // ols, grp and pls have no size prior — every tier reads the medium table.
    for (const algorithm of ['ols', 'grp', 'pls']) {
      for (const distinctLabelled of [10, 100, 300, 900]) {
        expect(tuningVariantsFor(algorithm, { distinctLabelled })).toBe(
          TUNING_GRID[algorithm],
        );
      }
    }
  });

  it('returns [] for an unknown algorithm', () => {
    expect(tuningVariantsFor('not-a-real-algorithm')).toEqual([]);
  });

  it('is TUNING_GRID itself for lstm/gru too whenever the batch cap does not bind — served, not copied', () => {
    for (const algorithm of ['lstm', 'gru']) {
      expect(tuningVariantsFor(algorithm)).toBe(TUNING_GRID[algorithm]);
      expect(tuningVariantsFor(algorithm, {})).toBe(TUNING_GRID[algorithm]);
      expect(tuningVariantsFor(algorithm, { rows: 1_024 })).toBe(
        TUNING_GRID[algorithm],
      );
      expect(tuningVariantsFor(algorithm, { rows: 15_441 })).toBe(
        TUNING_GRID[algorithm],
      );
      // ...and is a fresh, clamped copy only when the cap actually binds.
      expect(tuningVariantsFor(algorithm, { rows: 400 })).not.toBe(
        TUNING_GRID[algorithm],
      );
    }
  });

  it('shrinks tree capacity on small data and grows it on large data', () => {
    const maxOf = (algorithm: string, key: string, distinctLabelled: number) =>
      Math.max(
        ...tuningVariantsFor(algorithm, { distinctLabelled }).map((v) =>
          Number(v[key]),
        ),
      );
    for (const [algorithm, key] of [
      ['xgboost', 'n_estimators'],
      ['xgboost', 'max_depth'],
      ['lightgbm', 'num_leaves'],
      ['hist_gradient_boosting', 'num_leaves'],
      ['random_forest', 'n_estimators'],
    ] as const) {
      const tiny = maxOf(algorithm, key, 32);
      const medium = maxOf(algorithm, key, 200);
      const large = maxOf(algorithm, key, 900);
      // Jest's expect takes no message argument, so the offender is carried in
      // the compared value instead — a failure names the algorithm and key.
      expect([algorithm, key, tiny < medium]).toEqual([algorithm, key, true]);
      expect([algorithm, key, large > medium]).toEqual([algorithm, key, true]);
    }
  });

  it('clamps lstm/gru batch_size into the rows band', () => {
    for (const rows of [100, 400, 5_000]) {
      const { min, max } = batchSizeBand(rows);
      for (const algorithm of ['lstm', 'gru']) {
        for (const variant of tuningVariantsFor(algorithm, { rows })) {
          expect(Number(variant.batch_size)).toBeGreaterThanOrEqual(min);
          expect(Number(variant.batch_size)).toBeLessThanOrEqual(max);
        }
      }
    }
  });

  it('does not size lstm/gru capacity from distinct labelled values, only batch_size from rows', () => {
    const noFigure = tuningVariantsFor('lstm');
    const tiny = tuningVariantsFor('lstm', { distinctLabelled: 20 });
    expect(tiny).toEqual(noFigure);
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

  it('returns [] for an unknown algorithm, never throws', () => {
    expect(tuningCandidatesFor('not-a-real-algorithm', {})).toEqual([]);
  });

  it('keeps the original whole-record comparison for tabular algorithms: a base with an extra key does not cover a variant', () => {
    // Pinned to PRESERVE pre-existing behaviour, not to endorse it. Comparing
    // on the variant's keys alone (which lstm/gru need) would exclude
    // { alpha: 0.01 } here, silently narrowing what a retrain search tries for
    // a base that carries a key the grid does not name.
    const result = tuningCandidatesFor('ridge', {
      alpha: 0.01,
      fit_intercept: true,
    });
    expect(result).toContainEqual({ alpha: 0.01 });
  });

  it('with no size figure is what it was before sizing existed', () => {
    expect(tuningCandidatesFor('xgboost', {})).toEqual(
      TUNING_GRID.xgboost.slice(0, TUNE_VARIANTS_PER_JOB),
    );
    expect(tuningCandidatesFor('xgboost', {}, {})).toEqual(
      tuningCandidatesFor('xgboost', {}),
    );
  });

  it('builds the variants from the tier the size figure selects', () => {
    expect(
      tuningCandidatesFor('xgboost', {}, { distinctLabelled: 32 }),
    ).toEqual(TUNING_GRID_OVERRIDES.tiny.xgboost);
    expect(
      tuningCandidatesFor('xgboost', {}, { distinctLabelled: 900 }),
    ).toEqual(TUNING_GRID_OVERRIDES.large.xgboost);
  });

  it('still never re-runs the base setting inside a tier', () => {
    const base = TUNING_GRID_OVERRIDES.tiny.xgboost[0];
    const result = tuningCandidatesFor('xgboost', base, {
      distinctLabelled: 32,
    });
    expect(result).not.toContainEqual(base);
    expect(result).toHaveLength(3);
  });

  describe('lstm/gru', () => {
    const base = {
      epochs: 50,
      batch_size: 32,
      hidden_size: 64,
      sequence_length: 48,
    };

    it.each(['lstm', 'gru'])(
      '%s: up to 4 variants, each carrying the base sequence_length',
      (algorithm) => {
        const result = tuningCandidatesFor(algorithm, base);
        expect(result.length).toBeGreaterThan(0);
        expect(result.length).toBeLessThanOrEqual(TUNE_VARIANTS_PER_JOB);
        for (const variant of result) {
          expect(variant.sequence_length).toBe(48);
          expect(Object.keys(variant).sort()).toEqual([
            'batch_size',
            'epochs',
            'hidden_size',
            'sequence_length',
          ]);
        }
      },
    );

    it('carries nothing when the base has no sequence_length', () => {
      const result = tuningCandidatesFor('lstm', {
        epochs: 50,
        batch_size: 32,
        hidden_size: 64,
      });
      for (const variant of result) {
        expect(Object.keys(variant)).not.toContain('sequence_length');
      }
    });

    it('does not re-run the base when it equals a variant on the variant keys', () => {
      // The base carries an extra key (sequence_length) no variant names, so a
      // whole-record comparison would never match and the base would come back
      // as its own tuning variant.
      const variant = TUNING_GRID.lstm[1];
      const result = tuningCandidatesFor('lstm', {
        ...variant,
        sequence_length: 24,
      });
      expect(result).toHaveLength(3);
      expect(result.map((v) => v.epochs)).not.toContain(variant.epochs);
    });

    it('keeps batch_size inside the rows band', () => {
      const { min, max } = batchSizeBand(100);
      for (const variant of tuningCandidatesFor('lstm', base, { rows: 100 })) {
        expect(Number(variant.batch_size)).toBeGreaterThanOrEqual(min);
        expect(Number(variant.batch_size)).toBeLessThanOrEqual(max);
      }
    });
  });
});
