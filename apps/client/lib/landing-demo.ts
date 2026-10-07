import { traceValue, type TraceShape } from './signal-trace'

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
