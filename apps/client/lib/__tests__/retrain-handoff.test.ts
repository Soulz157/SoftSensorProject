import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  clearRetrainHandoff,
  consumeRetrainHandoff,
  peekRetrainHandoff,
  rememberRetrainHandoff,
  retrainReturnUrl,
  isAugmentedVersion,
  AUGMENTED_VERSION_SUFFIX,
  type RetrainHandoff,
} from '../retrain-handoff'

/**
 * MODEL-SERVE-015-T06. What keeps an augmented retrain's own output from
 * being offered back as the next retrain's "new data". The predicate reads
 * `semanticVersion` because the versions-list endpoint does not return
 * `lineage` — so if the backend ever changes its suffix without changing
 * this constant, every augmented version silently becomes selectable again.
 */
describe('isAugmentedVersion', () => {
  it('matches a version the backend minted from an augmented retrain', () => {
    expect(
      isAugmentedVersion({
        semanticVersion: `4.0.0${AUGMENTED_VERSION_SUFFIX}`,
      }),
    ).toBe(true)
  })

  it('does not match an ordinary saved version', () => {
    expect(isAugmentedVersion({ semanticVersion: '4.0.0' })).toBe(false)
  })

  it('does not match a suffix that merely appears mid-string', () => {
    expect(isAugmentedVersion({ semanticVersion: '4.0.0+augmented.1' })).toBe(
      false,
    )
  })

  it('treats a missing or null semanticVersion as not augmented', () => {
    expect(isAugmentedVersion({ semanticVersion: null })).toBe(false)
    expect(isAugmentedVersion({})).toBe(false)
    expect(isAugmentedVersion(null)).toBe(false)
    expect(isAugmentedVersion(undefined)).toBe(false)
  })
})

/**
 * MODEL-SERVE-017. The record that survives the retrain dialog sending an
 * operator into the Data Studio wizard.
 *
 * Two of these cases are not about convenience. A stored value is read back
 * later and pushed into the router, so it is untrusted input by the time it
 * is used: a non-path `returnTo` would be an open redirect, and a storage
 * accessor that throws (private browsing, blocked site data) must degrade to
 * "no return trip" rather than taking the save handler down with it.
 */

const VALID: RetrainHandoff = {
  modelId: 'model-1',
  strategy: 'NEW_DATA_ONLY',
  returnTo: '/models/model-1',
}

beforeEach(() => {
  sessionStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('retrain handoff record', () => {
  it('round-trips a valid record', () => {
    rememberRetrainHandoff(VALID)
    expect(peekRetrainHandoff()).toEqual(VALID)
  })

  it('peek leaves the record in place; consume removes it', () => {
    rememberRetrainHandoff(VALID)
    expect(peekRetrainHandoff()).toEqual(VALID)
    expect(peekRetrainHandoff()).toEqual(VALID)

    expect(consumeRetrainHandoff()).toEqual(VALID)
    // The whole reason consume exists: an intent must reopen the dialog once,
    // not on every later visit to that model.
    expect(peekRetrainHandoff()).toBeNull()
  })

  it('returns null when nothing was stored', () => {
    expect(peekRetrainHandoff()).toBeNull()
    expect(consumeRetrainHandoff()).toBeNull()
  })

  it('rejects an absolute URL in returnTo — it ends up in router.push', () => {
    sessionStorage.setItem(
      'softsensor.retrain-handoff',
      JSON.stringify({ ...VALID, returnTo: 'https://evil.example.com/steal' }),
    )
    expect(peekRetrainHandoff()).toBeNull()
  })

  it('rejects a record whose shape no longer matches', () => {
    // An older build's record, or a hand-edited value. Discarded rather than
    // trusted into a route or a strategy the server would refuse.
    sessionStorage.setItem(
      'softsensor.retrain-handoff',
      JSON.stringify({ ...VALID, strategy: 'KEEP_EXISTING' }),
    )
    expect(peekRetrainHandoff()).toBeNull()

    sessionStorage.setItem(
      'softsensor.retrain-handoff',
      JSON.stringify({ ...VALID, modelId: '' }),
    )
    expect(peekRetrainHandoff()).toBeNull()
  })

  it('survives unparseable stored content', () => {
    sessionStorage.setItem('softsensor.retrain-handoff', 'not json{')
    expect(peekRetrainHandoff()).toBeNull()
  })

  it('degrades quietly when storage itself throws', () => {
    // Private browsing and blocked site data both surface this way. Losing
    // the return trip is acceptable; taking the save handler down is not.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })

    expect(() => rememberRetrainHandoff(VALID)).not.toThrow()
    expect(peekRetrainHandoff()).toBeNull()
    expect(() => clearRetrainHandoff()).not.toThrow()
  })
})

describe('retrainReturnUrl', () => {
  it('carries the strategy and the new dataset back to the model', () => {
    const url = retrainReturnUrl(VALID, 'ds-new', 'dv-new')
    expect(url).toContain('/models/model-1?')
    expect(url).toContain('retrainStrategy=NEW_DATA_ONLY')
    expect(url).toContain('retrainDatasetId=ds-new')
    expect(url).toContain('retrainVersionId=dv-new')
  })

  it('omits the version when the save did not report one', () => {
    // The dataset still preselects and the operator picks the version —
    // better than sending `versionId=null` as a literal string, which the
    // picker would then try to match against a real id.
    const url = retrainReturnUrl(VALID, 'ds-new', null)
    expect(url).toContain('retrainDatasetId=ds-new')
    expect(url).not.toContain('retrainVersionId')
  })
})
