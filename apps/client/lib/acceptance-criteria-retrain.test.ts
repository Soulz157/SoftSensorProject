import { describe, it, expect } from 'vitest'
import {
  evaluateRetrainCriterion,
  isOfferableRetrainCriterion,
  offerablePairs,
  retrainBuilderOperands,
  retrainCriterionFor,
  retrainCriterionKey,
  retrainCriterionLabel,
  retrainPartnersOf,
  type RetrainCriterion,
  type RetrainFigures,
  type RetrainOperand,
  type RetrainPair,
} from './acceptance-criteria'
import { eventSpreads, scoreRows } from './retrain-lab-events'

// MODEL-SERVE-026-T07: the 'retrain' scope of the acceptance-criteria engine.

const op = (
  metric: RetrainOperand['metric'],
  subject: RetrainOperand['subject'],
  population: RetrainOperand['population'] = 'shared-window',
): RetrainOperand => ({ metric, subject, population })
const key = (o: RetrainOperand) => `${o.metric}:${o.subject}:${o.population}`
const pairKeys = (pairs: RetrainPair[]) =>
  new Set(pairs.map(p => `${key(p.left)}|${key(p.right)}`))
const offered = (a: RetrainOperand, b: RetrainOperand) => {
  const s = pairKeys(offerablePairs('retrain'))
  return s.has(`${key(a)}|${key(b)}`) || s.has(`${key(b)}|${key(a)}`)
}

describe('offerablePairs("retrain") — the rules (MODEL-SERVE-026-T07)', () => {
  it('offers the comparisons the user asked for', () => {
    expect(offered(op('rmse', 'candidate'), op('target-sd', 'window'))).toBe(
      true,
    ) // RMSE < SD
    expect(offered(op('rmse', 'candidate'), op('rmse', 'current'))).toBe(true)
    expect(
      offered(op('mae', 'candidate'), op('residual-sd', 'candidate')),
    ).toBe(true)
    expect(offered(op('r2', 'candidate'), op('r2', 'current'))).toBe(true)
    expect(
      offered(op('residual-sd', 'current'), op('target-sd', 'window')),
    ).toBe(true)
  })

  it('refuses a pair that can only ever come out one way, within one version', () => {
    expect(offered(op('rmse', 'candidate'), op('mae', 'candidate'))).toBe(false)
    expect(
      offered(op('rmse', 'candidate'), op('residual-sd', 'candidate')),
    ).toBe(false)
    // …but the same metrics across two versions can go either way.
    expect(offered(op('rmse', 'candidate'), op('mae', 'current'))).toBe(true)
  })

  it('refuses mixed units and the same figure twice', () => {
    expect(offered(op('r2', 'candidate'), op('rmse', 'current'))).toBe(false)
    expect(offered(op('r2', 'candidate'), op('target-sd', 'window'))).toBe(
      false,
    )
    expect(offered(op('rmse', 'candidate'), op('rmse', 'candidate'))).toBe(
      false,
    )
  })

  it('V04 — refuses every cross-population pair, in BOTH operand orders', () => {
    const s = pairKeys(offerablePairs('retrain'))
    const own = op('rmse', 'current', 'own-test')
    for (const other of [
      op('rmse', 'candidate'),
      op('target-sd', 'window'),
      op('rmse', 'candidate', 'own-test'),
    ]) {
      expect(s.has(`${key(other)}|${key(own)}`)).toBe(false)
      expect(s.has(`${key(own)}|${key(other)}`)).toBe(false)
    }
    expect([...s].every(k => !k.includes('own-test'))).toBe(true)
  })

  it('the builder only ever offers pairs the rules allow', () => {
    for (const left of retrainBuilderOperands()) {
      for (const right of retrainPartnersOf(left)) {
        expect(offered(left, right)).toBe(true)
      }
    }
  })

  it('leaves the run scope exactly as it was (no-argument call)', () => {
    const run = offerablePairs()
    expect(run.length).toBeGreaterThan(0)
    expect(
      run.every(p => !('subject' in p.left) && !('subject' in p.right)),
    ).toBe(true)
  })
})

describe('evaluateRetrainCriterion (MODEL-SERVE-026-T07)', () => {
  const figures = (over: Partial<RetrainFigures> = {}): RetrainFigures => ({
    candidate: { rmse: 9.3, r2: 0.37, mae: 7, residualSd: 9 },
    current: { rmse: 12.1, r2: -0.07, mae: 10, residualSd: 11 },
    targetSd: 11.7,
    ...over,
  })

  it('RMSE < SD of lab values: pass/fail with both readings', () => {
    const c: RetrainCriterion = {
      kind: 'retrain-comparison',
      left: op('rmse', 'candidate'),
      operator: 'lt',
      right: op('target-sd', 'window'),
    }
    expect(evaluateRetrainCriterion(c, figures())).toEqual({
      verdict: 'pass',
      left: { value: 9.3, absence: null },
      right: { value: 11.7, absence: null },
    })
    expect(retrainCriterionLabel(c)).toBe(
      'New version RMSE < SD of lab values on the shared window',
    )
    const cur = { ...c, left: op('rmse', 'current') }
    expect(evaluateRetrainCriterion(cur, figures()).verdict).toBe('fail')
  })

  it('RMSE < SD(lab values) agrees with R² > 0 on real-shaped rows', () => {
    const rows = [
      { yTrue: 100, yPred: 101 },
      { yTrue: 110, yPred: 107 },
      { yTrue: 95, yPred: 99 },
    ]
    const m = scoreRows(rows)
    const sp = eventSpreads(rows)
    expect(m.rmse! < sp.targetSd!).toBe(m.r2! > 0)
    // RMSE is never below the error SD (RMSE² = SD² + bias²).
    expect(m.rmse!).toBeGreaterThanOrEqual(sp.residualSd! - 1e-12)
  })

  it('a preset version-vs-version pair points the "better" way', () => {
    const rmse = retrainCriterionFor({
      left: op('rmse', 'candidate'),
      right: op('rmse', 'current'),
    })
    expect(rmse.operator).toBe('lt')
    const r2 = retrainCriterionFor({
      left: op('r2', 'candidate'),
      right: op('r2', 'current'),
    })
    expect(r2.operator).toBe('gt')
  })

  it('not evaluated when a figure is undefined; R² floor unchanged', () => {
    const c: RetrainCriterion = {
      kind: 'retrain-comparison',
      left: op('rmse', 'candidate'),
      operator: 'lt',
      right: op('target-sd', 'window'),
    }
    expect(
      evaluateRetrainCriterion(c, figures({ targetSd: null })).verdict,
    ).toBe('not-evaluated')
    const floor = { kind: 'retrain-r2-floor' as const }
    expect(evaluateRetrainCriterion(floor, figures()).verdict).toBe('pass')
  })

  it('A < B and B > A are the same criterion; only offerable pairs validate', () => {
    const a: RetrainCriterion = {
      kind: 'retrain-comparison',
      left: op('rmse', 'candidate'),
      operator: 'lt',
      right: op('target-sd', 'window'),
    }
    const b: RetrainCriterion = {
      kind: 'retrain-comparison',
      left: op('target-sd', 'window'),
      operator: 'gt',
      right: op('rmse', 'candidate'),
    }
    expect(retrainCriterionKey(a)).toBe(retrainCriterionKey(b))
    expect(
      isOfferableRetrainCriterion({ ...a, right: op('mae', 'candidate') }),
    ).toBe(false)
  })
})
