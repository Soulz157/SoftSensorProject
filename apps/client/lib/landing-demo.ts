import { DEFAULT_TRACE, traceValue, type TraceShape } from './signal-trace'

/**
 * Illustrative numbers for the signed-out landing page. NOTHING here is real
 * plant or model data — it only shows what SoftSensor does: input tags feed a
 * trained model that predicts a lab value, scored against lab samples.
 */
export interface DemoModel {
  target: string
  unit: string
  algorithm: string
  version: string
  r2: number
  rmse: number
}

export const DEMO_MODEL: DemoModel = {
  target: 'RVP-DEMO',
  unit: 'kPa',
  algorithm: 'XGBoost',
  version: 'v4',
  r2: 0.94,
  rmse: 0.31,
}

export interface DemoTag {
  name: string
  description: string
  unit: string
  digits: number
  /** Input drift for this tag: PSI of live vs training distribution. */
  psi: number
  shape: TraceShape
}

/** The app's default PSI cutoffs (backend PSI_WARN / PSI_CRITICAL). */
export const DEMO_PSI_WARN = 0.1
export const DEMO_PSI_CRITICAL = 0.25

/** Same grading as the backend's `statusFor`: `>=` at each cutoff. */
export function psiStatusOf(psi: number): 'OK' | 'WARN' | 'CRITICAL' {
  if (psi >= DEMO_PSI_CRITICAL) return 'CRITICAL'
  if (psi >= DEMO_PSI_WARN) return 'WARN'
  return 'OK'
}

export const DEMO_TAGS: readonly DemoTag[] = [
  {
    name: 'TEMP-01',
    description: 'Column top temperature',
    unit: '°C',
    digits: 1,
    psi: 0.04,
    shape: { seed: 23, base: 86.1, amplitude: 1.4 },
  },
  {
    name: 'FLOW-02',
    description: 'Feed flow',
    unit: 'm³/h',
    digits: 1,
    psi: 0.18,
    shape: { seed: 11, base: 128.4, amplitude: 3.2 },
  },
  {
    name: 'PRESS-03',
    description: 'Column pressure',
    unit: 'bar',
    digits: 2,
    psi: 0.07,
    shape: { seed: 41, base: 7.84, amplitude: 0.22 },
  },
  {
    name: 'RATIO-04',
    description: 'Reflux ratio',
    unit: '',
    digits: 2,
    psi: 0.02,
    shape: { seed: 37, base: 3.92, amplitude: 0.18 },
  },
]

/** A tag's value at a 1-second tick. Same smooth maths as the trace. */
export function tagValueAt(tag: DemoTag, step: number): number {
  return traceValue(400 + step * 1.2, tag.shape)
}

/** The last `n` values up to `step`, oldest first — for a sparkline. */
export function tagHistory(tag: DemoTag, step: number, n = 24): number[] {
  return Array.from({ length: n }, (_, i) =>
    tagValueAt(tag, step - (n - 1 - i)),
  )
}

/** Sparkline points scaled into a w×h box (min at the bottom). */
export function sparkPoints(values: number[], w: number, h: number): string {
  if (values.length === 0) return ''
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const span = hi - lo || 1
  const step = values.length > 1 ? w / (values.length - 1) : 0
  return values
    .map(
      (v, i) =>
        `${(i * step).toFixed(1)},${(h - ((v - lo) / span) * h).toFixed(1)}`,
    )
    .join(' ')
}

/** "+0.2" / "-0.3" — the sign always shown, so an error reads as a direction. */
export function signed(n: number, digits = 1): string {
  const s = n.toFixed(digits)
  return n >= 0 ? `+${s}` : s
}

/** The prediction at a 1-second tick: the same line the hero draws. */
export function predictionAt(step: number): number {
  return traceValue(400 + step * 1.2, DEFAULT_TRACE)
}

/** The last `n` predictions up to `step`, oldest first — for a sparkline. */
export function predictionHistory(step: number, n = 24): number[] {
  return Array.from({ length: n }, (_, i) => predictionAt(step - (n - 1 - i)))
}

const DAY_MINUTES = 24 * 60
const LAB_EVERY_MINUTES = 6 * 60

/** Clock time (minutes after midnight) the demo lab samples: every 6 hours. */
export const DEMO_LAB_MINUTES = [2 * 60, 8 * 60, 14 * 60, 20 * 60] as const
/** Lab minus predicted at each sample time. RMSE ≈ DEMO_MODEL.rmse (0.31). */
const DEMO_LAB_ERRORS = [0.28, -0.34, 0.3, -0.32] as const

/** How often the lab samples, in hours. */
export const DEMO_LAB_EVERY_HOURS = LAB_EVERY_MINUTES / 60
export const DEMO_LAB_SAMPLES_PER_DAY = DEMO_LAB_MINUTES.length
/** One prediction an hour. */
export const DEMO_PREDICTIONS_PER_DAY = 24

