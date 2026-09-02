'use client'

import { useState } from 'react'
import { CheckCircle2, AlertCircle } from 'lucide-react'
import { type NodeStatus } from '@/store/status-colors'
import { toBinaryStatus, BINARY_STATUS_META } from '@/lib/overview-status'

const COLOR_HEX: Record<string, string> = {
  blue: '#3b82f6',
  violet: '#8b5cf6',
  emerald: '#10b981',
  amber: '#f59e0b',
  rose: '#f43f5e',
  cyan: '#06b6d4',
}

const STATUS_PRIORITY: Record<NodeStatus, number> = {
  alarm: 0,
  warning: 1,
  offline: 2,
  normal: 3,
}

const MAX_DOTS = 8
const DOT_SPACING = 6

/* ── Isometric setup ─────────────────────────────────────────
   ground coords: gx → ลงขวา, gy → ลงซ้าย, z → ขึ้น (px)
   screen dx = (gx-gy)*UX, dy = (gx+gy)*UY - z
   UY = UX * squash — squash คืออัตราส่วน สูง/กว้าง ของ diamond
   ต้องเท่ากับของ workspace floor ไม่งั้นขอบจะไม่ขนานกัน
------------------------------------------------------------- */
const U = 6
const GRID = 5.5
const SLAB = 5
const ISO = Math.SQRT2
const HZ = 30
const CORNER = 1.0
export const DEFAULT_SQUASH = 0.5

type Skin = {
  line: string
  dim: string
  glow: string
  f0: string
  f1: string
  f2: string
  deck: string
  deckSide: string
}

const SKIN: Record<'normal' | 'abnormal' | 'offline', Skin> = {
  normal: {
    line: '#22c55e',
    dim: '#166534',
    glow: '#86efac',
    f0: '#0f2e1c',
    f1: '#0a2013',
    f2: '#051209',
    deck: '#0a1f12',
    deckSide: '#061309',
  },
  abnormal: {
    line: '#f43f5e',
    dim: '#881337',
    glow: '#fda4af',
    f0: '#31101a',
    f1: '#240b12',
    f2: '#160609',
    deck: '#2a0e16',
    deckSide: '#18070c',
  },
  offline: {
    line: '#94a3b8',
    dim: '#3f4c5f',
    glow: '#cbd5e1',
    f0: '#1c232c',
    f1: '#151b22',
    f2: '#0e1216',
    deck: '#181f26',
    deckSide: '#0f1419',
  },
}

const BADGE_PAD = 8
const BADGE_H = 28
const GAP = 7
const STATUS_R = 5
const ICON = 12
const CHAR_W = 8.2 // Geist Sans 13px/600 ≈ 8.2px ต่อตัวอักษร

interface PlantNameBadgeProps {
  cx: number
  cy: number
  status: NodeStatus
  nodeStatuses?: NodeStatus[]
  name: string
  isDark: boolean
  squash?: number
}

