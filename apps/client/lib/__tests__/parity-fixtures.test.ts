/**
 * F0 parity-fixture generator.
 *
 * Freezes the CURRENT client cleaning behaviour into golden JSON so the Python
 * port (apps/python/services/cleaning_service.py) can be proven equal before
 * any save path is flipped to the backend.
 *
 * This is a generator, not an assertion suite: running it rewrites
 * `packages/parity-fixtures/*.json`. It also self-checks that regenerating is
 * deterministic, so an accidental behaviour change shows up as a git diff on
 * the fixtures rather than as silent numeric drift in production.
 *
 * Quirks deliberately captured here — Python must reproduce these, NOT the
 * pandas/numpy defaults:
 *   - quartiles are `sorted[floor(n*0.25)]`, no interpolation
 *   - `zscore` uses POPULATION std (/n) and REPLACES outliers with the mean
 *   - `precleanse.tagStats` uses SAMPLE std (/(n-1))
 *   - `moving_avg` is centred and shrinks at the edges
 *   - `exponential` seeds the EMA with the first value (adjust=False)
 *   - rounding is per-tag `tagMeta(tag)?.precision ?? 2`
 *   - forward/backward fill flips status to Good even with no donor cell
 *
 * DS-LAKE-006-T01 extends this GATE FIRST (same discipline, new engines) to
 * cover `applyFeatures`/`selectColumns`/`toModelReady` — the Gold-layer
 * transforms feature_service.py (T02) must port next. New quirks pinned here:
 *   - a `rolling` window requires a FULL window of Good source values or the
 *     whole cell is Bad — no partial-window average at the edges
 *   - `ratio`'s divisor(s) being exactly 0 is Bad, not Infinity/NaN
 *   - `log` of a non-positive value is Bad, not NaN
 *   - `toModelReady` scales every FINITE value regardless of its original
 *     Good/Bad/Questionable status, and always emits Good afterward — a Bad
 *     cell with a real (non-hole) numeric value is silently laundered to
 *     Good by scaling, which is why the base grid (real values on Bad cells,
 *     never synthetic 0-holes) is reused here rather than a cleaner one
 *   - `standard` scaling uses Welford's online mean/variance (population,
 *     ddof=0), not the naive E[x²]-E[x]² form
 *   - `robust` scaling's median/IQR come from `medianRange` over the SORTED
 *     finite values, matching precleanse's own quartile convention, not
 *     `numpy.percentile`'s interpolated one
 *   - every scaled value is rounded to 3 decimals unconditionally — NOT the
 *     per-tag `tagMeta(tag)?.precision` the cleaning ops use
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  preprocessPipelines,
  toModelReady,
  type CleaningStep,
  type Dataset,
  type DataRow,
  type ScalerMethod,
} from '@/lib/preprocessing'
import { precleanse, type PrecleanseConfig } from '@/lib/precleanse'
import {
  applyFeatures,
  selectColumns,
  type FeatureConfig,
} from '@/lib/feature-engineering'
import { tagMeta } from '@/lib/mock-readings'

const FIXTURE_DIR = path.resolve(
  __dirname,
  '../../../../packages/parity-fixtures',
)

/** Tags chosen to exercise every distinct precision: 1, 2, 0, and the ?? 2 default. */
const TAGS = ['TI-101', 'VI-202', 'FI-404', 'XX-999'] as const

const ROW_COUNT = 40

/** Deterministic LCG — fixtures must never depend on Math.random or the clock. */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x100000000
  }
}

function precisionOf(tag: string): number {
  return tagMeta(tag)?.precision ?? 2
}

function round(value: number, precision: number): number {
  const factor = Math.pow(10, precision)
  return Math.round(value * factor) / factor
}

const BASELINE: Record<string, number> = {
  'TI-101': 72,
  'VI-202': 4.5,
  'FI-404': 120,
  'XX-999': 10,
}

/**
 * A fixed grid with deliberately awkward content:
 *   - Bad and Questionable cells at known indices (drives drop/fill/interpolate)
 *   - a leading Bad cell (no forward-fill donor) and a trailing Bad cell (no
 *     backward-fill donor) — where status flips but the value cannot
 *   - extreme outliers (drives zscore / iqr / clip)
 *   - one all-Good column so pass-through behaviour is covered too
 */