/** Demo clock at tick 0 (16:20); `live` motion adds a minute a tick. */
export const DEMO_NOW_MINUTE = 16 * 60 + 20

/** The predicted value at a clock minute, on the 24-hour timeline's scale. */
export function predictionOnDay(minute: number): number {
  return traceValue(400 + minute * 0.14, DEFAULT_TRACE)
}

/**
 * The illustrative actual (process) value: the prediction plus an error that
 * eases from one lab sample's error to the next, so every lab sample sits
 * exactly on this line.
 */
export function actualOnDay(minute: number): number {
  const n = DEMO_LAB_ERRORS.length
  const sinceFirst =
    (((minute - DEMO_LAB_MINUTES[0]) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES
  const u = sinceFirst / LAB_EVERY_MINUTES
  const i = Math.floor(u)
  const a = DEMO_LAB_ERRORS[i % n] ?? 0
  const b = DEMO_LAB_ERRORS[(i + 1) % n] ?? 0
  const ease = (1 - Math.cos(Math.PI * (u - i))) / 2
  return predictionOnDay(minute) + a + (b - a) * ease
}

export interface DayTimeline {
  /** Window is (start, end], 24 hours ending at `end` (now). */
  start: number
  end: number
  /** Both lines, sampled finely for drawing. */
  points: { minute: number; predicted: number; actual: number }[]
  /** The hourly predictions themselves: DEMO_PREDICTIONS_PER_DAY of them. */
  hourly: { minute: number; predicted: number }[]
  lab: { minute: number; predicted: number; actual: number }[]
  min: number
  max: number
}

/**
 * The last 24 hours up to `now`: actual and predicted lines (sampled every
 * `every` minutes for drawing), the hourly predictions, and the lab samples
 * in that window — always DEMO_LAB_SAMPLES_PER_DAY of them, since the window
 * is exactly one day.
 */
export function dayTimeline(now: number, every = 5): DayTimeline {
  const start = now - DAY_MINUTES
  const at = (minute: number) => ({
    minute,
    predicted: predictionOnDay(minute),
    actual: actualOnDay(minute),
  })
  const points: DayTimeline['points'] = []
  for (let m = start; m < now; m += every) points.push(at(m))
  points.push(at(now))

  const hourly: DayTimeline['hourly'] = []
  for (let m = Math.floor(start / 60) * 60 + 60; m <= now; m += 60) {
    hourly.push({ minute: m, predicted: predictionOnDay(m) })
  }

  const lab: DayTimeline['lab'] = []
  const firstDay = Math.floor(start / DAY_MINUTES)
  for (let day = firstDay; day <= firstDay + 1; day++) {
    for (const clock of DEMO_LAB_MINUTES) {
      const minute = day * DAY_MINUTES + clock
      if (minute > start && minute <= now) lab.push(at(minute))
    }
  }
  lab.sort((a, b) => a.minute - b.minute)

  const values = points.flatMap(p => [p.predicted, p.actual])
  return {
    start,
    end: now,
    points,
    hourly,
    lab,
    min: Math.min(...values),
    max: Math.max(...values),
  }
}

/** "07:00" for any minute count, wrapping past midnight either way. */
export function clockLabel(minute: number): string {
  const m = ((Math.round(minute) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export interface DemoKpi {
  id: string
  label: string
  value: number
  digits: number
  unit?: string
  note: string
  /** Shows the live prediction (value + sparkline) under the note. */
  live?: boolean
}

/** "1,440" / "0.94": fixed digits, thousands separated. */
export function formatKpiValue(value: number, digits: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

/** The four KPI tiles below the hero: sensor vs lab, from the demo data. */
export function demoKpis(): DemoKpi[] {
  const m = DEMO_MODEL
  return [
    {
      id: 'per-day',
      label: 'Predictions a day',
      value: DEMO_PREDICTIONS_PER_DAY,
      digits: 0,
      note: `Lab: every ${DEMO_LAB_EVERY_HOURS} h (${DEMO_LAB_SAMPLES_PER_DAY} a day)`,
      live: true,
    },
    {
      id: 'r2',
      label: 'Fit (R²)',
      value: m.r2,
      digits: 2,
      note: 'On held-out lab samples',
    },
    {
      id: 'rmse',
      label: 'Typical error (RMSE)',
      value: m.rmse,
      digits: 2,
      unit: m.unit,
      note: `Against lab ${m.target}`,
    },
    {
      id: 'drift',
      label: 'Input drift',
      value: DEMO_TAGS.filter(t => t.psi >= DEMO_PSI_WARN).length,
      digits: 0,
      unit: `of ${DEMO_TAGS.length} tags`,
      note: `At PSI ≥ ${DEMO_PSI_WARN.toFixed(2)}`,
    },
  ]
}