export function PlantNameBadge({
  cx,
  cy,
  status,
  nodeStatuses,
  name,
  isDark,
  squash = DEFAULT_SQUASH,
}: PlantNameBadgeProps) {
  const bin = toBinaryStatus(status)
  const statusColor = BINARY_STATUS_META[bin].color
  const StatusIcon = bin === 'abnormal' ? AlertCircle : CheckCircle2
  const sk = SKIN[status === 'offline' ? 'offline' : bin]

  const sortedStatuses = nodeStatuses
    ? [...nodeStatuses]
        .sort((a, b) => STATUS_PRIORITY[a] - STATUS_PRIORITY[b])
        .slice(0, MAX_DOTS)
    : []
  const extraDots =
    nodeStatuses && nodeStatuses.length > MAX_DOTS
      ? nodeStatuses.length - MAX_DOTS
      : 0

  const displayName = name.length > 12 ? `${name.slice(0, 11)}…` : name
  const nameW = Math.max(24, displayName.length * CHAR_W)

  const dotsW =
    sortedStatuses.length > 0
      ? (sortedStatuses.length - 1) * DOT_SPACING + 5 + (extraDots > 0 ? 15 : 0)
      : 0

  const badgeW =
    BADGE_PAD * 2 +
    STATUS_R * 2 +
    GAP +
    nameW +
    (dotsW > 0 ? GAP + dotsW : 0) +
    GAP +
    ICON

  const baseHalfH = 2 * GRID * U * squash
  const badgeX = cx - badgeW / 2
  const badgeY = cy + baseHalfH + SLAB + 15
  const badgeMidY = badgeY + BADGE_H / 2

  const statusDotX = badgeX + BADGE_PAD + STATUS_R
  const nameX = statusDotX + STATUS_R + GAP
  const dotsX = nameX + nameW + GAP + 5
  const iconX = badgeX + badgeW - BADGE_PAD - ICON

  return (
    <g transform="translate(0, 8)">
      <rect
        x={badgeX}
        y={badgeY + 10}
        width={badgeW}
        height={BADGE_H}
        rx={6}
        fill={isDark ? 'rgba(10,13,20,0.96)' : 'rgba(240,244,248,0.96)'}
        stroke={sk.line}
        strokeWidth={0.7}
      />
      <circle
        cx={statusDotX}
        cy={badgeMidY + 10}
        r={STATUS_R}
        fill={statusColor}
      />
      <text
        x={nameX}
        y={badgeMidY + 14.5}
        textAnchor="start"
        fontSize={13}
        fontFamily="Geist Sans, ui-sans-serif, system-ui, sans-serif"
        fontWeight={600}
        fill={isDark ? '#f8fafc' : '#1e293b'}
      >
        {displayName}
      </text>
      {sortedStatuses.length > 0 && (
        <g aria-hidden="true">
          {sortedStatuses.map((st, i) => (
            <circle
              key={`s-${i}`}
              cx={dotsX + i * DOT_SPACING}
              cy={badgeMidY + 10}
              r={2.5}
              fill={BINARY_STATUS_META[toBinaryStatus(st)].color}
              opacity={0.95}
            />
          ))}
          {extraDots > 0 && (
            <text
              x={dotsX + sortedStatuses.length * DOT_SPACING}
              y={badgeMidY + 12.5}
              fontSize={7}
              fontFamily="Geist Sans, ui-sans-serif, sans-serif"
              fontWeight={600}
              fill={isDark ? '#94a3b8' : '#475569'}
            >
              +{extraDots}
            </text>
          )}
        </g>
      )}
      <StatusIcon
        x={iconX}
        y={badgeMidY + 10 - ICON / 2}
        width={ICON}
        height={ICON}
        color={statusColor}
      />
    </g>
  )
}

interface PlantTowerProps {
  cx: number
  cy: number
  nodeCount: number
  status: NodeStatus
  nodeStatuses?: NodeStatus[]
  workspaceColor: string
  name: string
  selected: boolean
  isDark: boolean
  squash?: number
  lod?: boolean
  showBadge: boolean
  onMouseEnter: () => void
  onMouseLeave: () => void
  onClick: () => void
  onDoubleClick: () => void
}

