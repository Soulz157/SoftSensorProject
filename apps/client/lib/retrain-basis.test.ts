import { describe, it, expect } from 'vitest'
import {
  describeEvalBasis,
  describeUsedFor,
  describeTrainingComposition,
  legacyStrategyLabel,
} from './retrain-basis'
import type { EvalBasis } from '@/services/model-retrain'

const JARGON =
  /incumbent|frozen|holdout|regime|merged test split|dedupe|evalSet/i

function basis(overrides: Partial<EvalBasis> = {}): EvalBasis {
  return {
    frame: 'FROZEN_INCUMBENT_TEST',
    from: '2026-06-01T00:00:00Z',
    to: '2026-07-01T00:00:00Z',
    rowCount: 40,
    usedFor: 'COMPARE_TO_PRODUCTION',
    unavailableReason: null,
    ...overrides,
  }
}

describe('describeEvalBasis', () => {
  it('names the version, the range and the row count, jargon-free', () => {
    const text = describeEvalBasis(basis(), 'v3')
    expect(text).toContain('v3')
    expect(text).toContain('2026-06-01')
    expect(text).toContain('2026-07-01')
    expect(text).toContain('40 rows')
    expect(text).not.toMatch(JARGON)
  })

  it('every frame renders jargon-free text', () => {
    const frames: EvalBasis['frame'][] = [
      'INCUMBENT_TEST_SPLIT',
      'FROZEN_INCUMBENT_TEST',
      'MERGED_TEST_SPLIT',
      'NEW_DATA_WINDOW',
    ]
    for (const frame of frames) {
      expect(describeEvalBasis(basis({ frame }), 'v3')).not.toMatch(JARGON)
    }
  })

  it('states the reason instead of "0 rows" when rowCount is null', () => {
    const text = describeEvalBasis(
      basis({
        rowCount: null,
        unavailableReason: 'no new-data window was set aside for this retrain',
      }),
      'v3',
    )
    expect(text).toBe('no new-data window was set aside for this retrain')
    expect(text).not.toContain('0 rows')
  })

  it('falls back to a generic reason when the basis itself is null', () => {
    expect(describeEvalBasis(null, 'v3')).toBe('Not recorded for this retrain')
  })

  it('works without a known version label', () => {
    expect(describeEvalBasis(basis(), null)).toContain('the current version')
  })
})

describe('describeUsedFor', () => {
  it('maps each code to a plain phrase', () => {
    expect(describeUsedFor('RANK_CANDIDATES')).toMatch(/pick the best/i)
    expect(describeUsedFor('COMPARE_TO_PRODUCTION')).toMatch(/compare/i)
    expect(describeUsedFor('REPORT_ONLY')).toMatch(/on its own/i)
    expect(describeUsedFor(null)).toBeNull()
  })
})

describe('describeTrainingComposition', () => {
  it('AUGMENT_DATA: existing + new + dropped rows', () => {
    const text = describeTrainingComposition(
      'AUGMENT_DATA',
      {
        baseTrainRowCount: 80,
        newTrainRowCount: 20,
        dedupeDropped: 3,
        cutTimestamp: '2026-06-01T00:00:00Z',
        combinedRowCount: 97,
      },
      'Reactor tags v4',
    )
    expect(text).toBe(
      'Trained on: existing data up to 2026-06-01 (80 rows) + Reactor tags v4 (20 rows), 3 repeated rows removed',
    )
  })

  it('AUGMENT_DATA: omits the dropped clause when nothing was dropped', () => {
    const text = describeTrainingComposition(
      'AUGMENT_DATA',
      {
        baseTrainRowCount: 80,
        newTrainRowCount: 20,
        dedupeDropped: 0,
        cutTimestamp: '2026-06-01T00:00:00Z',
        combinedRowCount: 100,
      },
      'Reactor tags v4',
    )
    expect(text).not.toContain('removed')
  })

  it('NEW_DATA_ONLY: the new dataset alone', () => {
    const text = describeTrainingComposition(
      'NEW_DATA_ONLY',
      {
        baseTrainRowCount: 0,
        newTrainRowCount: 20,
        dedupeDropped: 0,
        cutTimestamp: '2026-06-01T00:00:00Z',
        combinedRowCount: 20,
      },
      'Reactor tags v4',
    )
    expect(text).toBe('Trained on: Reactor tags v4 only (20 rows)')
  })

  it('returns null rather than a fabricated line when never recorded', () => {
    expect(describeTrainingComposition('AUGMENT_DATA', null, 'ds')).toBeNull()
  })
})

describe('legacyStrategyLabel', () => {
  it('maps every stored value, including null, to plain text', () => {
    expect(legacyStrategyLabel('AUGMENT_DATA')).toBe('existing + new data')
    expect(legacyStrategyLabel('NEW_DATA_ONLY')).toBe('new data only')
    expect(legacyStrategyLabel('KEEP_EXISTING')).toBe('same data as before')
    expect(legacyStrategyLabel(null)).toBe('same data as before')
  })
})
