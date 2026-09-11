import { describe, it, expect } from 'vitest'
import {
  canonicalise,
  criterionEqual,
  criterionLabel,
  evaluateCriterion,
  isLegacyCriterion,
  offerablePairs,
  operatorSymbol,
  pairLabel,
  pairsEqual,
  type AcceptanceCriterion,
  type ComparisonCriterion,
  type ComparisonFigures,
  NO_RESIDUAL_SD,
  type ComparisonPair,
} from './acceptance-criteria'
import type { SourcedMetrics } from './metric-source'
import type { ResidualSdCell } from './residual-sd'

function testSplit(over: Partial<Omit<SourcedMetrics, 'source'>> = {}) {
  return {
    source: 'test-split',
    r2: 0.9,
    rmse: 0.5,
    mae: 0.4,
    ...over,
  } satisfies SourcedMetrics
}

function holdout(over: Partial<Omit<SourcedMetrics, 'source'>> = {}) {
  return {
    source: 'holdout',
    r2: 0.8,
    rmse: 0.169,
    mae: 0.14,
    rowCount: 1153,
    droppedUnlabelled: 0,
    droppedBadFeatures: 0,
    ...over,
  } satisfies SourcedMetrics
}

function cvEstimate(over: Partial<Omit<SourcedMetrics, 'source'>> = {}) {
  return {
    source: 'cv-fold-estimate',
    nSplits: 5,
    mean: { r2: 0.6, rmse: 0.4, mae: 0.3 },
    std: { r2: 0.02, rmse: 0.05, mae: 0.03 },
    ...over,
  } satisfies SourcedMetrics
}

function figures(over: Partial<ComparisonFigures> = {}): ComparisonFigures {
  return {
    sourcedMetrics: [],
    // MODEL-FLOW-019-T33. A pair now, not one cell — `NO_RESIDUAL_SD` is the
    // "this surface fetched neither population" default every case here
    // started from when there was a single nullable cell.
    residualSd: NO_RESIDUAL_SD,
    holdoutAbsence: null,
    ...over,
  }
}

/** T33. The common single-population shape these cases used before the pair:
 *  one cell in its own population's slot, the other genuinely absent. */
function sdFigures(cell: ResidualSdCell): ComparisonFigures['residualSd'] {
  return cell.source === 'holdout'
    ? { 'test-split': null, holdout: cell }
    : { 'test-split': cell, holdout: null }
}

function sd(over: Partial<ResidualSdCell> = {}): ResidualSdCell {
  return { value: 0.4, source: 'test-split', absence: null, ...over }
}

function comparison(
  left: ComparisonCriterion['left'],
  operator: ComparisonCriterion['operator'],
  right: ComparisonCriterion['right'],
): ComparisonCriterion {
  return { kind: 'comparison', left, operator, right }
}

describe('offerablePairs — derived, not hand-listed (AC24/AC25/AC29/V10)', () => {
  const pairs = offerablePairs()

  it('offers exactly the four pairs this system can support today', () => {
    const shapes = new Set(
      pairs.map(
        p =>
          `${p.left.metric}:${p.left.source ?? '*'}/${p.right.metric}:${p.right.source ?? '*'}`,
      ),
    )
    expect(shapes).toEqual(
      new Set([
        'mae:*/sd:*',
        'r2:holdout/r2:test-split',
        'mae:holdout/mae:test-split',
        'rmse:holdout/rmse:test-split',
      ]),
    )
  })

  it('never offers RMSE against MAE in EITHER direction — the pair is refused outright, not just one orientation', () => {
    expect(
      pairs.some(p => p.left.metric === 'rmse' && p.right.metric === 'mae'),
    ).toBe(false)
    expect(
      pairs.some(p => p.left.metric === 'mae' && p.right.metric === 'rmse'),
    ).toBe(false)
  })

  it('never offers RMSE against SD in EITHER direction', () => {
    expect(
      pairs.some(p => p.left.metric === 'rmse' && p.right.metric === 'sd'),
    ).toBe(false)
    expect(
      pairs.some(p => p.left.metric === 'sd' && p.right.metric === 'rmse'),
    ).toBe(false)
  })

  it('offers R² as a cross-source comparison — inadmissible as a ratio, admissible here (AC27)', () => {
    expect(
      pairs.some(p => p.left.metric === 'r2' || p.right.metric === 'r2'),
    ).toBe(true)
  })

  it('never offers a pair spanning unit classes — RMSE against R², SD against R² (AC25)', () => {
    expect(
      pairs.some(
        p =>
          (p.left.metric === 'r2' && p.right.metric !== 'r2') ||
          (p.right.metric === 'r2' && p.left.metric !== 'r2'),
      ),
    ).toBe(false)
  })

  it('an SD-bearing pair is run-resolved on both sides — neither operand names a source (AC29)', () => {
    const pair = pairs.find(
      p => p.left.metric === 'sd' || p.right.metric === 'sd',
    )
    expect(pair?.left.source).toBeUndefined()
    expect(pair?.right.source).toBeUndefined()
  })

  it('never pairs a pinned operand with a run-resolved one (AC29/V16)', () => {
    const mixed = pairs.some(
      p => (p.left.source !== undefined) !== (p.right.source !== undefined),
    )
    expect(mixed).toBe(false)
  })
})

