/**
 * DS-LAKE-005B-D-T02 chart parity-fixture generator.
 *
 * Freezes the CURRENT client histogram/KDE/boxplot statistics into golden
 * JSON so `apps/python/services/histogram_service.py` and `boxplot_service.py`
 * (already shipped, DS-LAKE-005B-D-T01/T03) can be proven equal — the same
 * discipline `parity-fixtures.test.ts` (F0) already applies to the cleaning
 * engines, extended to chart math. Sibling to that generator, not a merge
 * into it: chart output is `{domain_min, domain_max, tags: [...], ...}`,
 * not a `Dataset`, and dropping these into `packages/parity-fixtures/`
 * directly would break that suite's `engine`/`expected.tags`/`expected.rows`
 * assertions. This writes to `packages/parity-fixtures/charts/` instead —
 * `conftest.py`'s existing `FIXTURE_DIR.glob("*.json")` is non-recursive, so
 * the grid suite never sees this subdirectory.
 *
 * Reuses `buildInput()` / `TAGS` / `lcg()` from `parity-fixture-grid.ts`
 * verbatim (the same awkward ragged-missingness grid), rather than forking a
 * second one — see that module's own header for why.
 *
 * SCOPE BOUNDARY: this gate proves the STATISTICS match (histogram bins/KDE/
 * mean/median/mode/std, boxplot quartiles/whiskers/outliers) for a FIXED,
 * empty `operations: []` window. It deliberately does NOT prove reactivity
 * (that a crop/conditional/statistical rule edit changes the output) — that
 * is DS-LAKE-005B-D-V02, a separate, not-yet-built verification item, and
 * folding it in here would silently redefine what T02 closes.
 *
 * Quirks pinned here — Python must reproduce these, NOT the pandas/numpy/
 * scipy defaults:
 *   - histogram domain is SHARED across every qualifying tag in one request
 *     (min/max of every qualifying tag's Good values COMBINED), not per-tag
 *   - the domain is padded 50% of its range before KDE sampling — or by
 *     `abs(domainMax)` when the range is 0, or by `1` when both are 0
 *   - KDE bandwidth is Silverman's rule of thumb using SAMPLE std (ddof=1,
 *     `n - 1` divisor) — population std would under-smooth
 *   - the KDE curve is returned already rescaled onto the histogram's count
 *     axis (`density * n * binWidth`); `bin_count` is a WIDTH DIVISOR for
 *     that rescale only, never used for discrete binning
 *   - boxplot quartiles use LINEAR INTERPOLATION over sorted values
 *     (`idx = p*(n-1)`, floor/ceil blend) — NOT the no-interpolation
 *     `sorted[floor(n*0.25)]` convention `lib/precleanse.ts::tagStats` uses
 *     for outlier detection; the two are deliberately different numbers for
 *     different purposes, pinned separately so a future merge doesn't
 *     silently unify them
 *   - boxplot "qualifies" is `count > 0` on the SERVER, a deliberate
 *     divergence from the client's presentational `hasData` check
 *     (`min !== max || median !== 0`) in `tag-boxplot-chart.tsx` — `hasData`
 *     mislabels an all-exactly-zero tag as insufficient data. This
 *     generator encodes the server's intended contract directly, not a
 *     port of `hasData` — see `boxplot_all_zero_tag_qualifies` below.
 *   - `scatter`'s regression coefficients are OLS via the SAME sum-of-
 *     products form `lib/preprocessing.ts::linearRegression` uses, over
 *     pairs where BOTH x and y are Good — a DELIBERATE, TRACKED divergence
 *     from `toScatterPoints` (`lib/preprocessing.ts`), which is status-
 *     blind and is NOT what the server ports. Each scatter fixture carries
 *     both `expected` (Good-filtered, the server's contract) and
 *     `clientQuirk` (what `toScatterPoints` + `linearRegression` compute
 *     TODAY, unfiltered) so the divergence is a tested fact, not a comment
 *     — see `scatter_two_tags_default` below. `toScatterPoints` itself is
 *     NOT edited to match: it also backs Model Creation Flow evaluation
 *     metrics (`lib/model-metrics.ts`) and two other live chart consumers.
 *     Decimation (`points`/`downsampled`) has no client equivalent to be at
 *     parity with — the client plots every point, decimation is a
 *     server-only concern (ADR-DS-LAKE-005B-D-scatter-decimation) — so
 *     scatter fixtures pin the REGRESSION MATH only, not a point sample.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import type { Dataset, DataRow } from '@/lib/preprocessing'
import { toScatterPoints, linearRegression } from '@/lib/preprocessing'
import {
  tagDistribution,
  kdeEstimate,
  densityToCount,
  tagBoxplotStats,
} from '@/lib/data-quality'
import { TAGS, buildInput } from './parity-fixture-grid'

const FIXTURE_DIR = path.resolve(
  __dirname,
  '../../../../packages/parity-fixtures/charts',
)

/** Arbitrary — the fixture harness's fake object store doesn't validate this
 * against a real artifact, only records what it was called with. */
