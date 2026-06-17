/**
 * Mock PI sensor readings.
 *
 * Placeholder until Phase 6 (PI connector + `SensorReading` Prisma model) lands.
 * The shape mirrors the planned `SensorReading` row so the swap to a real
 * `services/readings.ts` is a one-file change: replace `generateReadings` calls
 * in `hooks/use-sensor-readings.ts` with `fetchClient` requests returning the
 * same `SensorReading[]`.
 *
 * Pure module — no React, no IO. All values are computed deterministically from
 * (tag, timestamp) so re-renders and range switches stay stable (no flicker).
 */

/** PI value quality, per `docs/PLAN.md` §6 (`Good | Bad | Questionable`). */
export type SensorQuality = 'Good' | 'Bad' | 'Questionable'

/** One time-series sample. Matches the planned `SensorReading` row. */
export interface SensorReading {
  piTag: string
  value: number
  status: SensorQuality
  /** ISO 8601 UTC. */
  timestamp: string
}

/** Static metadata + generation profile for one mock PI tag. */
export interface PiTagMeta {
  piTag: string
  label: string
  unit: string
  /** Maps to `--chart-{1..5}` for series color. */
  chartIndex: 1 | 2 | 3 | 4 | 5
  /** Centre value of the sine baseline. */
  baseline: number
  /** Peak deviation from baseline. */
  amplitude: number
  /** Hours per full sine cycle. */
  periodHours: number
  /** Max magnitude of additive noise. */
  noise: number
  /** Sensible decimal places for display. */
  precision: number
}

export const MOCK_PI_TAGS: PiTagMeta[] = [
  {
    piTag: 'TI-101',
    label: 'Temperature',
    unit: '°C',
    chartIndex: 1,
    baseline: 72,
    amplitude: 14,
    periodHours: 24,
    noise: 2,
    precision: 1,
  },
  {
    piTag: 'VI-202',
    label: 'Vibration',
    unit: 'mm/s',
    chartIndex: 2,
    baseline: 4.5,
    amplitude: 2.2,
    periodHours: 12,
    noise: 0.4,
    precision: 2,
  },
  {
    piTag: 'PI-303',
    label: 'Pressure',
    unit: 'bar',
    chartIndex: 3,
    baseline: 8.2,
    amplitude: 1.1,
    periodHours: 36,
    noise: 0.2,
    precision: 2,
  },
  {
    piTag: 'FI-404',
    label: 'Flow',
    unit: 'm³/h',
    chartIndex: 4,
    baseline: 120,
    amplitude: 30,
    periodHours: 8,
    noise: 5,
    precision: 0,
  },
]

export function tagMeta(piTag: string): PiTagMeta | undefined {
  return MOCK_PI_TAGS.find(t => t.piTag === piTag)
}

/** CSS custom property for a tag's series color. */
export function chartColorVar(chartIndex: PiTagMeta['chartIndex']): string {
  return `var(--color-chart-${chartIndex})`
}

export const TIME_RANGES = ['24h', '7d', '30d'] as const
export type TimeRange = (typeof TIME_RANGES)[number]

const HOUR_MS = 60 * 60 * 1000

interface RangeConfig {
  /** Number of samples across the window. */
  points: number
  /** Spacing between samples. */
  stepMs: number
  /** Short X-axis tick label for an ISO timestamp. */
  tickFormat: (iso: string) => string
}

export function rangeConfig(range: TimeRange): RangeConfig {
  switch (range) {
    case '24h':
      return {
        points: 24,
        stepMs: HOUR_MS,
        tickFormat: iso =>
          new Date(iso).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          }),
      }
    case '7d':
      return {
        points: 28,
        stepMs: 6 * HOUR_MS,
        tickFormat: iso =>
          new Date(iso).toLocaleDateString([], { weekday: 'short' }),
      }
    case '30d':
      return {
        points: 30,
        stepMs: 24 * HOUR_MS,
        tickFormat: iso =>
          new Date(iso).toLocaleDateString([], {
            day: 'numeric',
            month: 'short',
          }),
      }
  }
}

/** Deterministic hash → [0, 1). Stable for a given string. */
function hash01(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 100000) / 100000
}

function deriveStatus(seed: string): SensorQuality {
  const r = hash01(`q:${seed}`)
  // Rates tuned so the preprocessing pipeline visibly drops/repairs rows:
  // ~4% Bad, ~8% Questionable per cell.
  if (r > 0.96) return 'Bad'
  if (r > 0.88) return 'Questionable'
  return 'Good'
}

/**
 * Generate a deterministic time-series for one tag over the given range,
 * ending at `now` (defaults to current time) and going backwards.
 * Ascending by timestamp.
 */
export function generateReadings(
  piTag: string,
  range: TimeRange,
  now: number = Date.now(),
): SensorReading[] {
  const meta = tagMeta(piTag)
  if (!meta) return []

  const { points, stepMs } = rangeConfig(range)
  const phase = hash01(`p:${piTag}`) * Math.PI * 2
  const periodMs = meta.periodHours * HOUR_MS
  const factor = Math.pow(10, meta.precision)

  const readings: SensorReading[] = []
  for (let i = points - 1; i >= 0; i--) {
    const ts = now - i * stepMs
    const sine = Math.sin((ts / periodMs) * Math.PI * 2 + phase)
    const noise = (hash01(`n:${piTag}:${ts}`) - 0.5) * 2 * meta.noise
    const raw = meta.baseline + meta.amplitude * sine + noise
    const value = Math.round(raw * factor) / factor
    readings.push({
      piTag,
      value,
      status: deriveStatus(`${piTag}:${ts}`),
      timestamp: new Date(ts).toISOString(),
    })
  }
  return readings
}

/** Most recent reading (input is ascending). */
export function latestReading(
  readings: SensorReading[],
): SensorReading | undefined {
  return readings.length ? readings[readings.length - 1] : undefined
}
