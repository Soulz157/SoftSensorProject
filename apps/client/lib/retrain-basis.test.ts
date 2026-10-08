import { describe, it, expect } from 'vitest'
import {
  CURRENT_USED_FOR,
  describeCurrentBasis,
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
  it('AUGMENT_DATA with no recorded fit: describes what the data CONTAINS, not what was trained on', () => {
    const text = describeTrainingComposition(
      'AUGMENT_DATA',
      {
        baseTrainRowCount: 80,
        newTrainRowCount: 20,
        dedupeDropped: 3,
        cutTimestamp: '2026-06-01T00:00:00Z',
        combinedRowCount: 97,
        fitRowCount: null,
        fitUpTo: null,
        newDataUsedInFit: null,
      },
      'Reactor tags v4',
    )
    expect(text).toBe(
      'Built from: existing data up to 2026-06-01 (80 rows) + Reactor tags v4 (20 rows), 3 repeated rows removed',
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
        fitRowCount: null,
        fitUpTo: null,
        newDataUsedInFit: null,
      },
      'Reactor tags v4',
    )
    expect(text).not.toContain('removed')
  })

  it('NEW_DATA_ONLY with no recorded fit: the new dataset alone, as what it was built from', () => {
    const text = describeTrainingComposition(
      'NEW_DATA_ONLY',
      {
        baseTrainRowCount: 0,
        newTrainRowCount: 20,
        dedupeDropped: 0,
        cutTimestamp: '2026-06-01T00:00:00Z',
        combinedRowCount: 20,
        fitRowCount: null,
        fitUpTo: null,
        newDataUsedInFit: null,
      },
      'Reactor tags v4',
    )
    expect(text).toBe('Built from: Reactor tags v4 only (20 rows)')
  })

  it('with a recorded fit, states what the model was FIT on — not what the artifact contains', () => {
    const base = {
      baseTrainRowCount: 3091,
      newTrainRowCount: 24,
      dedupeDropped: 0,
      cutTimestamp: '2025-11-06 19:00:00',
      combinedRowCount: 3115,
    }
    // The real 5-of-5 case: the fit stops at 2025-09-29, all 24 new rows are
    // in the test split.
    expect(
      describeTrainingComposition(
        'AUGMENT_DATA',
        {
          ...base,
          fitRowCount: 2180,
          fitUpTo: '2025-09-29 20:00:00',
          newDataUsedInFit: false,
        },
        'the new dataset',
      ),
    ).toBe(
      'Trained on: 2,180 rows up to 2025-09-29. None of the new data was used to train it \u2014 it was used only for testing',
    )
    // New data in the fit: no warning, just the fit.
    expect(
      describeTrainingComposition(
        'AUGMENT_DATA',
        {
          ...base,
          fitRowCount: 3100,
          fitUpTo: '2025-11-20 00:00:00',
          newDataUsedInFit: true,
        },
        'the new dataset',
      ),
    ).toBe('Trained on: 3,100 rows up to 2025-11-20')
    // Unknown: states the fit, claims nothing about the new data either way.
    expect(
      describeTrainingComposition(
        'AUGMENT_DATA',
        {
          ...base,
          fitRowCount: 3100,
          fitUpTo: '2025-11-20 00:00:00',
          newDataUsedInFit: null,
        },
        'the new dataset',
      ),
    ).toBe('Trained on: 3,100 rows up to 2025-11-20')
  })

  it('never says “trained on” about the combined data when no fit was recorded', () => {
    const text = describeTrainingComposition(
      'AUGMENT_DATA',
      {
        baseTrainRowCount: 80,
        newTrainRowCount: 20,
        dedupeDropped: 0,
        cutTimestamp: '2026-06-01T00:00:00Z',
        combinedRowCount: 100,
        fitRowCount: null,
        fitUpTo: null,
        newDataUsedInFit: null,
      },
      'ds',
    )
    expect(text).not.toMatch(/trained on/i)
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

describe('describeCurrentBasis', () => {
  it('own test split: says the score is the one stored when it was trained', () => {
    const text = describeCurrentBasis(
      basis({ frame: 'INCUMBENT_TEST_SPLIT', to: null, rowCount: 911 }),
      'v3',
    )
    expect(text).toBe(
      'Its own test data, scored when v3 was trained · from 2026-06-01 · 911 rows',
    )
  })

  it('new-data window: says it is the same rows the new version was scored on', () => {
    expect(
      describeCurrentBasis(basis({ frame: 'NEW_DATA_WINDOW' }), 'v3'),
    ).toBe(
      'The same new-data window as the new version, scored during this retrain · 2026-06-01 – 2026-07-01 · 40 rows',
    )
  })

  it('never prints "vnull" when the version is unknown', () => {
    const text = describeCurrentBasis(
      basis({ frame: 'INCUMBENT_TEST_SPLIT' }),
      null,
    )
    expect(text).toContain('scored when it was trained')
    expect(text).not.toMatch(/vnull|undefined/)
  })

  it('falls back to the unavailable reason, or the not-recorded text', () => {
    expect(
      describeCurrentBasis(
        basis({ rowCount: null, unavailableReason: 'not recorded for v3' }),
        'v3',
      ),
    ).toBe('not recorded for v3')
    expect(describeCurrentBasis(null, 'v3')).toBe(
      'Not recorded for this retrain',
    )
  })

  it('no internal vocabulary in any frame', () => {
    for (const frame of [
      'INCUMBENT_TEST_SPLIT',
      'FROZEN_INCUMBENT_TEST',
      'MERGED_TEST_SPLIT',
      'NEW_DATA_WINDOW',
    ] as const) {
      expect(describeCurrentBasis(basis({ frame }), 'v3')).not.toMatch(JARGON)
    }
    expect(CURRENT_USED_FOR).not.toMatch(JARGON)
  })
})