const SOURCE_KEY = 'fixture/chart-artifact.parquet'

const DEFAULT_BIN_COUNT = 12
const DEFAULT_KDE_SAMPLES = 100
const DEFAULT_OUTLIER_CAP = 50
const DEFAULT_SCATTER_MAX_POINTS = 2000

interface HistogramFixture {
  name: string
  engine: 'histogram'
  input: Dataset
  config: {
    source_key: string
    tags: string[]
    bin_count: number
    kde_samples: number
  }
  expected: {
    source_key: string
    domain_min: number | null
    domain_max: number | null
    tags: Array<{
      tag: string
      mean: number
      median: number
      mode: number
      std: number
      min: number
      max: number
      range: number
      count: number
      kde: Array<{ x: number; y: number }>
    }>
    insufficient_tags: string[]
  }
}

interface BoxplotFixture {
  name: string
  engine: 'boxplot'
  input: Dataset
  config: {
    source_key: string
    tags: string[]
    outlier_cap: number
  }
  expected: {
    source_key: string
    tags: Array<{
      tag: string
      min: number
      q1: number
      median: number
      mean: number
      q3: number
      max: number
      whisker_low: number
      whisker_high: number
      outliers: number[]
      outlier_count: number
      count: number
    }>
    insufficient_tags: string[]
  }
}

interface ScatterFixture {
  name: string
  engine: 'scatter'
  input: Dataset
  config: {
    source_key: string
    x_tag: string
    y_tag: string
    max_points: number
  }
  /** The server's contract — Good-filtered pairs only. Does NOT include
   * `points`/`downsampled`: decimation has no client equivalent to compare
   * against (see this file's header). */
  expected: {
    source_key: string
    x_tag: string
    y_tag: string
    n: number
    slope: number
    intercept: number
    r2: number
  }
  /** What `toScatterPoints` + `linearRegression` compute TODAY —
   * status-blind, the divergence this fixture pins. */
  clientQuirk: {
    n: number
    slope: number
    intercept: number
    r2: number
  }
}

type Fixture = HistogramFixture | BoxplotFixture | ScatterFixture

function goodValues(ds: Dataset, tag: string): number[] {
  const values: number[] = []
  for (const row of ds.rows) {
    const cell = row.cells[tag]
    if (cell && cell.status === 'Good') values.push(cell.value)
  }
  return values
}

/** Mirrors `histogram_service.build_histogram` exactly — the SAME real
 * client functions (`tagDistribution`, `kdeEstimate`, `densityToCount`)
 * the service's own docstring cites as its parity target, orchestrated the
 * same way: shared cross-tag domain, then per-tag distribution + rescaled KDE. */
function buildHistogramCase(
  name: string,
  input: Dataset,
  tags: string[],
  binCount = DEFAULT_BIN_COUNT,
  kdeSamples = DEFAULT_KDE_SAMPLES,
): HistogramFixture {
  const goodByTag = new Map(tags.map(t => [t, goodValues(input, t)]))
  const qualifying = tags.filter(t => (goodByTag.get(t) ?? []).length >= 2)
  const insufficient = tags.filter(t => !qualifying.includes(t))

  if (qualifying.length === 0) {
    return {
      name,
      engine: 'histogram',
      input,
      config: {
        source_key: SOURCE_KEY,
        tags,
        bin_count: binCount,
        kde_samples: kdeSamples,
      },
      expected: {
        source_key: SOURCE_KEY,
        domain_min: null,
        domain_max: null,
        tags: [],
        insufficient_tags: insufficient,
      },
    }
  }

  const allValues = qualifying.flatMap(t => goodByTag.get(t)!)
  const domainMin = Math.min(...allValues)
  const domainMax = Math.max(...allValues)
  const binWidth = binCount ? (domainMax - domainMin) / binCount : 0

  const range = domainMax - domainMin
  const pad = (range || Math.abs(domainMax) || 1) * 0.5
  const paddedMin = domainMin - pad
  const paddedMax = domainMax + pad

  const tagsOut = qualifying.map(tag => {
    const values = goodByTag.get(tag)!
    const dist = tagDistribution(input, tag)
    const kdePoints = kdeEstimate(
      values,
      { min: paddedMin, max: paddedMax },
      kdeSamples,
    )
    const kde = kdePoints.map(p => ({
      x: p.x,
      y: densityToCount(p.y, values.length, binWidth),
    }))
    return { tag, ...dist, count: values.length, kde }
  })

  return {
    name,
    engine: 'histogram',
    input,
    config: {
      source_key: SOURCE_KEY,
      tags,
      bin_count: binCount,
      kde_samples: kdeSamples,
    },
    expected: {
      source_key: SOURCE_KEY,
      domain_min: domainMin,
      domain_max: domainMax,
      tags: tagsOut,
      insufficient_tags: insufficient,
    },
  }
}

