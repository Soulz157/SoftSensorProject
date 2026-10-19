import { describe, it, expect } from 'vitest'
import { sourceTagsOf } from './dataset-source-tags'
import type { SavedDataset } from '@/store/datasets'

function ds(
  tags: string[],
  features: unknown[] | undefined,
): Pick<SavedDataset, 'tags' | 'pipelineConfig'> {
  return {
    tags,
    pipelineConfig: { features } as unknown as SavedDataset['pipelineConfig'],
  }
}

describe('sourceTagsOf', () => {
  it('drops the columns the recipe engineered — lag, rolling, delta, formula', () => {
    const d = ds(
      [
        'TI-101',
        'PI-201',
        'TI-101__lag1',
        'TI-101__roll24_mean',
        'PI-201__delta',
        'Yield calc',
      ],
      [
        { id: '1', kind: 'lag', tag: 'TI-101', k: 1 },
        { id: '2', kind: 'rolling', tag: 'TI-101', window: 24, agg: 'mean' },
        { id: '3', kind: 'delta', tag: 'PI-201' },
        { id: '4', kind: 'formula', name: 'Yield calc', expr: 'a*b' },
      ],
    )
    expect(sourceTagsOf(d)).toEqual(['TI-101', 'PI-201'])
  })

  it('keeps a source tag whose name merely contains "lag" or "roll"', () => {
    const d = ds(
      ['FLAG-7', 'ROLLER-SPEED', 'FLAG-7__lag2'],
      [{ id: '1', kind: 'lag', tag: 'FLAG-7', k: 2 }],
    )
    expect(sourceTagsOf(d)).toEqual(['FLAG-7', 'ROLLER-SPEED'])
  })

  it('keeps every tag for a recipe with no feature list', () => {
    expect(sourceTagsOf(ds(['A', 'B'], undefined))).toEqual(['A', 'B'])
    expect(sourceTagsOf(ds(['A', 'B'], []))).toEqual(['A', 'B'])
  })
})
