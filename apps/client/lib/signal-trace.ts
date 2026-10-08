/**
 * Pure maths behind the auth pages' signal trace: a smooth, deterministic
 * "soft-sensor prediction" over a continuous position `p` (in samples), lab
 * samples at fixed intervals. No DOM here, so the component only scrolls `p`
 * and draws.
 */

/** Integer hash -> [0, 1). Deterministic per (seed, i). */
function hash01(seed: number, i: number): number {
  let h = (seed ^ Math.imul(i, 0x9e3779b1)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Smooth value noise in [-1, 1], continuous in p. */
function valueNoise(seed: number, p: number): number {
  const i = Math.floor(p)
  const f = p - i
  const t = f * f * (3 - 2 * f)
  const a = hash01(seed, i) * 2 - 1
  const b = hash01(seed, i + 1) * 2 - 1
  return a + (b - a) * t
}

export interface TraceShape {
  seed: number
  /** Centre of the signal, in engineering units. */
  base: number
  /** Peak deviation from `base`, in engineering units. */
  amplitude: number
}

export const DEFAULT_TRACE: TraceShape = { seed: 7, base: 42.6, amplitude: 1.6 }

/** The predicted value at position p — two slow waves plus gentle noise,
 *  normalised so it stays within base ± amplitude. */
export function traceValue(
  p: number,
  shape: TraceShape = DEFAULT_TRACE,
): number {
  // Slow process drift plus a little smooth noise — a model output, not raw
  // sensor jitter, so no high-frequency term.
  const wave =
    0.55 * Math.sin(p * 0.028 + shape.seed) +
    0.28 * Math.sin(p * 0.071 + shape.seed * 1.7)
  const noise = 0.17 * valueNoise(shape.seed, p * 0.09)
  return shape.base + shape.amplitude * (wave + noise)
}

/** Lab samples land every `every` positions; `actual` sits a little off the
 *  prediction, the way a real lab result does. */
export function labSamplesBetween(
  from: number,
  to: number,
  every: number,
  shape: TraceShape = DEFAULT_TRACE,
): { p: number; actual: number }[] {
  const out: { p: number; actual: number }[] = []
  for (let k = Math.ceil(from / every); k * every <= to; k++) {
    const p = k * every
    out.push({ p, actual: traceValue(p, shape) + labOffset(k, shape) })
  }
  return out
}

/** Lab minus predicted for the k-th lab sample. */
function labOffset(k: number, shape: TraceShape): number {
  return (hash01(shape.seed + 99, k) * 2 - 1) * 0.15 * shape.amplitude
}

/**
 * The actual (process) value at position p, for drawing an Actual line: the
 * prediction plus an error that eases from one lab sample's error to the
 * next, so every sample from `labSamplesBetween` sits exactly on it.
 */
export function actualValue(
  p: number,
  every: number,
  shape: TraceShape = DEFAULT_TRACE,
): number {
  const u = p / every
  const k = Math.floor(u)
  const a = labOffset(k, shape)
  const b = labOffset(k + 1, shape)
  const ease = (1 - Math.cos(Math.PI * (u - k))) / 2
  return traceValue(p, shape) + a + (b - a) * ease
}

/**
 * Vertical pull toward the pointer at screen x, for the background line.
 * Gaussian in horizontal distance, fades to 0 when the pointer is more than
 * `radius` px away vertically, and never moves the line more than `maxPull`.
 */
export function pointerPull(
  x: number,
  y: number,
  pointer: { x: number; y: number } | null,
  radius = 160,
  maxPull = 18,
): number {
  if (!pointer) return 0
  const dy = pointer.y - y
  const vertical = Math.abs(dy)
  if (vertical > radius) return 0
  const sigma = radius / 2
  const dx = pointer.x - x
  const weight =
    Math.exp(-(dx * dx) / (2 * sigma * sigma)) * (1 - vertical / radius)
  return Math.max(-maxPull, Math.min(maxPull, dy * 0.35 * weight))
}

/** Map a value to a y pixel in a box of height h with padding. */
export function valueToY(
  value: number,
  h: number,
  shape: TraceShape = DEFAULT_TRACE,
  pad = 0.15,
): number {
  const lo = shape.base - shape.amplitude * 1.1
  const hi = shape.base + shape.amplitude * 1.1
  const t = (value - lo) / (hi - lo)
  return h - (pad * h + t * (1 - 2 * pad) * h)
}

/** Polyline path from points. */
export function toPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return ''
  return points
    .map(
      (pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`,
    )
    .join(' ')
}