function buildInput(): Dataset {
  const rand = lcg(20260801)
  const rows: DataRow[] = []

  for (let i = 0; i < ROW_COUNT; i++) {
    const ts = new Date(Date.UTC(2026, 5, 22, 0, i)).toISOString()
    const cells: DataRow['cells'] = {}

    for (const [tagIndex, tag] of TAGS.entries()) {
      const base = BASELINE[tag] ?? 0
      let value = base + (rand() - 0.5) * 4
      let status: 'Good' | 'Bad' | 'Questionable' = 'Good'

      if (tag !== 'XX-999') {
        // Offset per tag so missingness is RAGGED, not a shared mask. With
        // identical masks a `drop` that applies one tag's marks to every column
        // is indistinguishable from one that unions across tags, and a mean-fill
        // computed globally instead of per-tag could still pass.
        const offset = tagIndex * 3
        if ((i + offset) % 11 === 5) status = 'Bad'
        else if ((i + offset) % 13 === 7) status = 'Questionable'
        if (i === 0 && tag === 'TI-101') status = 'Bad' // no forward donor
        if (i === ROW_COUNT - 1 && tag === 'VI-202') status = 'Bad' // no backward donor
      }

      // Extreme values so IQR fences and z-thresholds actually fire.
      if (i === 9) value = base * 5
      if (i === 27) value = base * -3

      cells[tag] = { value: round(value, precisionOf(tag)), status }
    }
    rows.push({ timestamp: ts, cells })
  }

  return { tags: [...TAGS], rows }
}

const PRECISION: Record<string, number> = Object.fromEntries(
  TAGS.map(t => [t, precisionOf(t)]),
)

interface Fixture {
  name: string
  /** Which client function produced `expected` — Python dispatches on this. */
  engine:
    | 'preprocessPipelines'
    | 'precleanse'
    | 'applyFeatures'
    | 'selectColumns'
    | 'toModelReady'
  input: Dataset
  config: Record<string, unknown>
  expected: Dataset
}

function step(
  method: CleaningStep['method'],
  category: CleaningStep['category'],
  extra: Partial<CleaningStep> = {},
): CleaningStep {
  return { uid: `${category}-${method}`, category, method, ...extra }
}

/** One `CleaningStep[]` per tag, applied through the real client engine. */
function pipelineCase(
  name: string,
  steps: CleaningStep[],
  tags: readonly string[] = TAGS,
): Fixture {
  const input = buildInput()
  const pipelines = Object.fromEntries(tags.map(t => [t, steps]))
  return {
    name,
    engine: 'preprocessPipelines',
    input,
    config: { precision: PRECISION, pipelines },
    // preprocessPipelines clones internally, so `input` stays pristine.
    expected: preprocessPipelines(input, pipelines),
  }
}

function precleanseCase(name: string, cfg: PrecleanseConfig): Fixture {
  const input = buildInput()
  return {
    name,
    engine: 'precleanse',
    input,
    config: { precision: PRECISION, precleanse: cfg },
    expected: precleanse(input, cfg),
  }
}

/** One `FeatureConfig[]` applied through the real client engine. */
function featureCase(
  name: string,
  configs: FeatureConfig[],
  input: Dataset = buildInput(),
): Fixture {
  return {
    name,
    engine: 'applyFeatures',
    input,
    config: { precision: PRECISION, features: configs },
    expected: applyFeatures(input, configs),
  }
}

function selectColumnsCase(name: string, kept: string[] | null): Fixture {
  const input = buildInput()
  return {
    name,
    engine: 'selectColumns',
    input,
    config: { precision: PRECISION, kept },
    expected: selectColumns(input, kept),
  }
}

function scalerCase(name: string, method: ScalerMethod): Fixture {
  const input = buildInput()
  const scalers = Object.fromEntries(TAGS.map(t => [t, method]))
  return {
    name,
    engine: 'toModelReady',
    input,
    config: { scalers },
    expected: toModelReady(input, scalers),
  }
}

