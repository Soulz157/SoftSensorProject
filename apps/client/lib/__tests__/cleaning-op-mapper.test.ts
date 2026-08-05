import { describe, it, expect } from 'vitest'
import { toCleaningOperations } from '@/lib/cleaning-op-mapper'
import type { CleaningStep } from '@/lib/preprocessing'

/**
 * `type: step.method` needs no alias table because `CLEANING_OPS` in
 * `apps/python/services/cleaning_service.py` is keyed by the browser's own
 * `CleaningMethod` values (verified by reading that file this session, not
 * assumed). These tests pin the wire shape so a future rename on either side
 * shows up as a failing test instead of a silently-misrouted operation.
 */
describe('toCleaningOperations', () => {
  it('carries the method straight through as `type`, scoped to every given tag', () => {
    const steps: CleaningStep[] = [
      { uid: 's1', category: 'missing', method: 'drop' },
    ]

    expect(toCleaningOperations(steps, ['TI-101', 'TI-102'])).toEqual([
      { type: 'drop', tags: ['TI-101', 'TI-102'] },
    ])
  })

  it('passes param/paramLow through by their exact names, omitting them when unset', () => {
    const steps: CleaningStep[] = [
      {
        uid: 's1',
        category: 'outliers',
        method: 'clip',
        param: 100,
        paramLow: 0,
      },
      { uid: 's2', category: 'smoothing', method: 'moving_avg', param: 5 },
      { uid: 's3', category: 'missing', method: 'forward' },
    ]

    expect(toCleaningOperations(steps, ['TI-101'])).toEqual([
      { type: 'clip', tags: ['TI-101'], param: 100, paramLow: 0 },
      { type: 'moving_avg', tags: ['TI-101'], param: 5 },
      { type: 'forward', tags: ['TI-101'] },
    ])
  })

  it('preserves step order — the pipeline is a SEQUENCE, not a bag', () => {
    const steps: CleaningStep[] = [
      { uid: 's1', category: 'missing', method: 'drop' },
      { uid: 's2', category: 'outliers', method: 'zscore', param: 3 },
      { uid: 's3', category: 'smoothing', method: 'exponential', param: 0.3 },
    ]

    const result = toCleaningOperations(steps, ['TI-101'])

    expect(result.map(op => op.type)).toEqual(['drop', 'zscore', 'exponential'])
  })

  it('maps an empty pipeline to an empty operations list', () => {
    expect(toCleaningOperations([], ['TI-101'])).toEqual([])
  })
})
