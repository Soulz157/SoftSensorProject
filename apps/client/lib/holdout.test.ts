import { describe, it, expect } from 'vitest'
import {
  clipToHoldoutWindow,
  describeHoldoutSelection,
  describeTargetInWindow,
  resolveRawTargetKey,
  validationChartTags,
  HOLDOUT_LEAD_IN_DURATION,
} from './holdout'
import type { Dataset } from './preprocessing'

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

function frame(
  target: string,
  values: Array<[string, number, 'Good' | 'Bad']>,
): Dataset {
  return {
    tags: [target],
    rows: values.map(([timestamp, value, status]) => ({
      timestamp,
      cells: { [target]: { value, status } },
    })),
  }
}

const T = 's611water.lab'
const WINDOW = { from: '2022-12-01T00:00', to: '2022-12-31T23:59' }

describe('describeTargetInWindow', () => {
  it('reports one distinct value and names it for a flat window', () => {
    const raw = frame(T, [
      ['2022-11-30T23:00', 1.5, 'Good'],
      ['2022-12-01T00:00', 1.2764, 'Good'],
      ['2022-12-15T12:00', 1.2764, 'Good'],
      ['2022-12-31T23:00', 1.2764, 'Good'],
    ])
    expect(describeTargetInWindow(raw, T, WINDOW)).toEqual({
      distinct: 1,
      constantValue: 1.2764,
    })
  })

  it('counts every distinct value for a window where the lab value moves', () => {
    const raw = frame(T, [
      ['2022-12-01T00:00', 1.1, 'Good'],
      ['2022-12-02T00:00', 1.2, 'Good'],
      ['2022-12-03T00:00', 1.3, 'Good'],
    ])
    expect(describeTargetInWindow(raw, T, WINDOW)).toEqual({
      distinct: 3,
      constantValue: null,
    })
  })

  it('ignores Bad cells', () => {
    const raw = frame(T, [
      ['2022-12-01T00:00', 1.1, 'Good'],
      ['2022-12-02T00:00', 9.9, 'Bad'],
    ])
    expect(describeTargetInWindow(raw, T, WINDOW)?.distinct).toBe(1)
  })

  it('is inclusive at both window edges', () => {
    const raw = frame(T, [
      ['2022-12-01T00:00', 1, 'Good'],
      ['2022-12-31T23:59', 2, 'Good'],
    ])
    expect(describeTargetInWindow(raw, T, WINDOW)?.distinct).toBe(2)
  })

  it('returns null when the target is not in the frame', () => {
    const raw = frame('other.lab', [['2022-12-01T00:00', 1, 'Good']])
    expect(describeTargetInWindow(raw, T, WINDOW)).toBeNull()
  })

  it('returns null when the window holds no raw rows', () => {
    const raw = frame(T, [['2022-10-01T00:00', 1, 'Good']])
    expect(describeTargetInWindow(raw, T, WINDOW)).toBeNull()
  })

  it('returns null for an incomplete range', () => {
    const raw = frame(T, [['2022-12-01T00:00', 1, 'Good']])
    expect(
      describeTargetInWindow(raw, T, { from: '2022-12-01T00:00', to: '' }),
    ).toBeNull()
  })

  it('reports zero distinct when the window has rows but none are Good', () => {
    const raw = frame(T, [['2022-12-02T00:00', 1, 'Bad']])
    expect(describeTargetInWindow(raw, T, WINDOW)).toEqual({
      distinct: 0,
      constantValue: null,
    })
  })
})

describe('guard 5: flat target in the window', () => {
  const base = {
    fetchRange: { from: '2022-01-01T00:00', to: '2022-12-31T23:59' },
    holdoutRange: WINDOW,
    interval: '1h',
    targetChosen: true,
    featureBearing: true,
  }

  it('warns, never refuses, for a single-valued target', () => {
    const res = describeHoldoutSelection({
      ...base,
      targetInWindow: { distinct: 1, constantValue: 1.2764 },
    })
    expect(res.refusals).toEqual([])
    expect(res.warnings.some(w => w.includes('1.2764'))).toBe(true)
  })

  it('warns when no labelled target value is inside the window', () => {
    const res = describeHoldoutSelection({
      ...base,
      targetInWindow: { distinct: 0, constantValue: null },
    })
    expect(res.refusals).toEqual([])
    expect(res.warnings.some(w => /no labelled/i.test(w))).toBe(true)
  })

  it('is silent when the target varies', () => {
    const res = describeHoldoutSelection({
      ...base,
      targetInWindow: { distinct: 17, constantValue: null },
    })
    expect(res.warnings.some(w => /target/i.test(w))).toBe(false)
  })

  it('is silent when the count is unknown', () => {
    const withNull = describeHoldoutSelection({ ...base, targetInWindow: null })
    const without = describeHoldoutSelection(base)
    expect(withNull.warnings).toEqual(without.warnings)
  })
})

describe('clipToHoldoutWindow', () => {
  it('drops lead-in rows before the window and keeps edges', () => {
    const raw = frame(T, [
      ['2022-11-29T00:00', 1, 'Good'],
      ['2022-12-01T00:00', 2, 'Good'],
      ['2022-12-31T23:00', 3, 'Good'],
      ['2023-01-01T00:00', 4, 'Good'],
    ])
    const out = clipToHoldoutWindow(raw, '2022-12-01T00:00', '2022-12-31T23:59')
    expect(out.rows.map(r => r.timestamp)).toEqual([
      '2022-12-01T00:00',
      '2022-12-31T23:00',
    ])
    expect(out.tags).toEqual(raw.tags)
  })

  it('compares wall-clock text, so a Z-suffixed boundary does not shift by the local offset', () => {
    const raw = frame(T, [
      ['2022-12-01T00:00:00', 1, 'Good'],
      ['2022-12-31T23:00:00', 2, 'Good'],
    ])
    const out = clipToHoldoutWindow(
      raw,
      '2022-12-01T00:00:00.000Z',
      '2022-12-31T23:59:00.000Z',
    )
    expect(out.rows).toHaveLength(2)
  })

  it('clips only the start when the end is null (open-ended holdout)', () => {
    const raw = frame(T, [['2022-11-29T00:00', 1, 'Good']])
    expect(
      clipToHoldoutWindow(raw, '2022-11-30T00:00', null).rows,
    ).toHaveLength(0)
  })
})

describe('resolveRawTargetKey', () => {
  it('uses the target as-is when it is a raw column', () => {
    expect(resolveRawTargetKey(['a', T], T, {})).toBe(T)
  })

  it('maps a renamed target back to its original raw column', () => {
    expect(resolveRawTargetKey(['a', 'orig.lab'], T, { 'orig.lab': T })).toBe(
      'orig.lab',
    )
  })

  it('returns null when neither spelling is a raw column or no target is set', () => {
    expect(resolveRawTargetKey(['a'], T, {})).toBeNull()
    expect(resolveRawTargetKey(['a'], null, {})).toBeNull()
  })
})

describe('validationChartTags', () => {
  it('starts on the lab tags and offers the full list', () => {
    const r = validationChartTags(['FI1.PV', T, 'TI2.PV'])
    expect(r.initial).toEqual([T])
    expect(r.all).toHaveLength(3)
    expect(r.hasLabSubset).toBe(true)
  })

  it('falls back to the first four tags when there is no lab tag', () => {
    const r = validationChartTags(['a', 'b', 'c', 'd', 'e'])
    expect(r.initial).toEqual(['a', 'b', 'c', 'd'])
    expect(r.hasLabSubset).toBe(false)
  })
})