/**
 * A tiny, hand-built 3-row grid where TAGS[1]'s value is exactly 0 at row 1 —
 * `buildInput()`'s randomised readings essentially never land on exact 0, so
 * `ratio`'s "divisor is exactly 0 -> Bad" branch (feature-engineering.ts:139)
 * needs its own input to ever fire. Row 2 adds a genuinely Bad source cell
 * (distinct from the zero-divisor case) so this input isn't all-Good — the
 * Python parity suite's own integrity check requires every fixture's input
 * to contain a non-Good cell, `no_ops_is_identity` aside.
 */
function buildRatioZeroInput(): Dataset {
  const [a, b] = TAGS
  return {
    tags: [a!, b!],
    rows: [
      {
        timestamp: new Date(Date.UTC(2026, 5, 22, 0, 0)).toISOString(),
        cells: {
          [a!]: { value: 10, status: 'Good' },
          [b!]: { value: 2, status: 'Good' },
        },
      },
      {
        timestamp: new Date(Date.UTC(2026, 5, 22, 0, 1)).toISOString(),
        cells: {
          [a!]: { value: 10, status: 'Good' },
          [b!]: { value: 0, status: 'Good' },
        },
      },
      {
        timestamp: new Date(Date.UTC(2026, 5, 22, 0, 2)).toISOString(),
        cells: {
          [a!]: { value: 10, status: 'Bad' },
          [b!]: { value: 5, status: 'Good' },
        },
      },
    ],
  }
}

