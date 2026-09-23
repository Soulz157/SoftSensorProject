import { describe, it, expect } from 'vitest'
import { rangeError } from '../use-retrain-fetch-dataset'

/**
 * MODEL-SERVE-017. `rangeError` is the client half of the server's own
 * leakage guard (`assertCompatible`): new data must begin strictly after the
 * incumbent's split boundary, because rows at or before it are the frozen
 * evaluation set the candidate will be scored on.
 *
 * Checking it here is not cosmetic. The server refuses the same window, but
 * only after a full archive read — so a missing client check costs the
 * operator a slow fetch before telling them the window was never allowed.
 */
describe('rangeError', () => {
  // The format the boundary is actually stored in: `str()` of a pandas
  // Timestamp (`splits.py`), naive and space-separated. Deliberately NOT a
  // Z-suffixed UTC string — `new Date` reads this as local, which is what
  // makes the comparison against a local `datetime-local` value correct.
  const CUT = '2026-01-16 00:00:00'

  it('accepts a window that starts after the cut', () => {
    expect(rangeError('2026-02-01T00:00', '2026-03-01T00:00', CUT)).toBeNull()
  })

  it('refuses a start before the cut, and names the boundary', () => {
    const err = rangeError('2026-01-01T00:00', '2026-03-01T00:00', CUT)
    expect(err).toContain(CUT)
    expect(err).toMatch(/must start after/i)
  })

  it('refuses a start exactly AT the cut — the rule is strictly after', () => {
    // The boundary row itself belongs to the frozen evaluation set. An
    // inclusive comparison here would pass a window the server then refuses.
    expect(rangeError('2026-01-16T00:00', '2026-03-01T00:00', CUT)).toMatch(
      /must start after/i,
    )
  })

  it('refuses an end at or before the start', () => {
    expect(rangeError('2026-03-01T00:00', '2026-02-01T00:00', CUT)).toMatch(
      /end must be after/i,
    )
    expect(rangeError('2026-03-01T00:00', '2026-03-01T00:00', CUT)).toMatch(
      /end must be after/i,
    )
  })

  it('asks for both halves before validating anything else', () => {
    expect(rangeError('', '2026-03-01T00:00', CUT)).toMatch(/both/i)
    expect(rangeError('2026-03-01T00:00', '', CUT)).toMatch(/both/i)
  })

  it('still checks ordering when no cut boundary is known', () => {
    // A null cut means the incumbent's run recorded no boundary — the same
    // case the server 422s on. The window rules that do not depend on it
    // must still apply rather than everything silently passing.
    expect(rangeError('2026-02-01T00:00', '2026-03-01T00:00', null)).toBeNull()
    expect(rangeError('2026-03-01T00:00', '2026-02-01T00:00', null)).toMatch(
      /end must be after/i,
    )
  })

  it('reports an unparseable date instead of treating it as valid', () => {
    expect(rangeError('not-a-date', '2026-03-01T00:00', CUT)).toMatch(
      /not a valid date range/i,
    )
  })
})
