import { describe, expect, it } from 'vitest'
import {
  DEMO_LAB_MINUTES,
  DEMO_LAB_SAMPLES_PER_DAY,
  DEMO_MODEL,
  actualOnDay,
  DEMO_NOW_MINUTE,
  DEMO_TAGS,
  clockLabel,
  dayTimeline,
  demoKpis,
  formatKpiValue,
  psiStatusOf,
  signed,
  sparkPoints,
  tagHistory,
  tagValueAt,
} from './landing-demo'

describe('landing demo data', () => {
  it('grades PSI with the app cutoffs, >= at each', () => {
    expect(psiStatusOf(0.0999)).toBe('OK')
    expect(psiStatusOf(0.1)).toBe('WARN')
    expect(psiStatusOf(0.2499)).toBe('WARN')
    expect(psiStatusOf(0.25)).toBe('CRITICAL')
  })

  it('demo shows one drifting input and the rest stable', () => {
    const statuses = DEMO_TAGS.map(t => psiStatusOf(t.psi))
    expect(statuses.filter(s => s === 'WARN')).toHaveLength(1)
    expect(statuses.filter(s => s === 'OK')).toHaveLength(3)
  })

  it('tag values are deterministic and stay within base ± amplitude', () => {
    for (const t of DEMO_TAGS) {
      expect(tagValueAt(t, 5)).toBe(tagValueAt(t, 5))
      for (let s = 0; s < 300; s++) {
        expect(Math.abs(tagValueAt(t, s) - t.shape.base)).toBeLessThanOrEqual(
          t.shape.amplitude,
        )
      }
    }
  })

  it('history ends at the current value, oldest first', () => {
    const t = DEMO_TAGS[0]!
    const h = tagHistory(t, 50, 10)
    expect(h).toHaveLength(10)
    expect(h[9]).toBe(tagValueAt(t, 50))
    expect(h[0]).toBe(tagValueAt(t, 41))
  })

  it('scales sparkline points into the box, min at the bottom', () => {
    expect(sparkPoints([1, 3, 2], 20, 10)).toBe('0.0,10.0 10.0,0.0 20.0,5.0')
    expect(sparkPoints([], 20, 10)).toBe('')
    expect(sparkPoints([4, 4], 10, 6)).toBe('0.0,6.0 10.0,6.0')
  })

  it('always shows the sign', () => {
    expect(signed(0.24)).toBe('+0.2')
    expect(signed(-0.31)).toBe('-0.3')
  })
})

describe('landing KPI tiles', () => {
  it('has four tiles with unique ids, only the first live', () => {
    const kpis = demoKpis()
    expect(kpis).toHaveLength(4)
    expect(new Set(kpis.map(k => k.id)).size).toBe(4)
    expect(kpis.map(k => !!k.live)).toEqual([true, false, false, false])
  })

  it('a prediction an hour against a lab sample every 6 hours', () => {
    const [perDay] = demoKpis()
    expect(perDay?.value).toBe(24)
    expect(perDay?.note).toBe('Lab: every 6 h (4 a day)')
  })

  it('lab samples are evenly 6 hours apart, a whole day between them', () => {
    const gaps = DEMO_LAB_MINUTES.map(
      (m, i) =>
        ((DEMO_LAB_MINUTES[(i + 1) % DEMO_LAB_MINUTES.length] ?? 0) -
          m +
          1440) %
        1440,
    )
    expect(gaps).toEqual([360, 360, 360, 360])
  })

  it('every lab sample sits on the actual line', () => {
    for (const l of dayTimeline(DEMO_NOW_MINUTE).lab) {
      expect(actualOnDay(l.minute)).toBeCloseTo(l.actual, 10)
    }
  })

  it('timeline holds 24 hourly predictions', () => {
    expect(dayTimeline(DEMO_NOW_MINUTE).hourly).toHaveLength(24)
    expect(dayTimeline(17 * 60).hourly).toHaveLength(24)
  })

  it('takes fit, error and drift from the demo data, never its own numbers', () => {
    const byId = new Map(demoKpis().map(k => [k.id, k.value]))
    expect(byId.get('r2')).toBe(DEMO_MODEL.r2)
    expect(byId.get('rmse')).toBe(DEMO_MODEL.rmse)
    expect(byId.get('drift')).toBe(
      DEMO_TAGS.filter(t => psiStatusOf(t.psi) !== 'OK').length,
    )
  })

  it.each([0, 300, 420, 421, 1000, 1439, 2000])(
    'timeline ending at minute %i holds exactly the day’s lab samples',
    now => {
      const t = dayTimeline(now)
      expect(t.end - t.start).toBe(24 * 60)
      expect(t.lab).toHaveLength(DEMO_LAB_SAMPLES_PER_DAY)
      for (const l of t.lab) {
        expect(l.minute).toBeGreaterThan(t.start)
        expect(l.minute).toBeLessThanOrEqual(t.end)
      }
      expect(t.points.at(-1)?.minute).toBe(now)
    },
  )

  it('lab errors on the timeline match the demo RMSE', () => {
    const { lab } = dayTimeline(DEMO_NOW_MINUTE)
    const rmse = Math.sqrt(
      lab.reduce((s, l) => s + (l.actual - l.predicted) ** 2, 0) / lab.length,
    )
    expect(rmse).toBeCloseTo(DEMO_MODEL.rmse, 2)
  })

  it('labels clock minutes, wrapping either way past midnight', () => {
    expect(clockLabel(7 * 60)).toBe('07:00')
    expect(clockLabel(16 * 60 + 20)).toBe('16:20')
    expect(clockLabel(-60)).toBe('23:00')
    expect(clockLabel(24 * 60 + 5)).toBe('00:05')
  })

  it('formats with fixed digits and thousands separators', () => {
    expect(formatKpiValue(1440, 0)).toBe('1,440')
    expect(formatKpiValue(0.94, 2)).toBe('0.94')
    expect(formatKpiValue(0.4, 2)).toBe('0.40')
  })
})
