import { describe, expect, it } from 'vitest'
import { defaultHyperparams } from './training-config'
import {
  DEFAULT_SPLIT_PERCENT,
  finetuneStartingHyperparams,
  splitPercentFrom,
  variantAsHyperparams,
} from './retrain-finetune'

describe('finetuneStartingHyperparams', () => {
  it("starts from the current version's own values, over the full defaults", () => {
    const record = finetuneStartingHyperparams('random_forest', {
      n_estimators: 350,
    })
    expect(record).toEqual({
      ...defaultHyperparams('random_forest'),
      n_estimators: 350,
    })
  })

  it('keeps a null the version recorded (an "unlimited" knob), but drops non-scalar values', () => {
    const record = finetuneStartingHyperparams('random_forest', {
      max_depth: null,
      nested: { a: 1 },
    })
    expect(record.max_depth).toBeNull()
    expect(record).not.toHaveProperty('nested')
  })

  it('is the plain defaults when the version recorded nothing', () => {
    expect(finetuneStartingHyperparams('ridge', null)).toEqual(
      defaultHyperparams('ridge'),
    )
  })
})

describe('variantAsHyperparams', () => {
  it('lays a curated variant over the defaults, so every knob is sent', () => {
    expect(variantAsHyperparams('ridge', { alpha: 10 })).toEqual({
      ...defaultHyperparams('ridge'),
      alpha: 10,
    })
  })
})

describe('splitPercentFrom', () => {
  it("turns the current version's ratio into the control's percent", () => {
    expect(splitPercentFrom(0.7)).toBe(70)
    expect(splitPercentFrom(0.8)).toBe(80)
  })

  it("snaps to the control's 5% step and its 50–95 range", () => {
    expect(splitPercentFrom(0.83)).toBe(85)
    expect(splitPercentFrom(0.99)).toBe(95)
    expect(splitPercentFrom(0.3)).toBe(50)
  })

  it('falls back to the default when there is no usable ratio', () => {
    expect(splitPercentFrom(null)).toBe(DEFAULT_SPLIT_PERCENT)
  })
})
