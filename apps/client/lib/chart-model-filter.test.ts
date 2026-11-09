import { describe, it, expect } from 'vitest'
import {
  seriesStylesFor,
  toggleHiddenRun,
  visibleForCharts,
} from './chart-model-filter'

const C = [
  { runId: 'a', algorithm: 'ridge' },
  { runId: 'b', algorithm: 'xgboost' },
  { runId: 'c', algorithm: 'ridge' },
  { runId: null, algorithm: 'svm' },
]

describe('seriesStylesFor', () => {
  it('labels by algorithm, numbering only repeated ones, in list order', () => {
    const s = seriesStylesFor(C)
    expect(s.get('a')).toEqual({ label: 'Ridge Regression #1', colorIndex: 0 })
    expect(s.get('b')?.label).toBe('XGBoost')
    expect(s.get('c')).toEqual({ label: 'Ridge Regression #2', colorIndex: 2 })
    expect(s.size).toBe(3)
  })

  it('keeps a model’s label and colour fixed regardless of what is hidden', () => {
    const full = seriesStylesFor(C)
    const visible = visibleForCharts(C, new Set(['a']))
    expect(visible.map(c => c.runId)).toEqual(['b', 'c', null])
    // The caller always styles from the FULL list, so c stays #2, colour 2.
    expect(full.get('c')).toEqual({
      label: 'Ridge Regression #2',
      colorIndex: 2,
    })
  })
})

describe('toggleHiddenRun', () => {
  const all = ['a', 'b', 'c']

  it('hides, then shows again', () => {
    const hidden = toggleHiddenRun(new Set(), 'a', all)
    expect([...hidden]).toEqual(['a'])
    expect([...toggleHiddenRun(hidden, 'a', all)]).toEqual([])
  })

  it('never hides the last visible model', () => {
    const hidden = new Set(['a', 'b'])
    expect([...toggleHiddenRun(hidden, 'c', all)].sort()).toEqual(['a', 'b'])
  })
})

describe('visibleForCharts', () => {
  it('ignores a hidden id that names no candidate', () => {
    expect(visibleForCharts(C, new Set(['gone']))).toHaveLength(4)
  })
})
