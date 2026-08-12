import { describe, it, expect } from 'vitest'
import { applyFeatures, applyFeaturesBounded } from '@/lib/feature-engineering'
import { brandBoundedSample, type Dataset } from '@/lib/preprocessing'

/**
 * DS-LAKE-006-AC5 / DS-LAKE-005B-B-T04: mirrors
 * `precleanse.test.ts`'s `percentileBoundsBounded` gate exactly, for the
 * function that actually closes AC5 — `applyFeaturesBounded`, the entry
 * point `dwFeaturedDatasetAtom` (store/dataset-studio.ts) now goes through
 * instead of calling `applyFeatures` on the full raw dataset.
 */
describe('applyFeaturesBounded type gate (DS-LAKE-006-AC5 / DS-LAKE-005B-B-T04)', () => {
  const bare: Dataset = {
    tags: ['TI-1'],
    rows: [
      {
        timestamp: '2026-01-01T00:00:00Z',
        cells: { 'TI-1': { value: 10, status: 'Good' } },
      },
      {
        timestamp: '2026-01-01T00:01:00Z',
        cells: { 'TI-1': { value: 20, status: 'Good' } },
      },
    ],
  }

  it('a valid BoundedSample compiles and returns the same result as applyFeatures', () => {
    const sample = brandBoundedSample(bare)
    const configs = [
      {
        id: 'f1',
        kind: 'arith' as const,
        op: 'add' as const,
        tags: ['TI-1', 'TI-1'],
      },
    ]
    expect(applyFeaturesBounded(sample, configs)).toEqual(
      applyFeatures(bare, configs),
    )
  })

  it('type gate: a bare Dataset cannot be passed to a bounded-only transform function', () => {
    function attemptWithBareDataset() {
      // @ts-expect-error — applyFeaturesBounded only accepts a
      // BoundedSample; a bare Dataset (e.g. straight off dwRawDatasetAtom)
      // is exactly the "full frame handed to a bounded-only consumer by
      // mistake" this brand exists to turn into a compile error.
      return applyFeaturesBounded(bare, [])
    }
    void attemptWithBareDataset
    expect(true).toBe(true)
  })
})
