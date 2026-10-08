import { describe, it, expect } from 'vitest'
import { attributeChange, currentSettingsRunId } from './retrain-attribution'

describe('currentSettingsRunId (MODEL-SERVE-026-T06)', () => {
  const current = {
    algorithm: 'random_forest',
    hyperparameters: { max_depth: null, n_estimators: 100 },
  }
  const cand = (
    runId: string,
    hyperparameters: Record<string, unknown>,
    status = 'SUCCEEDED',
    algorithm = 'random_forest',
  ) => ({ runId, algorithm, hyperparameters, status })

  it('finds B by algorithm and settings, ignoring key order', () => {
    expect(
      currentSettingsRunId(
        [
          cand('c1', { max_depth: 6, n_estimators: 150 }),
          cand('b', { n_estimators: 100, max_depth: null }),
        ],
        current,
      ),
    ).toBe('b')
  })

  it('null when B did not run, failed, or used another algorithm', () => {
    expect(
      currentSettingsRunId(
        [cand('c1', { max_depth: 6, n_estimators: 150 })],
        current,
      ),
    ).toBeNull()
    expect(
      currentSettingsRunId(
        [cand('b', { max_depth: null, n_estimators: 100 }, 'FAILED')],
        current,
      ),
    ).toBeNull()
    expect(
      currentSettingsRunId(
        [
          cand(
            'b',
            { max_depth: null, n_estimators: 100 },
            'SUCCEEDED',
            'ridge',
          ),
        ],
        current,
      ),
    ).toBeNull()
  })
})

describe('attributeChange (MODEL-SERVE-026-T06)', () => {
  it('splits A->C into the data effect (A->B) and the settings effect (B->C)', () => {
    const r = attributeChange(12, 10, 9)
    expect(r).toEqual({ dataEffect: -2, settingsEffect: -1 })
    // The two parts always add back to the whole.
    expect(r.dataEffect! + r.settingsEffect!).toBe(9 - 12)
  })

  it('when the picked candidate IS B, the settings did nothing', () => {
    expect(attributeChange(12, 10, 10).settingsEffect).toBe(0)
  })

  it('null for any side not yet read', () => {
    expect(attributeChange(null, 10, 9)).toEqual({
      dataEffect: null,
      settingsEffect: -1,
    })
  })
})