describe('canonicalise / criterionEqual — the mirror is refused, not just the reverse comparator (AC31/AC38/V17)', () => {
  it('a criterion and its operand-swapped, operator-inverted mirror canonicalise identically', () => {
    const a = comparison({ metric: 'rmse', source: 'holdout' }, 'lt', {
      metric: 'rmse',
      source: 'test-split',
    })
    const mirror = comparison({ metric: 'rmse', source: 'test-split' }, 'gt', {
      metric: 'rmse',
      source: 'holdout',
    })
    expect(canonicalise(a)).toEqual(canonicalise(mirror))
    expect(criterionEqual(a, mirror)).toBe(true)
  })

  it('two criteria over the same pair but genuinely different operators are NOT equal', () => {
    const a = comparison({ metric: 'mae' }, 'lt', { metric: 'sd' })
    const b = comparison({ metric: 'mae' }, 'gt', { metric: 'sd' })
    expect(criterionEqual(a, b)).toBe(false)
  })

  it('two criteria over different pairs are never equal', () => {
    const a = comparison({ metric: 'rmse', source: 'holdout' }, 'lt', {
      metric: 'rmse',
      source: 'test-split',
    })
    const b = comparison({ metric: 'mae', source: 'holdout' }, 'lt', {
      metric: 'mae',
      source: 'test-split',
    })
    expect(criterionEqual(a, b)).toBe(false)
  })

  it('every r2-floor criterion equals every other — it carries no operands', () => {
    expect(criterionEqual({ kind: 'r2-floor' }, { kind: 'r2-floor' })).toBe(
      true,
    )
  })

  it('pairsEqual is order-independent, matching canonicalise', () => {
    const a: ComparisonPair = {
      left: { metric: 'rmse', source: 'holdout' },
      right: { metric: 'rmse', source: 'test-split' },
    }
    const b: ComparisonPair = {
      left: { metric: 'rmse', source: 'test-split' },
      right: { metric: 'rmse', source: 'holdout' },
    }
    expect(pairsEqual(a, b)).toBe(true)
  })
})

