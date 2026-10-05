import { describe, it, expect } from 'vitest'
import { compareMetric } from './retrain-metric-compare'

describe('compareMetric', () => {
  it('rmse and mae: lower is better', () => {
    expect(compareMetric('rmse', 0.42, 0.51)).toMatchObject({
      verdict: 'better',
    })
    expect(compareMetric('rmse', 0.6, 0.51)).toMatchObject({ verdict: 'worse' })
    expect(compareMetric('mae', 0.3, 0.5)).toMatchObject({ verdict: 'better' })
  })

  it('r2: higher is better', () => {
    expect(compareMetric('r2', 0.95, 0.9)).toMatchObject({ verdict: 'better' })
    expect(compareMetric('r2', 0.8, 0.9)).toMatchObject({ verdict: 'worse' })
  })

  it('delta is new minus current, in the metric units', () => {
    expect(compareMetric('rmse', 0.75, 1.25)?.delta).toBeCloseTo(-0.5, 10)
  })

  it('a difference the 4dp display cannot show is "same", never a verdict', () => {
    expect(compareMetric('rmse', 0.50001, 0.5)).toMatchObject({
      verdict: 'same',
    })
    expect(compareMetric('rmse', 0.5001, 0.5)).toMatchObject({
      verdict: 'worse',
    })
  })

  it('no verdict from one side alone', () => {
    expect(compareMetric('rmse', null, 0.5)).toBeNull()
    expect(compareMetric('rmse', 0.5, undefined)).toBeNull()
    expect(compareMetric('r2', Number.NaN, 0.5)).toBeNull()
    expect(compareMetric('r2', 0.5, Number.POSITIVE_INFINITY)).toBeNull()
  })
})