function buildFixtures(): Fixture[] {
  return [
    // ── missing ──────────────────────────────────────────────────────────
    pipelineCase('drop_missing', [step('drop', 'missing')]),
    pipelineCase('fill_missing_ffill', [step('forward', 'missing')]),
    pipelineCase('fill_missing_bfill', [step('backward', 'missing')]),
    pipelineCase('fill_missing_mean', [step('mean', 'missing')]),
    pipelineCase('fill_missing_median', [step('median', 'missing')]),
    pipelineCase('fill_missing_constant', [
      step('constant', 'missing', { param: 42 }),
    ]),
    pipelineCase('fill_missing_constant_default', [
      step('constant', 'missing'),
    ]),
    pipelineCase('fill_missing_linear', [step('interpolate', 'missing')]),

    // ── outliers ─────────────────────────────────────────────────────────
    pipelineCase('remove_outlier_zscore_default', [step('zscore', 'outliers')]),
    pipelineCase('remove_outlier_zscore_t2', [
      step('zscore', 'outliers', { param: 2 }),
    ]),
    pipelineCase('remove_outlier_iqr', [step('outlier_median', 'outliers')]),
    pipelineCase('clip_both_bounds', [
      step('clip', 'outliers', { paramLow: 0, param: 100 }),
    ]),
    pipelineCase('clip_high_only', [step('clip', 'outliers', { param: 50 })]),

    // ── smoothing ────────────────────────────────────────────────────────
    pipelineCase('smooth_moving_avg_default', [
      step('moving_avg', 'smoothing'),
    ]),
    pipelineCase('smooth_moving_avg_w5', [
      step('moving_avg', 'smoothing', { param: 5 }),
    ]),
    pipelineCase('smooth_exponential_default', [
      step('exponential', 'smoothing'),
    ]),
    pipelineCase('smooth_exponential_a07', [
      step('exponential', 'smoothing', { param: 0.7 }),
    ]),

    // ── ordering / partial coverage ──────────────────────────────────────
    // Step order is honoured as listed; this pins fill → outlier → smooth.
    pipelineCase('chain_fill_outlier_smooth', [
      step('interpolate', 'missing'),
      step('outlier_median', 'outliers'),
      step('moving_avg', 'smoothing', { param: 3 }),
    ]),
    // Only one tag has a pipeline: the others pass through untouched, but a
    // `drop` on that one tag still removes whole rows for everyone.
    pipelineCase(
      'drop_single_tag_removes_whole_rows',
      [step('drop', 'missing')],
      ['TI-101'],
    ),
    pipelineCase('no_ops_is_identity', []),

    // ── precleanse (note: SAMPLE std, unlike the zscore cleaning step) ────
    precleanseCase('precleanse_statistical_zscore', {
      crop: null,
      conditional: [],
      statistical: [
        {
          id: 's1',
          tag: 'ALL',
          method: 'zscore',
          threshold: 2,
          action: 'mark',
          enabled: true,
        },
      ],
    }),
    precleanseCase('precleanse_conditional_drop', {
      crop: null,
      conditional: [
        {
          id: 'c1',
          tag: 'TI-101',
          op: '>',
          value: 100,
          action: 'drop',
          enabled: true,
        },
      ],
      statistical: [],
    }),
    precleanseCase('precleanse_time_crop', {
      crop: {
        from: new Date(Date.UTC(2026, 5, 22, 0, 10)).toISOString(),
        to: new Date(Date.UTC(2026, 5, 22, 0, 30)).toISOString(),
      },
      conditional: [],
      statistical: [],
    }),

    // ── DS-LAKE-006-T01: derived features (applyFeatures) ──────────────────
    featureCase('feature_lag', [
      { id: 'f-lag', kind: 'lag', tag: 'TI-101', k: 3 },
    ]),
    featureCase('feature_rolling_mean', [
      {
        id: 'f-roll-mean',
        kind: 'rolling',
        tag: 'TI-101',
        window: 5,
        agg: 'mean',
      },
    ]),
    featureCase('feature_rolling_std', [
      {
        id: 'f-roll-std',
        kind: 'rolling',
        tag: 'VI-202',
        window: 4,
        agg: 'std',
      },
    ]),
    featureCase('feature_rolling_roc', [
      {
        id: 'f-roll-roc',
        kind: 'rolling',
        tag: 'FI-404',
        window: 3,
        agg: 'ROC',
      },
    ]),
    featureCase('feature_delta', [
      { id: 'f-delta', kind: 'delta', tag: 'TI-101' },
    ]),
    featureCase('feature_arith_add', [
      {
        id: 'f-arith-add',
        kind: 'arith',
        op: 'add',
        tags: ['TI-101', 'VI-202'],
      },
    ]),
    // Bad propagation from a source cell — no custom input needed, the base
    // grid's ragged Bad/Questionable cells already drive this.
    featureCase('feature_ratio', [
      { id: 'f-ratio', kind: 'ratio', tags: ['TI-101', 'FI-404'] },
    ]),
    // The base grid's random readings essentially never land on exact 0, so
    // "divisor is exactly 0 -> Bad" needs its own hand-built input.
    featureCase(
      'feature_ratio_by_zero_is_bad',
      [{ id: 'f-ratio-zero', kind: 'ratio', tags: TAGS.slice(0, 2) }],
      buildRatioZeroInput(),
    ),
    // Row 27's injected `base * -3` outlier makes every tag negative there,
    // which is exactly what fires log's "non-positive -> Bad" branch.
    featureCase('feature_log', [{ id: 'f-log', kind: 'log', tag: 'TI-101' }]),
    featureCase('feature_datetime_hour', [
      { id: 'f-dt-hour', kind: 'datetime', part: 'hour' },
    ]),
    featureCase('feature_formula', [
      {
        id: 'f-formula',
        kind: 'formula',
        name: 'sum_two',
        expr: 'c0 + c1',
        vars: { c0: 'TI-101', c1: 'VI-202' },
        display: 'TI-101 + VI-202',
      },
    ]),
    // A later config reading an EARLIER config's derived column — proves
    // `applyFeatures` mutates the same row set in place across configs, not
    // just against the original input.
    featureCase('feature_chain_lag_then_delta_of_lag', [
      { id: 'f-lag1', kind: 'lag', tag: 'TI-101', k: 1 },
      { id: 'f-delta-of-lag', kind: 'delta', tag: 'TI-101__lag1' },
    ]),

    // ── DS-LAKE-006-T01: column selection (selectColumns) ───────────────────
    selectColumnsCase('select_columns_subset', ['TI-101', 'FI-404']),
    selectColumnsCase('select_columns_keep_all_is_identity', null),

    // ── DS-LAKE-006-T01: every scaler (toModelReady) ────────────────────────
    scalerCase('scaler_minmax', 'minmax'),
    scalerCase('scaler_standard', 'standard'),
    scalerCase('scaler_robust', 'robust'),
    scalerCase('scaler_none', 'none'),
  ]
}

