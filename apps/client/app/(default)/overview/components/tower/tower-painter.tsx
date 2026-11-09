import type { ReactNode } from 'react'
import { ISO, roundedPath, type IsoProjection, type Pt3 } from '@/lib/iso-tower'
import { type NodeStatus } from '@/store/status-colors'
import type { Skin } from './tower-skin'

/** Base stroke width every primitive scales from. */
export const LW = 0.9

export interface TowerPainterContext {
  iso: IsoProjection
  sk: Skin
  /** Level of detail: false drops ladders, ribs and fine rings. */
  lod: boolean
  status: NodeStatus
  statusColor: string
}

/**
 * The tower's drawing primitives. Every element gets its key from ONE counter
 * (`key()`), so keys are deterministic in draw order — call the primitives in
 * the order they should paint (SVG z-order is document order).
 */
export function createTowerPainter({
  iso,
  sk,
  lod,
  status,
  statusColor,
}: TowerPainterContext) {
  const { X, Y, P, proj, UX, SQ } = iso
  const isOffline = status === 'offline'

  /* keys: deterministic ตามลำดับการวาด */
  let uid = 0
  const key = () => `n${uid++}`

  const line = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    w = LW * 0.6,
    op = 0.7,
  ) => (
    <line
      key={key()}
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      stroke={sk.line}
      strokeWidth={w}
      opacity={op}
      strokeLinecap="round"
    />
  )

  /** ellipse บนระนาบพื้น — ry มาจาก rx * SQ เสมอ */
  const ell = (
    x: number,
    y: number,
    rx: number,
    ry: number,
    w = LW * 0.7,
    op = 0.8,
    fill = 'none',
  ) => (
    <ellipse
      key={key()}
      cx={x}
      cy={y}
      rx={rx}
      ry={ry}
      fill={fill}
      stroke={sk.line}
      strokeWidth={w}
      opacity={op}
    />
  )

  const pipe = (pts: Pt3[], w: number, rad = 5) => {
    const d = roundedPath(pts.map(proj), rad)
    return (
      <g key={key()}>
        <path
          d={d}
          fill="none"
          stroke={sk.dim}
          strokeWidth={w + 1.7}
          strokeLinecap="round"
        />
        <path
          d={d}
          fill="none"
          stroke={sk.line}
          strokeWidth={w}
          strokeLinecap="round"
        />
      </g>
    )
  }

  const flange = (p: Pt3, r: number) => {
    const [x, y] = proj(p)
    return ell(x, y, r, r * SQ * 1.1, LW * 0.8, 0.9)
  }

  const valve = (p: Pt3, r: number) => {
    const [x, y] = proj(p)
    return (
      <g key={key()}>
        <ellipse
          cx={x}
          cy={y}
          rx={r}
          ry={r * SQ * 1.2}
          fill="none"
          stroke={sk.line}
          strokeWidth={LW * 0.7}
          opacity={0.95}
        />
        <line
          x1={x - r}
          y1={y}
          x2={x + r}
          y2={y}
          stroke={sk.line}
          strokeWidth={LW * 0.6}
          opacity={0.9}
          strokeLinecap="round"
        />
      </g>
    )
  }

  const colm = (gx: number, gy: number, z: number, w = LW * 0.8) =>
    line(X(gx, gy), Y(gx, gy), X(gx, gy), Y(gx, gy, z), w, 0.75)

  /** กรวย/ทรงกระบอกตัด: r0 ที่ z0 → r1 ที่ z1 */
  const frustum = (
    bx: number,
    by: number,
    z0: number,
    r0: number,
    z1: number,
    r1: number,
    fill: string,
  ) => (
    <path
      key={key()}
      fill={fill}
      stroke={sk.line}
      strokeWidth={LW}
      strokeLinejoin="round"
      d={
        `M ${bx - r0} ${by - z0} A ${r0} ${r0 * SQ} 0 0 0 ${bx + r0} ${by - z0}` +
        ` L ${bx + r1} ${by - z1} A ${r1} ${r1 * SQ} 0 0 1 ${bx - r1} ${by - z1} Z`
      }
    />
  )

  const ladder = (
    bx: number,
    by: number,
    z0: number,
    z1: number,
    offX: number,
  ) => {
    const rungs: ReactNode[] = []
    for (let z = z0 + 3; z < z1; z += 4.5) {
      rungs.push(
        line(bx + offX - 1.6, by - z, bx + offX + 1.6, by - z, LW * 0.4, 0.45),
      )
    }
    return (
      <g key={key()}>
        {line(
          bx + offX - 1.6,
          by - z0,
          bx + offX - 1.6,
          by - z1,
          LW * 0.5,
          0.6,
        )}
        {line(
          bx + offX + 1.6,
          by - z0,
          bx + offX + 1.6,
          by - z1,
          LW * 0.5,
          0.6,
        )}
        {rungs}
      </g>
    )
  }

  /* ── ปล่อง ── */
  const stack = (
    gx: number,
    gy: number,
    rb: number,
    rt: number,
    h: number,
    tip: boolean,
  ) => {
    const bx = X(gx, gy)
    const by = Y(gx, gy)
    const R = (z: number) => (rb + (rt - rb) * (z / h)) * UX * ISO
    const g: ReactNode[] = []

    g.push(
      frustum(
        bx,
        by,
        0,
        rb * 1.75 * UX * ISO,
        h * 0.05,
        rb * 1.4 * UX * ISO,
        sk.f2,
      ),
    )
    g.push(
      frustum(
        bx,
        by,
        h * 0.05,
        rb * 1.4 * UX * ISO,
        h * 0.14,
        rb * 1.05 * UX * ISO,
        sk.f1,
      ),
    )
    g.push(frustum(bx, by, h * 0.14, R(h * 0.14), h, R(h), sk.f1))
    g.push(
      ell(
        bx,
        by - h * 0.05,
        rb * 1.4 * UX * ISO,
        rb * 1.4 * UX * ISO * SQ,
        LW * 0.7,
        0.6,
      ),
    )
    g.push(
      ell(
        bx,
        by - h * 0.14,
        rb * 1.05 * UX * ISO,
        rb * 1.05 * UX * ISO * SQ,
        LW * 0.7,
        0.7,
      ),
    )

    const nb = lod ? 7 : 3
    for (let i = 1; i < nb; i++) {
      const z = h * 0.14 + (h - h * 0.14) * (i / nb)
      g.push(ell(bx, by - z, R(z), R(z) * SQ, LW * 0.5, 0.5))
    }
    if (lod) {
      for (let i = 0; i < 6; i++) {
        const a = -0.9 + i * 0.36
        g.push(
          <path
            key={key()}
            fill="none"
            stroke={sk.line}
            strokeWidth={LW * 0.35}
            opacity={0.32}
            d={`M ${bx + R(h * 0.14) * a} ${by - h * 0.14} L ${bx + R(h) * a} ${by - h}`}
          />,
        )
      }
    }
    g.push(ell(bx, by - h, R(h) * 1.25, R(h) * 1.25 * SQ, LW, 0.9, sk.f0))
    g.push(
      ell(bx, by - h - 3, R(h) * 1.05, R(h) * 1.05 * SQ, LW * 0.8, 0.8, sk.f0),
    )
    if (lod) g.push(ladder(bx, by, h * 0.14, h - 4, -R(h) * 1.5))
    if (tip && !isOffline) {
      g.push(
        <circle
          key={key()}
          cx={bx}
          cy={by - h - 6}
          r={1.9}
          fill={statusColor}
          opacity={status === 'alarm' ? 0.95 : 0.75}
        />,
      )
    }
    return <g key={key()}>{g}</g>
  }

  /* ── ถังตั้ง / column ── */
  const vessel = (
    gx: number,
    gy: number,
    r: number,
    h: number,
    head: 'dome' | 'cone' | 'flat',
  ) => {
    const bx = X(gx, gy)
    const by = Y(gx, gy)
    const rx = r * UX * ISO
    const ry = rx * SQ
    const g: ReactNode[] = [frustum(bx, by, 0, rx, h, rx, sk.f1)]

    const nb = lod ? 4 : 2
    for (let i = 1; i < nb; i++)
      g.push(ell(bx, by - h * (i / nb), rx, ry, LW * 0.5, 0.45))

    if (head === 'dome') {
      g.push(
        <path
          key={key()}
          fill={sk.f0}
          stroke={sk.line}
          strokeWidth={LW}
          d={`M ${bx - rx} ${by - h} Q ${bx} ${by - h - rx * 1.15} ${bx + rx} ${by - h} Z`}
        />,
      )
      g.push(ell(bx, by - h, rx, ry, LW * 0.8, 0.85))
      if (lod) {
        g.push(
          line(bx, by - h - rx * 0.85, bx, by - h - rx * 1.5, LW * 0.7, 0.8),
        )
        g.push(ell(bx, by - h - rx * 1.5, 2.2, 2.2 * SQ, LW * 0.6, 0.8))
      }
    } else if (head === 'cone') {
      g.push(
        <path
          key={key()}
          fill={sk.f0}
          stroke={sk.line}
          strokeWidth={LW}
          d={`M ${bx - rx} ${by - h} L ${bx} ${by - h - rx * 0.95} L ${bx + rx} ${by - h} Z`}
        />,
      )
      g.push(ell(bx, by - h, rx, ry, LW * 0.8, 0.85))
    } else {
      g.push(ell(bx, by - h, rx * 1.12, ry * 1.12, LW, 0.9, sk.f0))
    }

    if (lod) {
      g.push(ell(bx, by - h * 0.55, rx * 1.45, rx * 1.45 * SQ, LW * 0.5, 0.55))
      g.push(ladder(bx, by, 2, h - 2, -rx * 1.35))
    }
    return <g key={key()}>{g}</g>
  }

  /* ── ถังทรงกลม (silhouette เป็นวงกลมจริง ไม่ถูกบีบ) ── */
  const sphereTank = (gx: number, gy: number, r: number) => {
    const bx = X(gx, gy)
    const by = Y(gx, gy)
    const R = r * UX * ISO
    const legH = R * 0.6
    const ccy = by - legH - R
    const g: ReactNode[] = []

    for (let i = 0; i < 4; i++) {
      const f = -0.8 + i * 0.53
      g.push(
        line(
          bx + R * f * 0.9,
          by - 1,
          bx + R * f * 0.62,
          ccy + R * 0.62,
          LW * 0.7,
          0.7,
        ),
      )
    }
    g.push(
      <circle
        key={key()}
        cx={bx}
        cy={ccy}
        r={R}
        fill={sk.f1}
        stroke={sk.line}
        strokeWidth={LW}
      />,
    )
    if (lod) {
      ;[0.34, 0.68].forEach(k => g.push(ell(bx, ccy, R * k, R, LW * 0.4, 0.4)))
      g.push(line(bx, ccy - R, bx, ccy + R, LW * 0.4, 0.4))
      ;[-0.62, -0.22, 0.22, 0.62].forEach(f => {
        const rr = R * Math.sqrt(1 - f * f)
        g.push(ell(bx, ccy + R * f, rr, rr * SQ * 0.68, LW * 0.4, 0.4))
      })
    }
    g.push(ell(bx, ccy, R, R * SQ * 0.8, LW * 0.55, 0.6))
    g.push(ell(bx, by - 1, R * 0.95, R * 0.95 * SQ, LW * 0.5, 0.45))
    return <g key={key()}>{g}</g>
  }

  /* ── กล่อง ── */
  const box = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    z0: number,
    h: number,
  ) => (
    <g key={key()}>
      <polygon
        points={[
          P(x0, y1, z0 + h),
          P(x1, y1, z0 + h),
          P(x1, y1, z0),
          P(x0, y1, z0),
        ].join(' ')}
        fill={sk.f1}
        stroke={sk.line}
        strokeWidth={LW}
        strokeLinejoin="round"
      />
      <polygon
        points={[
          P(x1, y0, z0 + h),
          P(x1, y1, z0 + h),
          P(x1, y1, z0),
          P(x1, y0, z0),
        ].join(' ')}
        fill={sk.f2}
        stroke={sk.line}
        strokeWidth={LW}
        strokeLinejoin="round"
      />
      <polygon
        points={[
          P(x0, y0, z0 + h),
          P(x1, y0, z0 + h),
          P(x1, y1, z0 + h),
          P(x0, y1, z0 + h),
        ].join(' ')}
        fill={sk.f0}
        stroke={sk.line}
        strokeWidth={LW}
        strokeLinejoin="round"
      />
    </g>
  )

  return {
    key,
    line,
    ell,
    pipe,
    flange,
    valve,
    colm,
    frustum,
    ladder,
    stack,
    vessel,
    sphereTank,
    box,
  }
}

export type TowerPainter = ReturnType<typeof createTowerPainter>
