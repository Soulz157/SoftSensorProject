/**
 * Isometric geometry for the Overview plant tower. Pure module: no React.
 *
 * ground coords: gx → ลงขวา, gy → ลงซ้าย, z → ขึ้น (px)
 * screen dx = (gx-gy)*UX, dy = (gx+gy)*UY - z
 * UY = UX * squash — squash คืออัตราส่วน สูง/กว้าง ของ diamond
 * ต้องเท่ากับของ workspace floor ไม่งั้นขอบจะไม่ขนานกัน
 */

export const U = 6
export const GRID = 5.5
export const SLAB = 5
export const ISO = Math.SQRT2
export const HZ = 30
export const CORNER = 1.0
export const DEFAULT_SQUASH = 0.5

/** A ground point: gx, gy, and height z in px. */
export type Pt3 = [number, number, number]

export interface IsoProjection {
  SQ: number
  UX: number
  UY: number
  X: (gx: number, gy: number) => number
  Y: (gx: number, gy: number, z?: number) => number
  /** `"x,y"`, for polygon `points`. */
  P: (gx: number, gy: number, z?: number) => string
  proj: (p: Pt3) => [number, number]
}

export function makeProjection(
  cx: number,
  cy: number,
  squash: number,
): IsoProjection {
  const SQ = squash
  const UX = U
  const UY = U * SQ
  const X = (gx: number, gy: number) => cx + (gx - gy) * UX
  const Y = (gx: number, gy: number, z = 0) => cy + (gx + gy) * UY - z
  const P = (gx: number, gy: number, z = 0) => `${X(gx, gy)},${Y(gx, gy, z)}`
  const proj = (p: Pt3): [number, number] => [
    X(p[0], p[1]),
    Y(p[0], p[1], p[2]),
  ]
  return { SQ, UX, UY, X, Y, P, proj }
}

/** nodeCount → height scale (footprint คงที่) */
export function towerHeightScale(equipmentCount: number): number {
  return Math.max(0.82, Math.min(0.82 + equipmentCount * 0.022, 1.3))
}

/** ท่อ: round ทุกข้องอใน screen space. `q` is already projected. */
export function roundedPath(q: [number, number][], rad: number): string {
  if (q.length < 2) return ''
  let d = `M ${q[0]![0]} ${q[0]![1]}`
  for (let i = 1; i < q.length - 1; i++) {
    const p = q[i]!,
      a = q[i - 1]!,
      b = q[i + 1]!
    const d1 = Math.hypot(a[0] - p[0], a[1] - p[1]) || 1
    const d2 = Math.hypot(b[0] - p[0], b[1] - p[1]) || 1
    const l1 = Math.min(rad, d1 / 2)
    const l2 = Math.min(rad, d2 / 2)
    d += ` L ${p[0] + ((a[0] - p[0]) / d1) * l1} ${p[1] + ((a[1] - p[1]) / d1) * l1}`
    d += ` Q ${p[0]} ${p[1]} ${p[0] + ((b[0] - p[0]) / d2) * l2} ${p[1] + ((b[1] - p[1]) / d2) * l2}`
  }
  const last = q[q.length - 1]!
  return `${d} L ${last[0]} ${last[1]}`
}

/**
 * The base plate's outline in ground coords: a GRID square whose corners are
 * cut by CORNER, three points per corner, starting at the (-GRID,-GRID) corner.
 */
export function plateOutline(): [number, number][] {
  const corners: [number, number][] = [
    [-GRID, -GRID],
    [GRID, -GRID],
    [GRID, GRID],
    [-GRID, GRID],
  ]
  const outline: [number, number][] = []
  for (let i = 0; i < 4; i++) {
    const c = corners[i]!
    const p = corners[(i + 3) % 4]!
    const q = corners[(i + 1) % 4]!
    const u1 = [Math.sign(p[0] - c[0]), Math.sign(p[1] - c[1])]
    const u2 = [Math.sign(q[0] - c[0]), Math.sign(q[1] - c[1])]
    outline.push([c[0] + u1[0]! * CORNER, c[1] + u1[1]! * CORNER])
    outline.push([
      c[0] + (u1[0]! + u2[0]!) * CORNER * 0.42,
      c[1] + (u1[1]! + u2[1]!) * CORNER * 0.42,
    ])
    outline.push([c[0] + u2[0]! * CORNER, c[1] + u2[1]! * CORNER])
  }
  return outline
}
