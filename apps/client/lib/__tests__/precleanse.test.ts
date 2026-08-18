import { describe, it, expect } from 'vitest'
import { percentileBoundsBounded } from '@/lib/precleanse'
import { brandBoundedSample, type Dataset } from '@/lib/preprocessing'

/**
 * DS-LAKE-005B-B-V03: "a fixture that passes an unbounded frame into a
 * client transform library must fail type-checking, asserted with
 * @ts-expect-error so that removing the brand breaks the build."
 *
 * This is the CONSUMER-side counterpart to `dataset-version.test.ts`'s
 * existing type gate (which proves a bare `Dataset` cannot forge a
 * `BoundedSample` on the PRODUCER side). Here the target is a real,
 * exported client transform library function — `percentileBoundsBounded`
 * (`lib/precleanse.ts`) — not a locally-defined stub, so the gate is
 * proven against production code, not a fixture that only resembles it.
 *
 * Checked by `pnpm --filter client check-types`, not by a runtime
 * assertion: if the `BoundedSample` brand were ever weakened to a plain
 * type alias for `Dataset`, this line would stop erroring and
 * `@ts-expect-error` itself would fail as an unused directive — that is
 * the actual assertion this test makes.
 */
describe('percentileBoundsBounded type gate (DS-LAKE-005B-B-T04/V03)', () => {
  it('a valid BoundedSample compiles and returns the same result as percentileBounds', () => {
    const bare: Dataset = {
      tags: ['TI-1'],
      rows: [
        {
          timestamp: '2026-01-01T00:00:00Z',
          cells: { 'TI-1': { value: 1, status: 'Good' } },
        },
        {
          timestamp: '2026-01-01T00:01:00Z',
          cells: { 'TI-1': { value: 2, status: 'Good' } },
        },
        {
          timestamp: '2026-01-01T00:02:00Z',
          cells: { 'TI-1': { value: 3, status: 'Good' } },
        },
      ],
    }
    const sample = brandBoundedSample(bare)
    const bound = percentileBoundsBounded(sample, 'TI-1', 0, 100)
    expect(bound).toEqual({ min: 1, max: 3 })
  })

  it('type gate: a bare Dataset cannot be passed to a bounded-only transform function', () => {
    function attemptWithBareDataset() {
      const bare: Dataset = { tags: [], rows: [] }
      // @ts-expect-error — percentileBoundsBounded only accepts a
      // BoundedSample; a bare Dataset (e.g. straight off dwRawDatasetAtom)
      // is exactly the "full frame handed to a bounded-only consumer by
      // mistake" this brand exists to turn into a compile error.
      return percentileBoundsBounded(bare, 'TI-1', 0, 100)
    }
    void attemptWithBareDataset
    expect(true).toBe(true)
  })
})