export function PlantTower({
  cx,
  cy,
  nodeCount,
  status,
  nodeStatuses,
  workspaceColor,
  name,
  selected,
  isDark,
  squash = DEFAULT_SQUASH,
  lod = true,
  onMouseEnter,
  onMouseLeave,
  onClick,
  onDoubleClick,
  showBadge = true,
}: PlantTowerProps) {
  const [isFocused, setIsFocused] = useState(false)

  const accentHex = COLOR_HEX[workspaceColor] ?? '#3b82f6'
  const bin = toBinaryStatus(status)
  // const isAbnormal = bin === 'abnormal'
  const statusColor = BINARY_STATUS_META[bin].color
  // const StatusIcon = isAbnormal ? AlertCircle : CheckCircle2
  const isOffline = status === 'offline'
  const sk = SKIN[isOffline ? 'offline' : bin]

  /* nodeCount → height scale (footprint คงที่) */
  const hs = Math.max(0.82, Math.min(0.82 + nodeCount * 0.022, 1.3))
  const LW = 0.9

  /* ── projection ── */
  const SQ = squash
  const UX = U
  const UY = U * SQ
  const BASE_HALF_W = 2 * GRID * UX
  const BASE_HALF_H = 2 * GRID * UY

  const X = (gx: number, gy: number) => cx + (gx - gy) * UX
  const Y = (gx: number, gy: number, z = 0) => cy + (gx + gy) * UY - z
  const P = (gx: number, gy: number, z = 0) => `${X(gx, gy)},${Y(gx, gy, z)}`

  /* keys: deterministic ตามลำดับการวาด */
  let uid = 0
  const K = () => `n${uid++}`
  const out: React.ReactNode[] = []

  const line = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    w = LW * 0.6,
    op = 0.7,
  ) => (
    <line
      key={K()}
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
      key={K()}
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

  /* ── ท่อ: round ทุกข้องอใน screen space ── */
  type Pt3 = [number, number, number]
  const proj = (p: Pt3): [number, number] => [
    X(p[0], p[1]),
    Y(p[0], p[1], p[2]),
  ]

  const roundedPath = (pts: Pt3[], rad: number) => {
    const q = pts.map(proj)
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

  const pipe = (pts: Pt3[], w: number, rad = 5) => {
    const d = roundedPath(pts, rad)
    return (
      <g key={K()}>
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
      <g key={K()}>
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
      key={K()}
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
    const rungs: React.ReactNode[] = []
    for (let z = z0 + 3; z < z1; z += 4.5) {
      rungs.push(
        line(bx + offX - 1.6, by - z, bx + offX + 1.6, by - z, LW * 0.4, 0.45),
      )
    }
    return (
      <g key={K()}>
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
    const g: React.ReactNode[] = []

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
            key={K()}
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
          key={K()}
          cx={bx}
          cy={by - h - 6}
          r={1.9}
          fill={statusColor}
          opacity={status === 'alarm' ? 0.95 : 0.75}
        />,
      )
    }
    return <g key={K()}>{g}</g>
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
    const g: React.ReactNode[] = [frustum(bx, by, 0, rx, h, rx, sk.f1)]

    const nb = lod ? 4 : 2
    for (let i = 1; i < nb; i++)
      g.push(ell(bx, by - h * (i / nb), rx, ry, LW * 0.5, 0.45))

    if (head === 'dome') {
      g.push(
        <path
          key={K()}
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
          key={K()}
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
    return <g key={K()}>{g}</g>
  }

  /* ── ถังทรงกลม (silhouette เป็นวงกลมจริง ไม่ถูกบีบ) ── */
  const sphereTank = (gx: number, gy: number, r: number) => {
    const bx = X(gx, gy)
    const by = Y(gx, gy)
    const R = r * UX * ISO
    const legH = R * 0.6
    const ccy = by - legH - R
    const g: React.ReactNode[] = []

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
        key={K()}
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
    return <g key={K()}>{g}</g>
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
    <g key={K()}>
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

  /* ══ layout ══ */
  const CT = { gx: 3.0, gy: -3.7, rb: 1.45, rt: 1.12, h: 48 * hs }
  const BLD = { x0: -1.9, y0: -2.4, x1: 0.5, y1: -0.2, h: 28 * hs }
  const ST0 = { gx: -4.3, gy: 0.4, rb: 0.44, rt: 0.26, h: 80 * hs }
  const ST1 = { gx: -3.7, gy: 1.4, rb: 0.38, rt: 0.23, h: 64 * hs }
  const ST2 = { gx: -3.9, gy: -0.4, rb: 0.34, rt: 0.2, h: 52 * hs }
  const COL = { gx: -0.6, gy: 0.4, r: 0.34, h: 42 * hs }
  const V0 = { gx: -2.6, gy: 1.6, r: 0.6, h: 17 * hs, hd: 'cone' as const }
  const V1 = { gx: -1.2, gy: 2.6, r: 0.68, h: 14 * hs, hd: 'dome' as const }
  const V2 = { gx: 0.4, gy: 2.4, r: 0.5, h: 11 * hs, hd: 'flat' as const }
  const VESSELS = [V0, V1, V2]
  const SPHERES: [number, number, number][] = [
    [-4.6, 1.8, 0.5],
    [-2.6, 4.2, 0.45],
    [4.2, 2.2, 0.5],
    [3.2, 3.8, 0.45],
  ]
  const RZ = [HZ, HZ - 5, HZ - 10]

  /* ─── 1. Base plate ─── */
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
  const deckD = `M ${outline.map(([a, b]) => P(a, b)).join(' L ')} Z`
  const frontEdge = outline.slice(4, 11)
  const sideD =
    `M ${frontEdge.map(([a, b]) => P(a, b)).join(' L ')}` +
    ` L ${[...frontEdge]
      .reverse()
      .map(([a, b]) => P(a, b, -SLAB))
      .join(' L ')} Z`

  out.push(
    <path
      key={K()}
      d={sideD}
      fill={sk.deckSide}
      stroke={sk.line}
      strokeWidth={LW * 1.2}
      strokeLinejoin="round"
    />,
  )
  out.push(
    <path
      key={K()}
      d={deckD}
      fill={sk.deck}
      stroke={sk.line}
      strokeWidth={LW * 1.6}
      strokeLinejoin="round"
    />,
  )
  for (let i = -4; i <= 4; i++) {
    out.push(
      line(
        X(i, -GRID + 0.4),
        Y(i, -GRID + 0.4),
        X(i, GRID - 0.4),
        Y(i, GRID - 0.4),
        LW * 0.45,
        0.4,
      ),
    )
    out.push(
      line(
        X(-GRID + 0.4, i),
        Y(-GRID + 0.4, i),
        X(GRID - 0.4, i),
        Y(GRID - 0.4, i),
        LW * 0.45,
        0.4,
      ),
    )
  }

  /* ─── 2. ท่อบนแท่น ─── */
  out.push(
    pipe(
      [
        [-3.4, 4.8, 1],
        [-3.4, 4.8, 4],
        [-1.6, 4.8, 4],
        [-1.6, 4.8, 1],
      ],
      1.9,
      4,
    ),
  )
  out.push(flange([-3.4, 4.8, 1], 2.2))
  out.push(flange([-1.6, 4.8, 1], 2.2))
  out.push(
    pipe(
      [
        [0.2, 4.9, 1],
        [0.2, 4.9, 3.4],
        [0.2, 3.0, 3.4],
      ],
      1.7,
      4,
    ),
  )
  out.push(
    pipe(
      [
        [-1.0, 4.0, 3.4],
        [1.8, 4.0, 3.4],
      ],
      1.7,
      4,
    ),
  )
  out.push(valve([0.2, 4.0, 3.4], 2.6))
  out.push(
    pipe(
      [
        [2.8, 4.9, 1],
        [2.8, 4.9, 3.6],
        [2.8, 3.6, 3.6],
      ],
      1.6,
      4,
    ),
  )

  /* ─── 3. Flue gas duct ─── */
  out.push(
    pipe(
      [
        [-1.9, -1.6, BLD.h * 0.6],
        [-3.9, -1.6, BLD.h * 0.6],
        [-3.9, -0.4, BLD.h * 0.6],
        [-3.9, -0.4, ST2.h * 0.5],
      ],
      2.5,
      6,
    ),
  )
  out.push(colm(-3.9, -1.6, BLD.h * 0.6))
  out.push(
    pipe(
      [
        [-1.9, -0.8, BLD.h * 0.35],
        [-4.3, -0.8, BLD.h * 0.35],
        [-4.3, 0.4, BLD.h * 0.35],
        [-4.3, 0.4, ST0.h * 0.42],
      ],
      2.2,
      6,
    ),
  )

  /* ─── 4. Stacks ─── */
  out.push(stack(ST0.gx, ST0.gy, ST0.rb, ST0.rt, ST0.h, true))
  out.push(stack(ST1.gx, ST1.gy, ST1.rb, ST1.rt, ST1.h, true))
  out.push(stack(ST2.gx, ST2.gy, ST2.rb, ST2.rt, ST2.h, false))
  out.push(
    line(
      X(ST0.gx, ST0.gy),
      Y(ST0.gx, ST0.gy, ST0.h * 0.6),
      X(ST1.gx, ST1.gy),
      Y(ST1.gx, ST1.gy, ST1.h * 0.66),
      LW * 0.7,
      0.6,
    ),
  )
  out.push(
    line(
      X(ST1.gx, ST1.gy),
      Y(ST1.gx, ST1.gy, ST1.h * 0.42),
      X(ST2.gx, ST2.gy),
      Y(ST2.gx, ST2.gy, ST2.h * 0.5),
      LW * 0.7,
      0.5,
    ),
  )

  /* ─── 5. Cooling tower ─── */
  {
    const bx = X(CT.gx, CT.gy)
    const by = Y(CT.gx, CT.gy)
    const rb = CT.rb * UX * ISO
    const rt = CT.rt * UX * ISO
    const w = rb * 0.6
    const h = CT.h
    const prof = (t: number) => rb + (rt - rb) * (1.55 * t - 0.55 * t * t)
    const g: React.ReactNode[] = []

    g.push(
      <path
        key={K()}
        fill={sk.f1}
        stroke={sk.line}
        strokeWidth={LW * 1.2}
        d={
          `M ${bx - rb} ${by} Q ${bx - w} ${by - h * 0.62} ${bx - rt} ${by - h}` +
          ` L ${bx + rt} ${by - h} Q ${bx + w} ${by - h * 0.62} ${bx + rb} ${by}` +
          ` A ${rb} ${rb * SQ} 0 0 1 ${bx - rb} ${by} Z`
        }
      />,
    )
    const nr = lod ? 11 : 5
    for (let i = 1; i <= nr; i++) {
      const t = i / (nr + 1)
      const r = prof(t)
      g.push(ell(bx, by - h * t, r, r * SQ, LW * 0.45, 0.45))
    }
    if (lod) {
      for (let i = 0; i < 9; i++) {
        const f = -0.92 + i * 0.23
        g.push(
          <path
            key={K()}
            fill="none"
            stroke={sk.line}
            strokeWidth={LW * 0.38}
            opacity={0.4}
            d={`M ${bx + rb * f} ${by} Q ${bx + w * f * 1.05} ${by - h * 0.62} ${bx + rt * f} ${by - h}`}
          />,
        )
      }
      const zt = h * 0.115
      const r2 = prof(0.115)
      for (let i = 0; i <= 14; i++) {
        const a = Math.PI * (i / 14)
        const a2 = Math.PI * ((i + 1) / 14)
        const x0 = bx + rb * Math.cos(a),
          y0 = by + rb * SQ * Math.sin(a)
        const x1 = bx + r2 * Math.cos(a),
          y1 = by - zt + r2 * SQ * Math.sin(a)
        const x2 = bx + r2 * Math.cos(a2),
          y2 = by - zt + r2 * SQ * Math.sin(a2)
        g.push(line(x0, y0, x1, y1, LW * 0.45, 0.55))
        if (i < 14) g.push(line(x0, y0, x2, y2, LW * 0.35, 0.35))
      }
      g.push(ell(bx, by - zt, r2, r2 * SQ, LW * 0.7, 0.7))
    }
    if (!isOffline) {
      g.push(
        <ellipse
          key={K()}
          cx={bx}
          cy={by - h}
          rx={rt * 0.7}
          ry={rt * 0.7 * SQ}
          fill={statusColor}
          opacity={status === 'alarm' ? 0.5 : 0.28}
        />,
      )
    }
    g.push(ell(bx, by - h, rt, rt * SQ, LW * 1.3, 0.95))
    if (!isOffline) {
      g.push(
        <g key={K()} opacity={0.4} stroke={statusColor} fill="none">
          <path
            strokeWidth={1.2}
            strokeLinecap="round"
            d={`M ${bx - rt * 0.5} ${by - h - 5} Q ${bx} ${by - h - 12} ${bx + rt * 0.5} ${by - h - 5}`}
          />
          <path
            strokeWidth={1}
            strokeLinecap="round"
            d={`M ${bx - rt * 0.3} ${by - h - 12} Q ${bx + 2} ${by - h - 18} ${bx + rt * 0.34} ${by - h - 12}`}
          />
        </g>,
      )
    }
    out.push(<g key={K()}>{g}</g>)
  }

  /* ─── 6. Boiler house ─── */
  out.push(box(BLD.x0, BLD.y0, BLD.x1, BLD.y1, 0, BLD.h))
  if (lod) {
    for (let a = BLD.x0 + 0.45; a < BLD.x1 - 0.1; a += 0.45) {
      out.push(
        line(
          X(a, BLD.y1),
          Y(a, BLD.y1),
          X(a, BLD.y1),
          Y(a, BLD.y1, BLD.h),
          LW * 0.4,
          0.35,
        ),
      )
    }
    for (let b = BLD.y0 + 0.5; b < BLD.y1 - 0.1; b += 0.5) {
      out.push(
        line(
          X(BLD.x1, b),
          Y(BLD.x1, b),
          X(BLD.x1, b),
          Y(BLD.x1, b, BLD.h),
          LW * 0.4,
          0.3,
        ),
      )
    }
    ;[0.3, 0.6, 0.85].forEach(f => {
      out.push(
        line(
          X(BLD.x0, BLD.y1),
          Y(BLD.x0, BLD.y1, BLD.h * f),
          X(BLD.x1, BLD.y1),
          Y(BLD.x1, BLD.y1, BLD.h * f),
          LW * 0.4,
          0.35,
        ),
      )
      out.push(
        line(
          X(BLD.x1, BLD.y0),
          Y(BLD.x1, BLD.y0, BLD.h * f),
          X(BLD.x1, BLD.y1),
          Y(BLD.x1, BLD.y1, BLD.h * f),
          LW * 0.4,
          0.3,
        ),
      )
    })
  }
  out.push(box(-0.9, -1.9, 0.0, -0.9, BLD.h, 9))
  {
    const wins: React.ReactNode[] = []
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const a = BLD.x0 + 0.36 + c * 0.62
        const z = 5 + r * 7.5
        if (z + 4.5 > BLD.h - 3) continue
        wins.push(
          <polygon
            key={K()}
            fill={sk.glow}
            opacity={0.55}
            points={[
              P(a, BLD.y1, z),
              P(a + 0.4, BLD.y1, z),
              P(a + 0.4, BLD.y1, z + 4.5),
              P(a, BLD.y1, z + 4.5),
            ].join(' ')}
          />,
        )
      }
    }
    out.push(
      <g key={K()} opacity={isOffline ? 0.3 : 1}>
        {wins}
      </g>,
    )
  }

  /* ─── 7. Distillation column ─── */
  out.push(vessel(COL.gx, COL.gy, COL.r, COL.h, 'dome'))
  if (lod) {
    const bx = X(COL.gx, COL.gy)
    const by = Y(COL.gx, COL.gy)
    const rx = COL.r * UX * ISO
    ;[0.3, 0.5, 0.7, 0.88].forEach(f =>
      out.push(
        ell(bx, by - COL.h * f, rx * 1.5, rx * 1.5 * SQ, LW * 0.5, 0.55),
      ),
    )
    out.push(
      pipe(
        [
          [COL.gx, COL.gy, COL.h * 0.9],
          [COL.gx + 1.0, COL.gy, COL.h * 0.9],
          [COL.gx + 1.0, COL.gy, HZ],
        ],
        1.5,
        4,
      ),
    )
    out.push(
      pipe(
        [
          [COL.gx, COL.gy, 6],
          [COL.gx - 1.0, COL.gy, 6],
          [COL.gx - 1.0, COL.gy + 1.2, 6],
        ],
        1.4,
        4,
      ),
    )
  }

  /* ─── 8. Tanks + spheres ─── */
  out.push(sphereTank(SPHERES[0]![0], SPHERES[0]![1], SPHERES[0]![2]))
  VESSELS.forEach(v => out.push(vessel(v.gx, v.gy, v.r, v.h, v.hd)))
  out.push(sphereTank(SPHERES[2]![0], SPHERES[2]![1], SPHERES[2]![2]))
  out.push(sphereTank(SPHERES[1]![0], SPHERES[1]![1], SPHERES[1]![2]))
  out.push(sphereTank(SPHERES[3]![0], SPHERES[3]![1], SPHERES[3]![2]))

  /* ─── 9. Overhead pipe rack ─── */
  RZ.forEach((z, i) => {
    out.push(
      pipe(
        [
          [-4.2, 1.0, z],
          [2.05 - i * 0.15, 1.0, z],
          [2.05 - i * 0.15, -1.8, z],
          [2.35 - i * 0.1, -2.7, CT.h * (0.58 - i * 0.11)],
        ],
        2.2 - i * 0.35,
        6,
      ),
    )
  })
  ;[-3.4, -2.0, -0.6, 0.8, 2.0].forEach(g => {
    out.push(colm(g, 1.0, HZ, LW * 0.9))
    RZ.forEach(z =>
      out.push(
        line(
          X(g, 1.0) - 4,
          Y(g, 1.0, z),
          X(g, 1.0) + 4,
          Y(g, 1.0, z),
          LW * 0.5,
          0.5,
        ),
      ),
    )
    out.push(
      line(
        X(g, 1.0) - 4,
        Y(g, 1.0, HZ),
        X(g, 1.0) + 4,
        Y(g, 1.0, RZ[2]!),
        LW * 0.35,
        0.3,
      ),
    )
  })
  VESSELS.forEach((v, i) => {
    const top =
      v.h + (v.hd === 'dome' ? v.r * 8 : v.hd === 'cone' ? v.r * 7 : 2)
    const z = RZ[1 + (i % 2)]!
    out.push(
      pipe(
        [
          [v.gx, v.gy, top],
          [v.gx, v.gy, z],
          [v.gx, 1.0, z],
        ],
        1.5,
        4,
      ),
    )
  })
  out.push(
    pipe(
      [
        [0.4, -0.2, BLD.h + 3],
        [0.4, 0.6, BLD.h + 3],
        [0.4, 1.0, RZ[1]!],
      ],
      1.7,
      5,
    ),
  )
  SPHERES.forEach(([gx, gy, r]) => {
    out.push(
      pipe(
        [
          [gx, gy, r * 7],
          [gx, gy, 6],
          [gx < 0 ? gx + 1.0 : gx - 1.0, gy, 6],
        ],
        1.3,
        4,
      ),
    )
  })
  out.push(
    pipe(
      [
        [4.0, -2.4, 4],
        [4.0, 2.8, 4],
        [3.0, 3.2, 4],
      ],
      1.8,
      5,
    ),
  )

  return (
    <g
      className="cursor-pointer motion-safe:transition-transform motion-safe:hover:-translate-y-1"
      tabIndex={0}
      role="button"
      aria-label={`${name} plant — status: ${status}, ${nodeCount} nodes`}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
      onDoubleClick={e => {
        e.preventDefault()
        onDoubleClick()
      }}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      {isFocused && (
        <ellipse
          cx={cx}
          cy={cy + 8}
          rx={BASE_HALF_W + 16}
          ry={BASE_HALF_H + 13}
          fill="none"
          stroke={accentHex}
          strokeWidth={2}
          opacity={0.9}
        />
      )}
      {selected && (
        <ellipse
          cx={cx}
          cy={cy + 8}
          rx={BASE_HALF_W + 9}
          ry={BASE_HALF_H + 8}
          fill="none"
          stroke={accentHex}
          strokeWidth={1.5}
          strokeDasharray="4 3"
          opacity={0.75}
        />
      )}

      <g transform="translate(0, 8)">{out}</g>

      {showBadge && (
        <PlantNameBadge
          cx={cx}
          cy={cy}
          status={status}
          nodeStatuses={nodeStatuses}
          name={name}
          isDark={isDark}
          squash={squash}
        />
      )}
    </g>
  )
}
