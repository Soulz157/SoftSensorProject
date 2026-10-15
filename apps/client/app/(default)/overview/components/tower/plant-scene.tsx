import { memo, type ReactNode } from 'react'
import {
  GRID,
  HZ,
  ISO,
  SLAB,
  makeProjection,
  plateOutline,
  towerHeightScale,
} from '@/lib/iso-tower'
import { BINARY_STATUS_META, toBinaryStatus } from '@/lib/overview-status'
import { type NodeStatus } from '@/store/status-colors'
import { LW, createTowerPainter } from './tower-painter'
import { skinFor } from './tower-skin'

interface PlantSceneProps {
  cx: number
  cy: number
  squash: number
  equipmentCount: number
  status: NodeStatus
  lod: boolean
}

/**
 * The plant drawing itself: base plate, pipes, stacks, cooling tower, boiler
 * house, column, tanks and pipe rack. Sections are pushed in paint order —
 * the order below IS the SVG z-order, so do not reorder them.
 *
 * Memoised: its props are plain values, so hovering another plant on the map
 * (which re-renders every tower) does not rebuild hundreds of SVG nodes.
 */
export const PlantScene = memo(function PlantScene({
  cx,
  cy,
  squash,
  equipmentCount,
  status,
  lod,
}: PlantSceneProps) {
  const statusColor = BINARY_STATUS_META[toBinaryStatus(status)].color
  const isOffline = status === 'offline'
  const sk = skinFor(status)
  const hs = towerHeightScale(equipmentCount)
  const iso = makeProjection(cx, cy, squash)
  const { X, Y, P, UX, SQ } = iso
  const {
    key,
    line,
    ell,
    pipe,
    flange,
    valve,
    colm,
    stack,
    vessel,
    sphereTank,
    box,
  } = createTowerPainter({ iso, sk, lod, status, statusColor })
  const out: ReactNode[] = []

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
  const outline = plateOutline()
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
      key={key()}
      d={sideD}
      fill={sk.deckSide}
      stroke={sk.line}
      strokeWidth={LW * 1.2}
      strokeLinejoin="round"
    />,
  )
  out.push(
    <path
      key={key()}
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
    const g: ReactNode[] = []

    g.push(
      <path
        key={key()}
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
            key={key()}
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
          key={key()}
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
        <g key={key()} opacity={0.4} stroke={statusColor} fill="none">
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
    out.push(<g key={key()}>{g}</g>)
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
    const wins: ReactNode[] = []
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const a = BLD.x0 + 0.36 + c * 0.62
        const z = 5 + r * 7.5
        if (z + 4.5 > BLD.h - 3) continue
        wins.push(
          <polygon
            key={key()}
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
      <g key={key()} opacity={isOffline ? 0.3 : 1}>
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
  return <g transform="translate(0, 8)">{out}</g>
})