/** Mirrors `boxplot_service.build_boxplot` exactly — same real
 * `tagBoxplotStats`, and the SAME `count > 0` qualifying rule the service
 * deliberately uses instead of the client's presentational `hasData`. */
function buildBoxplotCase(
  name: string,
  input: Dataset,
  tags: string[],
  outlierCap = DEFAULT_OUTLIER_CAP,
): BoxplotFixture {
  const tagsOut: BoxplotFixture['expected']['tags'] = []
  const insufficient: string[] = []

  for (const tag of tags) {
    const good = goodValues(input, tag)
    if (good.length === 0) {
      insufficient.push(tag)
      continue
    }
    const stats = tagBoxplotStats(input, tag)
    tagsOut.push({
      tag,
      min: stats.min,
      q1: stats.q1,
      median: stats.median,
      mean: stats.mean,
      q3: stats.q3,
      max: stats.max,
      whisker_low: stats.whiskerLow,
      whisker_high: stats.whiskerHigh,
      outliers: stats.outliers.slice(0, outlierCap),
      outlier_count: stats.outliers.length,
      count: good.length,
    })
  }

  return {
    name,
    engine: 'boxplot',
    input,
    config: { source_key: SOURCE_KEY, tags, outlier_cap: outlierCap },
    expected: {
      source_key: SOURCE_KEY,
      tags: tagsOut,
      insufficient_tags: insufficient,
    },
  }
}

/** Mirrors `scatter_service.build_scatter`'s regression math exactly — the
 * SAME real `linearRegression` (`lib/preprocessing.ts`) the service's own
 * docstring cites as its parity target, fit over pairs where BOTH x and y
 * are Good (ADR-DS-LAKE-005B-D-scatter-status-filter). `clientQuirk` runs
 * the SAME `linearRegression` over `toScatterPoints`'s status-blind output
 * — today's real client behaviour — so the divergence is captured as data,
 * not asserted separately from what the client actually does. */
function buildScatterCase(
  name: string,
  input: Dataset,
  xTag: string,
  yTag: string,
  maxPoints = DEFAULT_SCATTER_MAX_POINTS,
): ScatterFixture {
  const goodPoints: { x: number; y: number }[] = []
  for (const row of input.rows) {
    const x = row.cells[xTag]
    const y = row.cells[yTag]
    if (x && y && x.status === 'Good' && y.status === 'Good') {
      goodPoints.push({ x: x.value, y: y.value })
    }
  }
  const goodReg = linearRegression(goodPoints)

  const quirkPoints = toScatterPoints(input, xTag, yTag)
  const quirkReg = linearRegression(quirkPoints)

  return {
    name,
    engine: 'scatter',
    input,
    config: {
      source_key: SOURCE_KEY,
      x_tag: xTag,
      y_tag: yTag,
      max_points: maxPoints,
    },
    expected: {
      source_key: SOURCE_KEY,
      x_tag: xTag,
      y_tag: yTag,
      n: goodPoints.length,
      slope: goodReg.slope,
      intercept: goodReg.intercept,
      r2: goodReg.r2,
    },
    clientQuirk: {
      n: quirkPoints.length,
      slope: quirkReg.slope,
      intercept: quirkReg.intercept,
      r2: quirkReg.r2,
    },
  }
}

/** A small hand-built grid, independent of the shared `buildInput()` one,
 * for cases that need a SPECIFIC Good/Bad shape the ragged base grid
 * doesn't happen to contain (an exactly-1-Good tag, an all-Good-zero tag,
 * a tag with far more outliers than a small `outlier_cap`). */
