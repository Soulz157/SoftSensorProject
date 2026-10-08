import { describe, it, expect } from 'vitest'
import { describeHoldoutSelection, HOLDOUT_LEAD_IN_DURATION } from './holdout'

const FETCH = { from: '2026-08-01T00:00', to: '2026-08-10T00:00' }

describe('describeHoldoutSelection', () => {
  it('is silent when no holdout is selected', () => {
    const res = describeHoldoutSelection({
      fetchRange: FETCH,
      holdoutRange: null,
      interval: '1h',
      targetChosen: false,
    })
    expect(res).toEqual({
      refusals: [],
      warnings: [],
      resolvedLeadInRows: null,
    })
  })

  it('guard 1: refuses a holdout outside the fetch window', () => {
    const res = describeHoldoutSelection({
      fetchRange: FETCH,
      holdoutRange: { from: '2026-08-09T00:00', to: '2026-08-11T00:00' },
      interval: '1h',
      targetChosen: false,
    })
    expect(res.refusals).toHaveLength(1)
    expect(res.refusals[0]).toMatch(/inside the fetch window/i)
    expect(res.resolvedLeadInRows).toBeNull()
  })

  it('guard 1: refuses a holdout with start after end', () => {
    const res = describeHoldoutSelection({
      fetchRange: FETCH,
      holdoutRange: { from: '2026-08-09T00:00', to: '2026-08-08T00:00' },
      interval: '1h',
      targetChosen: false,
    })
    expect(res.refusals).toHaveLength(1)
    expect(res.refusals[0]).toMatch(/start must be on or before/i)
  })

  it('guard 2: warns that labelled-row sufficiency cannot be checked before a target is chosen', () => {
    const res = describeHoldoutSelection({
      fetchRange: FETCH,
      // Trailing, full lead-in available — isolates guard 2 from 3/4.
      holdoutRange: { from: '2026-08-09T00:00', to: '2026-08-10T00:00' },
      interval: '1h',
      targetChosen: false,
    })
    expect(res.refusals).toEqual([])
    expect(res.warnings.some(w => /target tag isn't chosen/i.test(w))).toBe(
      true,
    )
  })

  it('guard 2: says nothing once a target has been chosen', () => {
    const res = describeHoldoutSelection({
      fetchRange: FETCH,
      holdoutRange: { from: '2026-08-09T00:00', to: '2026-08-10T00:00' },
      interval: '1h',
      targetChosen: true,
    })
    expect(res.warnings.some(w => /target tag isn't chosen/i.test(w))).toBe(
      false,
    )
  })

  it('guard 3: warns and caps resolvedLeadInRows when less than the configured lead-in is available', () => {
    // Only 1 day precedes the holdout start inside a 9-day fetch window,
    // against the 7-day default — short by design.
    const res = describeHoldoutSelection({
      fetchRange: FETCH,
      holdoutRange: { from: '2026-08-02T00:00', to: '2026-08-10T00:00' },
      interval: '1h',
      targetChosen: true,
    })
    expect(res.warnings.some(w => /lead-in is available/i.test(w))).toBe(true)
    // 1 day of 1h rows = 24, not 7*24 = 168.
    expect(res.resolvedLeadInRows).toBe(24)
  })

  it('guard 3: says nothing and reports the full row count when the configured lead-in is fully available', () => {
    const wideFetch = { from: '2026-07-01T00:00', to: '2026-08-10T00:00' }
    const res = describeHoldoutSelection({
      fetchRange: wideFetch,
      holdoutRange: { from: '2026-08-09T00:00', to: '2026-08-10T00:00' },
      interval: '1h',
      targetChosen: true,
    })
    expect(res.warnings.some(w => /lead-in is available/i.test(w))).toBe(false)
    // 7 days of 1h rows.
    expect(res.resolvedLeadInRows).toBe(
      (HOLDOUT_LEAD_IN_DURATION.value * 24) / 1,
    )
  })

  it('guard 4: warns when the holdout does not trail the fetch window', () => {
    const wideFetch = { from: '2026-07-01T00:00', to: '2026-08-10T00:00' }
    const res = describeHoldoutSelection({
      fetchRange: wideFetch,
      holdoutRange: { from: '2026-07-15T00:00', to: '2026-07-16T00:00' },
      interval: '1h',
      targetChosen: true,
    })
    expect(
      res.warnings.some(w => /not at the end of the fetch window/i.test(w)),
    ).toBe(true)
  })

  it('guard 4: says nothing when the holdout trails the fetch window', () => {
    const wideFetch = { from: '2026-07-01T00:00', to: '2026-08-10T00:00' }
    const res = describeHoldoutSelection({
      fetchRange: wideFetch,
      holdoutRange: { from: '2026-08-09T00:00', to: '2026-08-10T00:00' },
      interval: '1h',
      targetChosen: true,
    })
    expect(
      res.warnings.some(w => /not at the end of the fetch window/i.test(w)),
    ).toBe(false)
  })

  it('resolvedLeadInRows is null when the interval string cannot be parsed', () => {
    const res = describeHoldoutSelection({
      fetchRange: FETCH,
      holdoutRange: { from: '2026-08-09T00:00', to: '2026-08-10T00:00' },
      interval: 'not-an-interval',
      targetChosen: true,
    })
    expect(res.resolvedLeadInRows).toBeNull()
  })

  it('is silent (no refusal) while a draft edge is still incomplete', () => {
    const res = describeHoldoutSelection({
      fetchRange: FETCH,
      holdoutRange: { from: '', to: '2026-08-10T00:00' },
      interval: '1h',
      targetChosen: true,
    })
    expect(res).toEqual({
      refusals: [],
      warnings: [],
      resolvedLeadInRows: null,
    })
  })
})