describe('parity fixtures', () => {
  it('writes golden fixtures for the Python port', () => {
    if (!existsSync(FIXTURE_DIR)) mkdirSync(FIXTURE_DIR, { recursive: true })

    const fixtures = buildFixtures()
    expect(fixtures.length).toBeGreaterThan(0)

    for (const fixture of fixtures) {
      writeFileSync(
        path.join(FIXTURE_DIR, `${fixture.name}.json`),
        `${JSON.stringify(fixture, null, 2)}\n`,
        'utf8',
      )
    }

    writeFileSync(
      path.join(FIXTURE_DIR, 'index.json'),
      `${JSON.stringify(
        {
          generatedBy: 'apps/client/lib/__tests__/parity-fixtures.test.ts',
          rowCount: ROW_COUNT,
          tags: TAGS,
          precision: PRECISION,
          cases: fixtures.map(f => ({ name: f.name, engine: f.engine })),
        },
        null,
        2,
      )}\n`,
      'utf8',
    )
  })

  it('is deterministic — regenerating produces identical output', () => {
    const a = JSON.stringify(buildFixtures())
    const b = JSON.stringify(buildFixtures())
    expect(a).toBe(b)
  })

  it('the input grid actually contains the edge cases Python must handle', () => {
    const input = buildInput()

    // A leading Bad cell with no forward-fill donor.
    expect(input.rows[0]?.cells['TI-101']?.status).toBe('Bad')
    // A trailing Bad cell with no backward-fill donor.
    expect(input.rows[ROW_COUNT - 1]?.cells['VI-202']?.status).toBe('Bad')
    // At least one Questionable cell — `drop` targets non-Good, not just Bad.
    expect(
      input.rows.some(r =>
        TAGS.some(t => r.cells[t]?.status === 'Questionable'),
      ),
    ).toBe(true)
    // An all-Good column, to prove pass-through.
    expect(input.rows.every(r => r.cells['XX-999']?.status === 'Good')).toBe(
      true,
    )
  })

  it('missingness is ragged across tags, not a shared mask', () => {
    const input = buildInput()
    const badRows = (tag: string) =>
      new Set(
        input.rows
          .map((r, i) => (r.cells[tag]?.status !== 'Good' ? i : -1))
          .filter(i => i >= 0),
      )

    // A pair must differ in BOTH directions — tag A bad where B is good AND
    // vice versa. Without this, `drop_missing` cannot distinguish a correct
    // union-across-tags from an implementation that reuses one tag's mask for
    // every column: the fixture would pass either way.
    const pairs: Array<[string, string]> = [
      ['TI-101', 'VI-202'],
      ['TI-101', 'FI-404'],
      ['VI-202', 'FI-404'],
    ]
    const ragged = pairs.filter(([a, b]) => {
      const A = badRows(a)
      const B = badRows(b)
      return [...A].some(i => !B.has(i)) && [...B].some(i => !A.has(i))
    })

    expect(ragged.length).toBeGreaterThanOrEqual(2)
  })

  it('forward fill flips status to Good even with no donor cell', () => {
    const input = buildInput()
    const beforeValue = input.rows[0]?.cells['TI-101']?.value
    expect(input.rows[0]?.cells['TI-101']?.status).toBe('Bad')

    const out = preprocessPipelines(input, {
      'TI-101': [step('forward', 'missing')],
    })
    const after = out.rows[0]?.cells['TI-101']

    // Status becomes Good; the value is left untouched because no prior Good
    // cell exists. Python must reproduce this, not emit NaN or drop the row.
    expect(after?.status).toBe('Good')
    expect(after?.value).toBe(beforeValue)
  })

  it('zscore replaces outliers with the mean rather than removing them', () => {
    const input = buildInput()
    const rowsBefore = input.rows.length
    const spikeBefore = input.rows[9]?.cells['TI-101']?.value

    const out = preprocessPipelines(input, {
      'TI-101': [step('zscore', 'outliers', { param: 2 })],
    })

    expect(out.rows.length).toBe(rowsBefore)
    expect(out.rows[9]?.cells['TI-101']?.value).not.toBe(spikeBefore)
  })

  it('every written fixture round-trips as valid JSON', () => {
    for (const fixture of buildFixtures()) {
      const raw = readFileSync(
        path.join(FIXTURE_DIR, `${fixture.name}.json`),
        'utf8',
      )
      const parsed = JSON.parse(raw) as Fixture
      expect(parsed.name).toBe(fixture.name)
      expect(parsed.expected.rows.length).toBe(fixture.expected.rows.length)
    }
  })
})