describe('evaluateCriterion — comparisons, both operands negative included (AC27/V15)', () => {
  it('evaluates a pinned same-metric cross-source comparison', () => {
    const criterion = comparison({ metric: 'rmse', source: 'holdout' }, 'lt', {
      metric: 'rmse',
      source: 'test-split',
    })
    const result = evaluateCriterion(
      criterion,
      figures({
        sourcedMetrics: [testSplit({ rmse: 0.42 }), holdout({ rmse: 0.81 })],
      }),
    )
    expect(result.verdict).toBe('fail') // 0.81 is not < 0.42
    expect(result.left.value).toBeCloseTo(0.81)
    expect(result.right.value).toBeCloseTo(0.42)
  })

  it('evaluates R² correctly with BOTH operands negative', () => {
    const criterion = comparison({ metric: 'r2', source: 'holdout' }, 'gt', {
      metric: 'r2',
      source: 'test-split',
    })
    const result = evaluateCriterion(
      criterion,
      figures({
        sourcedMetrics: [testSplit({ r2: -1_110_858 }), holdout({ r2: -4.2 })],
      }),
    )
    expect(result.verdict).toBe('pass') // -4.2 > -1,110,858
    expect(result.left.value).toBeCloseTo(-4.2)
    expect(result.right.value).toBeCloseTo(-1_110_858)
  })

  it("resolves an SD-bearing pair from the SAME population the run's own residual SD occupies", () => {
    const criterion = comparison({ metric: 'mae' }, 'lt', { metric: 'sd' })
    const result = evaluateCriterion(
      criterion,
      figures({
        sourcedMetrics: [testSplit({ mae: 0.3 }), holdout({ mae: 0.5 })],
        residualSd: sdFigures(sd({ value: 0.4, source: 'test-split' })),
      }),
    )
    // 0.3 (test mae) < 0.4 (sd), never 0.5 (holdout mae).
    expect(result.left.value).toBeCloseTo(0.3)
    expect(result.verdict).toBe('pass')
  })
})

/**
 * MODEL-FLOW-019-T33. The pair replaced a single nullable cell, and the claim
 * made for it is that NO verdict changes: an `sd` operand carries no source of
 * its own, so it resolves to the population the single cell used to occupy.
 * These two cases are that claim, not an inspection of it.
 */
describe('evaluateCriterion — an unsourced sd operand resolves as the single cell did (T33)', () => {
  const criterion = comparison({ metric: 'mae' }, 'lt', { metric: 'sd' })

  it('reads the TEST cell on a non-CV run that now has both populations', () => {
    const result = evaluateCriterion(
      criterion,
      figures({
        sourcedMetrics: [testSplit({ mae: 0.3 })],
        residualSd: {
          'test-split': sd({ value: 0.4, source: 'test-split' }),
          // Present and different — if the fallback picked this, the
          // comparison below would read 0.9 and the verdict would flip.
          holdout: sd({ value: 0.9, source: 'holdout' }),
        },
      }),
    )
    expect(result.right.value).toBeCloseTo(0.4)
    expect(result.verdict).toBe('pass')
  })

  it('skips a CV run’s absence-bearing TEST cell and reads the holdout one', () => {
    const result = evaluateCriterion(
      criterion,
      figures({
        // A holdout `mae` is REQUIRED here, and the requirement is itself the
        // pre-existing coupling this task had to preserve: an unsourced
        // RANKABLE operand takes its population from the SD cell's source
        // too, so once SD resolves to holdout, `mae` does as well. A fixture
        // with only test-split metrics reads not-evaluated — correctly, and
        // for a reason that has nothing to do with the pair.
        sourcedMetrics: [testSplit({ mae: 0.8 }), holdout({ mae: 0.3 })],
        residualSd: {
          // Exists, but carries a reason rather than a number — the shape a
          // scored CV run's Test column now has. It must not win the
          // fallback just by being non-null.
          'test-split': sd({
            value: null,
            source: 'test-split',
            absence: 'no-test-split',
          }),
          holdout: sd({ value: 0.45, source: 'holdout' }),
        },
      }),
    )
    expect(result.right.value).toBeCloseTo(0.45)
    expect(result.verdict).toBe('pass')
  })
})

describe('evaluateCriterion — not-evaluated is never fail, both absence directions (AC14/V13)', () => {
  const criterion = comparison({ metric: 'rmse', source: 'holdout' }, 'lt', {
    metric: 'rmse',
    source: 'test-split',
  })

  it("reads not-evaluated, naming the reason, when the left operand's source is entirely absent", () => {
    const result = evaluateCriterion(
      criterion,
      figures({
        sourcedMetrics: [testSplit()],
        holdoutAbsence: 'no-dataset-holdout',
      }),
    )
    expect(result.verdict).toBe('not-evaluated')
    expect(result.left.absence).toBe('no-dataset-holdout')
  })

  it("reads not-evaluated when the right operand's field is null though the source exists", () => {
    expect(
      evaluateCriterion(
        criterion,
        figures({ sourcedMetrics: [holdout(), testSplit({ rmse: null })] }),
      ).verdict,
    ).toBe('not-evaluated')
  })

  it("reads not-evaluated for an SD-bearing pair when residualSd is entirely absent (Step 3's own preview)", () => {
    expect(
      evaluateCriterion(
        comparison({ metric: 'mae' }, 'lt', { metric: 'sd' }),
        figures({ sourcedMetrics: [testSplit()], residualSd: NO_RESIDUAL_SD }),
      ).verdict,
    ).toBe('not-evaluated')
  })

  it('reads not-evaluated for the r2-floor criterion when no holdout figure exists, never a false pass', () => {
    expect(
      evaluateCriterion(
        { kind: 'r2-floor' },
        figures({
          sourcedMetrics: [testSplit()],
          holdoutAbsence: 'not-scored-yet',
        }),
      ).verdict,
    ).toBe('not-evaluated')
  })
})