function grid(
  tags: string[],
  cellFor: (
    rowIndex: number,
    tag: string,
  ) => { value: number; status: 'Good' | 'Bad' | 'Questionable' } | null,
  rowCount: number,
): Dataset {
  const rows: DataRow[] = []
  for (let i = 0; i < rowCount; i++) {
    const rowCells: DataRow['cells'] = {}
    for (const tag of tags) {
      const cell = cellFor(i, tag)
      if (cell) rowCells[tag] = cell
    }
    rows.push({
      timestamp: new Date(Date.UTC(2026, 5, 22, 0, i)).toISOString(),
      cells: rowCells,
    })
  }
  return { tags, rows }
}

function buildFixtures(): Fixture[] {
  const base = buildInput()
  const [tiTag, viTag, fiTag, xxTag] = TAGS

  return [
    // ── histogram ────────────────────────────────────────────────────────
    buildHistogramCase('histogram_two_tags_default', base, [tiTag, fiTag]),
    // Different baselines (72 / 4.5 / 120 / 10) — exercises the SHARED
    // cross-tag domain spanning very different scales, not a per-tag one.
    buildHistogramCase('histogram_four_tags_shared_domain', base, [
      tiTag,
      viTag,
      fiTag,
      xxTag,
    ]),
    buildHistogramCase(
      'histogram_custom_bin_and_kde_counts',
      base,
      [tiTag],
      6,
      25,
    ),
    buildHistogramCase(
      'histogram_insufficient_tag_excluded',
      grid(
        [tiTag, viTag],
        (i, tag) => {
          if (tag === tiTag) return { value: 70 + i, status: 'Good' }
          // viTag: exactly one Good value — fails the >=2-Good qualifying bar.
          return { value: 4.5, status: i === 0 ? 'Good' : 'Bad' }
        },
        5,
      ),
      [tiTag, viTag],
    ),
    buildHistogramCase(
      'histogram_all_tags_insufficient',
      grid(
        [tiTag, viTag],
        (i, tag) => {
          if (tag === tiTag)
            return { value: 70, status: i === 0 ? 'Good' : 'Bad' }
          return { value: 4.5, status: 'Bad' } // 0 Good values
        },
        3,
      ),
      [tiTag, viTag],
    ),

    // ── boxplot ──────────────────────────────────────────────────────────
    buildBoxplotCase('boxplot_four_tags_default', base, [...TAGS]),
    buildBoxplotCase(
      'boxplot_outlier_cap_truncates',
      grid(
        [tiTag],
        (i, _tag) => {
          // 12 tightly-clustered Good values + 8 extreme outliers, so a
          // cap of 3 provably truncates (outlier_count stays the true 8).
          const outlierRows = [12, 13, 14, 15, 16, 17, 18, 19]
          if (outlierRows.includes(i)) {
            const sign = i % 2 === 0 ? 1 : -1
            return { value: 72 + sign * (400 + i * 10), status: 'Good' }
          }
          return { value: 70 + (i % 3), status: 'Good' }
        },
        20,
      ),
      [tiTag],
      3,
    ),
    // The deliberate `_qualifies` divergence: every Good value is EXACTLY
    // 0. The client's presentational `hasData` (`min !== max || median !==
    // 0`) would call this insufficient; the server's `count > 0` rule does
    // not, because this is genuine data (e.g. a valve stuck fully closed),
    // not an empty window. `expected` encodes the server's intended
    // contract, not `hasData` — see this file's own header.
    buildBoxplotCase(
      'boxplot_all_zero_tag_qualifies',
      grid([tiTag], () => ({ value: 0, status: 'Good' }), 5),
      [tiTag],
    ),
    buildBoxplotCase(
      'boxplot_zero_good_values_insufficient',
      grid([tiTag], () => ({ value: 70, status: 'Bad' }), 3),
      [tiTag],
    ),
    // n === 1 is `_quantile`'s own special case (no interpolation possible) —
    // every quartile collapses to the single value, IQR is 0, no outliers.
    buildBoxplotCase(
      'boxplot_single_good_value',
      grid(
        [tiTag],
        (i, _tag) => ({ value: 42, status: i === 0 ? 'Good' : 'Bad' }),
        3,
      ),
      [tiTag],
    ),

    // ── scatter ──────────────────────────────────────────────────────────
    // Base grid has ragged Bad/Questionable cells on every non-XX tag, so
    // `expected` (Good-filtered) and `clientQuirk` (status-blind) provably
    // diverge here — see the assertion in the describe block below.
    buildScatterCase('scatter_two_tags_default', base, tiTag, fiTag),
    // No Bad/Questionable cells at all — `expected` and `clientQuirk` must
    // be IDENTICAL, proving the divergence above comes from the status
    // filter alone, not from some other difference between the two paths.
    buildScatterCase(
      'scatter_all_good_no_divergence',
      grid(
        [tiTag, fiTag],
        (i, tag) => ({
          value: tag === tiTag ? 10 + i : 20 + 2 * i,
          status: 'Good',
        }),
        10,
      ),
      tiTag,
      fiTag,
    ),
    // y = 2x + 5 exactly — regression should recover slope/intercept near-
    // exactly and r2 ~= 1, a sanity anchor independent of the ragged grid.
    buildScatterCase(
      'scatter_perfect_line',
      grid(
        [tiTag, fiTag],
        (i, tag) => ({ value: tag === tiTag ? i : 2 * i + 5, status: 'Good' }),
        15,
      ),
      tiTag,
      fiTag,
    ),
  ]
}

