import { describe, it, expect } from 'vitest'
import { brandBoundedSample, type Dataset } from '@/lib/preprocessing'
import { DataAnalysisCard } from '../data-analysis-card'

/**
 * DS-LAKE-005B-D-T07 / DS-LAKE-005B-D-V05. Mirrors
 * `feature-engineering-bounded.test.ts`'s `applyFeaturesBounded` gate
 * exactly, for the component that closes AC5/V05: `DataAnalysisCard`'s
 * `dataset` prop is `BoundedSample`-typed, so a bare `Dataset` (e.g.
 * straight off `dwRawDatasetAtom`) can no longer reach it — proven here as
 * a compile-time-only check, never rendered (`DataAnalysisCard` needs a
 * live jotai/atom context this file doesn't set up; the point of this test
 * is the TS error, not a render).
 */
describe('DataAnalysisCard dataset prop type gate (DS-LAKE-005B-D-T07/V05)', () => {
  const bare: Dataset = {
    tags: ['TI-1'],
    rows: [
      {
        timestamp: '2026-01-01T00:00:00Z',
        cells: { 'TI-1': { value: 10, status: 'Good' } },
      },
    ],
  }

  it('a valid BoundedSample compiles as the dataset prop', () => {
    function attemptWithBoundedSample() {
      const sample = brandBoundedSample(bare)
      return <DataAnalysisCard dataset={sample} range="7d" />
    }
    void attemptWithBoundedSample
    expect(true).toBe(true)
  })

  it('type gate: a bare Dataset cannot be passed as the dataset prop', () => {
    function attemptWithBareDataset() {
      // @ts-expect-error — DataAnalysisCard's `dataset` prop only accepts a
      // BoundedSample; a bare Dataset (e.g. straight off dwRawDatasetAtom)
      // is exactly the "full frame handed back into DataAnalysisCard by
      // mistake" this task's own scope_note names.
      return <DataAnalysisCard dataset={bare} range="7d" />
    }
    void attemptWithBareDataset
    expect(true).toBe(true)
  })
})