describe('evaluateCriterion — the CV fold mean is refused AT THE OPERAND, not reached through absence (AC28/V18)', () => {
  it('a CV run whose fold mean is PRESENT still reads not-evaluated, naming cross-validation, never comparing against the mean', () => {
    const criterion = comparison({ metric: 'mae' }, 'lt', { metric: 'sd' })
    // Deliberately constructed, type-level-only state: `residualSdOf` never
    // emits `'cv-fold-estimate'` today, but the type permits it, and this
    // proves the guard fires if it ever did rather than silently reading
    // the fold mean as though it were a measurement.
    const result = evaluateCriterion(
      criterion,
      figures({
        sourcedMetrics: [
          cvEstimate({ mean: { r2: 0.6, rmse: 0.4, mae: 0.31 } }),
        ],
        residualSd: sdFigures({
          value: 0.31,
          source: 'cv-fold-estimate' as ResidualSdCell['source'],
          absence: null,
        }),
      }),
    )
    expect(result.verdict).toBe('not-evaluated')
    expect(result.left.absence).toBe('cross-validation')
    expect(result.left.value).toBeNull()
  })
})

describe('isLegacyCriterion — both prior shapes are detected by shape (V19)', () => {
  it("identifies T07's {metric, source, value} shape", () => {
    expect(
      isLegacyCriterion({ metric: 'rmse', source: 'holdout', value: 0.5 }),
    ).toBe(true)
  })

  it("identifies T11's {left, right, ratio} shape", () => {
    expect(
      isLegacyCriterion({
        left: { metric: 'rmse', source: 'holdout' },
        right: { metric: 'mae', source: 'holdout' },
        ratio: 1.3,
      }),
    ).toBe(true)
  })

  it('does not misidentify a current-shape comparison criterion', () => {
    expect(
      isLegacyCriterion(
        comparison({ metric: 'rmse', source: 'holdout' }, 'lt', {
          metric: 'rmse',
          source: 'test-split',
        }),
      ),
    ).toBe(false)
  })

  it('does not misidentify a current-shape r2-floor criterion', () => {
    expect(isLegacyCriterion({ kind: 'r2-floor' } as AcceptanceCriterion)).toBe(
      false,
    )
  })
})

describe('labels', () => {
  it('operatorSymbol renders < and > only', () => {
    expect(operatorSymbol('lt')).toBe('<')
    expect(operatorSymbol('gt')).toBe('>')
  })

  it('pairLabel names the source for a pinned operand and omits it for a run-resolved one', () => {
    expect(
      pairLabel({
        left: { metric: 'rmse', source: 'holdout' },
        right: { metric: 'rmse', source: 'test-split' },
      }),
    ).toBe('Validate RMSE vs Test RMSE')
    expect(
      pairLabel({ left: { metric: 'mae' }, right: { metric: 'sd' } }),
    ).toBe('MAE vs SD')
  })

  it('criterionLabel renders the operator between the two operand labels', () => {
    expect(
      criterionLabel(
        comparison({ metric: 'rmse', source: 'holdout' }, 'lt', {
          metric: 'rmse',
          source: 'test-split',
        }),
      ),
    ).toBe('Validate RMSE < Test RMSE')
  })

  it('criterionLabel renders the r2-floor criterion as a fixed threshold', () => {
    expect(criterionLabel({ kind: 'r2-floor' })).toBe('Validate R² ≥ 0')
  })
})