describe('chart parity fixtures', () => {
  it('writes golden chart fixtures for the Python port', () => {
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
          generatedBy:
            'apps/client/lib/__tests__/chart-parity-fixtures.test.ts',
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

  it('every qualifying tag in every case has at least 2 Good values (histogram) or 1 (boxplot)', () => {
    for (const fixture of buildFixtures()) {
      if (fixture.engine === 'histogram') {
        for (const t of fixture.expected.tags)
          expect(t.count).toBeGreaterThanOrEqual(2)
      } else if (fixture.engine === 'boxplot') {
        for (const t of fixture.expected.tags)
          expect(t.count).toBeGreaterThanOrEqual(1)
      }
      // scatter's `expected` has no per-tag `count` shape — its own `n` is
      // checked by the scatter-specific assertions below instead.
    }
  })

  it('boxplot_outlier_cap_truncates actually exercises truncation', () => {
    const fixture = buildFixtures().find(
      f => f.name === 'boxplot_outlier_cap_truncates',
    ) as BoxplotFixture
    const tag = fixture.expected.tags[0]!
    expect(tag.outlier_count).toBeGreaterThan(tag.outliers.length)
    expect(tag.outliers.length).toBe(3)
  })

  it('boxplot_all_zero_tag_qualifies pins the deliberate hasData divergence', () => {
    const fixture = buildFixtures().find(
      f => f.name === 'boxplot_all_zero_tag_qualifies',
    ) as BoxplotFixture
    // Server qualifies it (present in `tags`, not `insufficient_tags`) even
    // though min === max === median === 0 — exactly what `hasData` rejects.
    expect(fixture.expected.insufficient_tags).toEqual([])
    expect(fixture.expected.tags[0]?.min).toBe(0)
    expect(fixture.expected.tags[0]?.max).toBe(0)
    expect(fixture.expected.tags[0]?.median).toBe(0)
  })

  it('scatter_two_tags_default pins the deliberate toScatterPoints status-blind divergence', () => {
    const fixture = buildFixtures().find(
      f => f.name === 'scatter_two_tags_default',
    ) as ScatterFixture
    // The base grid has ragged Bad/Questionable cells on every non-XX tag —
    // `toScatterPoints` counts a row whenever both cells EXIST regardless
    // of status, so `clientQuirk.n` includes every row; `expected.n`
    // (Good-filtered) must be strictly smaller.
    expect(fixture.expected.n).toBeLessThan(fixture.clientQuirk.n)
    expect(fixture.clientQuirk.n).toBe(fixture.input.rows.length)
  })

  it('scatter_all_good_no_divergence proves the divergence comes from the status filter alone', () => {
    const fixture = buildFixtures().find(
      f => f.name === 'scatter_all_good_no_divergence',
    ) as ScatterFixture
    expect(fixture.expected).toEqual({
      source_key: fixture.config.source_key,
      x_tag: fixture.config.x_tag,
      y_tag: fixture.config.y_tag,
      ...fixture.clientQuirk,
    })
  })

  it('scatter_perfect_line recovers the exact line', () => {
    const fixture = buildFixtures().find(
      f => f.name === 'scatter_perfect_line',
    ) as ScatterFixture
    expect(fixture.expected.slope).toBeCloseTo(2, 9)
    expect(fixture.expected.intercept).toBeCloseTo(5, 9)
    expect(fixture.expected.r2).toBeCloseTo(1, 9)
  })
})
