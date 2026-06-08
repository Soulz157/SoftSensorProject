# User Dashboard — 2.5D Digital Twin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an isometric 2.5D Digital Twin dashboard at `(default)/dashboard/` showing workspace zones with interactive SVG machine nodes, a workspace sidebar, and a node detail panel.

**Architecture:** Command Center layout (160px sidebar + flex SVG map + 200px detail panel). Pure SVG isometric rendering — no extra dependencies. Node `x,y` from canvas projected via normalize → scale → isometric transform. Machine SVG selected by `NodeData.type` + `NodeData.icon`. Admin dashboard components already live at `app/admin/dashboard/` — untouched.

**Tech Stack:** Next.js 16 App Router · React SVG · Tailwind v4 · Jotai (`workspacesAtom`) · `services/canvas.ts` (`getNodes`) · Vitest + @testing-library/react

---

## File Map

```
app/(default)/dashboard/
├── page.tsx                          # "use client" — state + data, composes all sections
├── loading.tsx                       # Skeleton while data loads
├── error.tsx                         # Error boundary
└── components/
    ├── project-coords.ts             # Pure: normalize coords → isometric projection
    ├── dashboard-header.tsx          # Top bar: search, global status badge, user avatar
    ├── workspace-sidebar.tsx         # Left: workspace list + status filters
    ├── isometric-map.tsx             # Center: SVG canvas with zone floors + nodes
    ├── machine-node.tsx              # SVG <g>: picks machine SVG + status ring
    ├── node-detail-panel.tsx         # Right: selected node info + AI models
    ├── machine-legend.tsx            # Bottom bar: type icons + status key
    ├── use-dashboard-data.ts         # Hook: workspaces + parallel getNodes
    └── machines/
        ├── cnc-machine.tsx           # SVG: spindle + tool bit + panel
        ├── robot-arm.tsx             # SVG: base + arm segments + gripper
        ├── sensor.tsx                # SVG: cylinder + antenna + signal rings
        ├── conveyor.tsx              # SVG: belt + rollers + items
        └── controller.tsx            # SVG: cabinet + HMI screen + LEDs
```

**Status color constants** (used across all machine SVGs — define once, import everywhere):

```ts
// components/machines/status-colors.ts  ← also create this
export const STATUS_COLORS = {
  normal: '#22c55e',
  warning: '#f59e0b',
  alarm: '#ef4444',
  offline: '#71717a',
} as const

export type NodeStatus = 'normal' | 'warning' | 'alarm' | 'offline'
```

---

## Task 1: Coordinate Projection Utility

**Files:**

- Create: `app/(default)/dashboard/components/project-coords.ts`
- Test: `app/(default)/dashboard/components/__tests__/project-coords.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// app/(default)/dashboard/components/__tests__/project-coords.test.ts
import { describe, it, expect } from 'vitest'
import { projectToIso, getZoneOffset, normalizeCoord } from '../project-coords'

describe('normalizeCoord', () => {
  it('returns 0 when x equals minX', () => {
    expect(normalizeCoord(10, 10, 100)).toBe(0)
  })
  it('returns 1 when x equals maxX', () => {
    expect(normalizeCoord(100, 10, 100)).toBe(1)
  })
  it('returns 0.5 for midpoint', () => {
    expect(normalizeCoord(55, 10, 100)).toBeCloseTo(0.5)
  })
  it('clamps to 0 when range is zero (single node edge case)', () => {
    expect(normalizeCoord(50, 50, 50)).toBe(0)
  })
})

describe('getZoneOffset', () => {
  it('index 0 → col 0, row 0 → offset (0, 0)', () => {
    expect(getZoneOffset(0)).toEqual({ x: 0, y: 0 })
  })
  it('index 1 → col 1, row 0 → offset (280, 0)', () => {
    expect(getZoneOffset(1)).toEqual({ x: 280, y: 0 })
  })
  it('index 2 → col 0, row 1 → offset (0, 160)', () => {
    expect(getZoneOffset(2)).toEqual({ x: 0, y: 160 })
  })
  it('index 3 → col 1, row 1 → offset (280, 160)', () => {
    expect(getZoneOffset(3)).toEqual({ x: 280, y: 160 })
  })
})

describe('projectToIso', () => {
  it('places single node at zone center when range is zero', () => {
    const result = projectToIso(50, 50, 50, 50, 50, 50, 0, 0, 300, 200)
    // scaledX = 0*200 + 0 = 0, scaledY = 0*100 + 0 = 0
    // isoX = (0-0)*cos(30) = 0, isoY = (0+0)*sin(30)*0.5 = 0
    // svgX = 0 + 300 = 300, svgY = 0 + 200 = 200
    expect(result.x).toBeCloseTo(300)
    expect(result.y).toBeCloseTo(200)
  })
  it('returns numeric x and y', () => {
    const result = projectToIso(200, 100, 0, 400, 0, 300, 0, 0, 300, 200)
    expect(typeof result.x).toBe('number')
    expect(typeof result.y).toBe('number')
    expect(isFinite(result.x)).toBe(true)
    expect(isFinite(result.y)).toBe(true)
  })
  it('two nodes at opposite corners produce different iso positions', () => {
    const a = projectToIso(0, 0, 0, 400, 0, 300, 0, 0, 300, 200)
    const b = projectToIso(400, 300, 0, 400, 0, 300, 0, 0, 300, 200)
    expect(a.x).not.toBeCloseTo(b.x)
    expect(a.y).not.toBeCloseTo(b.y)
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm --filter client test -- --testPathPattern=project-coords
```

Expected: `Cannot find module '../project-coords'`

- [ ] **Step 3: Implement**

```ts
// app/(default)/dashboard/components/project-coords.ts

export interface IsoPoint {
  x: number
  y: number
}

/** Normalize a value within [min, max] to [0, 1]. Returns 0 if range is zero. */
export function normalizeCoord(
  value: number,
  min: number,
  max: number,
): number {
  const range = max - min
  if (range === 0) return 0
  return (value - min) / range
}

/** Zone grid: 2 columns, offset each zone by (col*280, row*160) in iso space. */
export function getZoneOffset(index: number): { x: number; y: number } {
  const col = index % 2
  const row = Math.floor(index / 2)
  return { x: col * 280, y: row * 160 }
}

/**
 * Projects canvas node coords to SVG isometric screen coords.
 * Steps: normalize within workspace bounding box → scale to zone slot → iso transform → viewport offset.
 */
export function projectToIso(
  nodeX: number,
  nodeY: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  zoneOffsetX: number,
  zoneOffsetY: number,
  viewportCenterX: number,
  viewportCenterY: number,
): IsoPoint {
  const normX = normalizeCoord(nodeX, minX, maxX)
  const normY = normalizeCoord(nodeY, minY, maxY)
  const scaledX = normX * 200 + zoneOffsetX
  const scaledY = normY * 100 + zoneOffsetY
  const isoX = (scaledX - scaledY) * Math.cos(Math.PI / 6)
  const isoY = (scaledX + scaledY) * Math.sin(Math.PI / 6) * 0.5
  return { x: isoX + viewportCenterX, y: isoY + viewportCenterY }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
pnpm --filter client test -- --testPathPattern=project-coords
```

Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/client/app/\(default\)/dashboard/components/project-coords.ts \
        apps/client/app/\(default\)/dashboard/components/__tests__/project-coords.test.ts
git commit -m "feat(dashboard): add isometric coordinate projection utility"
```

---

## Task 2: Status Colors + Machine SVG Components

**Files:**

- Create: `app/(default)/dashboard/components/machines/status-colors.ts`
- Create: `app/(default)/dashboard/components/machines/cnc-machine.tsx`
- Create: `app/(default)/dashboard/components/machines/robot-arm.tsx`
- Create: `app/(default)/dashboard/components/machines/sensor.tsx`
- Create: `app/(default)/dashboard/components/machines/conveyor.tsx`
- Create: `app/(default)/dashboard/components/machines/controller.tsx`
- Test: `app/(default)/dashboard/components/__tests__/machines.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// app/(default)/dashboard/components/__tests__/machines.test.tsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { CncMachineSvg } from '../machines/cnc-machine'
import { RobotArmSvg } from '../machines/robot-arm'
import { SensorSvg } from '../machines/sensor'
import { ConveyorSvg } from '../machines/conveyor'
import { ControllerSvg } from '../machines/controller'

const STATUSES = ['normal', 'warning', 'alarm', 'offline'] as const

describe('Machine SVG components', () => {
  const components = [
    { name: 'CncMachineSvg', Component: CncMachineSvg },
    { name: 'RobotArmSvg', Component: RobotArmSvg },
    { name: 'SensorSvg', Component: SensorSvg },
    { name: 'ConveyorSvg', Component: ConveyorSvg },
    { name: 'ControllerSvg', Component: ControllerSvg },
  ]

  components.forEach(({ name, Component }) => {
    STATUSES.forEach(status => {
      it(`${name} renders with status="${status}" without crashing`, () => {
        const { container } = render(
          <svg>
            <Component status={status} />
          </svg>,
        )
        expect(container.querySelector('g')).not.toBeNull()
      })
    })

    it(`${name} selected=true renders without crashing`, () => {
      const { container } = render(
        <svg>
          <Component status="normal" selected />
        </svg>,
      )
      expect(container.querySelector('g')).not.toBeNull()
    })
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm --filter client test -- --testPathPattern=machines
```

Expected: `Cannot find module '../machines/cnc-machine'`

- [ ] **Step 3: Create status-colors.ts**

```ts
// app/(default)/dashboard/components/machines/status-colors.ts
export const STATUS_COLORS = {
  normal: '#22c55e',
  warning: '#f59e0b',
  alarm: '#ef4444',
  offline: '#71717a',
} as const

export type NodeStatus = 'normal' | 'warning' | 'alarm' | 'offline'

export interface MachineSvgProps {
  status: NodeStatus
  selected?: boolean
}
```

- [ ] **Step 4: Create cnc-machine.tsx**

```tsx
// app/(default)/dashboard/components/machines/cnc-machine.tsx
import { STATUS_COLORS, type MachineSvgProps } from './status-colors'
import { cn } from '@/lib/utils'

export function CncMachineSvg({ status, selected = false }: MachineSvgProps) {
  const color = STATUS_COLORS[status]
  const isAlarm = status === 'alarm'
  const isWarning = status === 'warning'

  return (
    <g>
      {/* Base platform */}
      <path
        d="M20 68 L50 52 L80 68 L50 84 Z"
        fill="#0d1f35"
        stroke={`${color}30`}
        strokeWidth={1}
      />
      {/* Body — right face */}
      <path
        d="M72 44 L72 68 L50 80 L50 56 Z"
        fill="#112438"
        stroke={`${color}40`}
        strokeWidth={0.8}
      />
      {/* Body — left face */}
      <path
        d="M28 44 L28 68 L50 80 L50 56 Z"
        fill="#0d2235"
        stroke={`${color}40`}
        strokeWidth={0.8}
      />
      {/* Body — top face */}
      <path
        d="M28 44 L50 32 L72 44 L50 56 Z"
        fill="#163550"
        stroke={color}
        strokeWidth={1.5}
      />
      {/* Head — left face */}
      <path d="M36 32 L36 44 L50 52 L50 40 Z" fill="#122e42" strokeWidth={0} />
      {/* Head — right face */}
      <path d="M64 32 L64 44 L50 52 L50 40 Z" fill="#163650" strokeWidth={0} />
      {/* Head — top face */}
      <path
        d="M36 32 L50 24 L64 32 L50 40 Z"
        fill="#1e4560"
        stroke="#38bdf8"
        strokeWidth={1.5}
      />
      {/* Spindle shaft */}
      <line
        x1={50}
        y1={28}
        x2={50}
        y2={38}
        stroke="#38bdf8"
        strokeWidth={2}
        strokeLinecap="round"
      />
      <circle cx={50} cy={38} r={2.5} fill="#38bdf8" />
      {/* Tool bit */}
      <line
        x1={50}
        y1={38}
        x2={50}
        y2={46}
        stroke="#94a3b8"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      <polygon points="48,46 52,46 50,51" fill="#94a3b8" />
      {/* Panel details */}
      <rect
        x={35}
        y={58}
        width={8}
        height={5}
        rx={1}
        fill="#1a3a55"
        stroke={`${color}50`}
        strokeWidth={0.5}
      />
      <rect
        x={45}
        y={58}
        width={4}
        height={5}
        rx={1}
        fill="#0e2030"
        stroke={`${color}30`}
        strokeWidth={0.5}
      />
      {/* Status glow ring — inner */}
      <ellipse
        cx={50}
        cy={83}
        rx={26}
        ry={10}
        fill="none"
        stroke={color}
        strokeWidth={selected ? 2.5 : 1.8}
        opacity={0.9}
        className={cn(isAlarm && 'animate-pulse')}
      />
      {/* Status glow ring — outer (soft) */}
      <ellipse
        cx={50}
        cy={83}
        rx={38}
        ry={15}
        fill="none"
        stroke={color}
        strokeWidth={6}
        opacity={isAlarm || isWarning ? 0.2 : 0.1}
        className={cn((isAlarm || isWarning) && 'animate-pulse')}
      />
    </g>
  )
}
```

- [ ] **Step 5: Create robot-arm.tsx**

```tsx
// app/(default)/dashboard/components/machines/robot-arm.tsx
import { STATUS_COLORS, type MachineSvgProps } from './status-colors'
import { cn } from '@/lib/utils'

export function RobotArmSvg({ status, selected = false }: MachineSvgProps) {
  const color = STATUS_COLORS[status]
  const isAlarm = status === 'alarm'
  const isWarning = status === 'warning'

  return (
    <g>
      {/* Base — top face */}
      <path
        d="M28 72 L50 62 L72 72 L50 82 Z"
        fill="#122818"
        stroke={`${color}50`}
        strokeWidth={1}
      />
      {/* Base — left face */}
      <path
        d="M28 72 L28 80 L50 90 L50 82 Z"
        fill="#0d1e10"
        stroke={`${color}30`}
        strokeWidth={0.8}
      />
      {/* Base — right face */}
      <path
        d="M72 72 L72 80 L50 90 L50 82 Z"
        fill="#102215"
        stroke={`${color}30`}
        strokeWidth={0.8}
      />
      {/* Lower arm */}
      <path
        d="M42 62 L58 54 L58 40 L42 48 Z"
        fill="#143520"
        stroke={`${color}60`}
        strokeWidth={1}
      />
      {/* Joint */}
      <circle
        cx={50}
        cy={43}
        r={5}
        fill="#1a4028"
        stroke={color}
        strokeWidth={1.5}
      />
      {/* Upper arm */}
      <path
        d="M44 43 L56 37 L62 22 L50 28 Z"
        fill="#1a4028"
        stroke={color}
        strokeWidth={1.2}
      />
      {/* Gripper body */}
      <path
        d="M57 22 L66 18 L68 26 L59 30 Z"
        fill="#0f2218"
        stroke={color}
        strokeWidth={1}
      />
      {/* Gripper fingers */}
      <line
        x1={63}
        y1={18}
        x2={68}
        y2={14}
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      <line
        x1={63}
        y1={22}
        x2={69}
        y2={20}
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      {/* Status glow ring — inner */}
      <ellipse
        cx={50}
        cy={89}
        rx={24}
        ry={9}
        fill="none"
        stroke={color}
        strokeWidth={selected ? 2.5 : 1.5}
        opacity={0.8}
        className={cn(isAlarm && 'animate-pulse')}
      />
      {/* Status glow ring — outer */}
      <ellipse
        cx={50}
        cy={89}
        rx={36}
        ry={14}
        fill="none"
        stroke={color}
        strokeWidth={5}
        opacity={isAlarm || isWarning ? 0.2 : 0.1}
        className={cn((isAlarm || isWarning) && 'animate-pulse')}
      />
    </g>
  )
}
```

- [ ] **Step 6: Create sensor.tsx**

```tsx
// app/(default)/dashboard/components/machines/sensor.tsx
import { STATUS_COLORS, type MachineSvgProps } from './status-colors'
import { cn } from '@/lib/utils'

export function SensorSvg({ status, selected = false }: MachineSvgProps) {
  const color = STATUS_COLORS[status]
  const isAlarm = status === 'alarm'
  const isWarning = status === 'warning'

  return (
    <g>
      {/* Base — top face */}
      <path
        d="M36 76 L50 68 L64 76 L50 84 Z"
        fill="#1a2030"
        stroke={`${color}30`}
        strokeWidth={1}
      />
      {/* Base — left face */}
      <path
        d="M36 76 L36 82 L50 90 L50 84 Z"
        fill="#111828"
        stroke={`${color}20`}
        strokeWidth={0.8}
      />
      {/* Base — right face */}
      <path
        d="M64 76 L64 82 L50 90 L50 84 Z"
        fill="#141c2e"
        stroke={`${color}20`}
        strokeWidth={0.8}
      />
      {/* Cylinder body — top face */}
      <path
        d="M40 56 L50 50 L60 56 L50 62 Z"
        fill="#1e2845"
        stroke={color}
        strokeWidth={1.5}
      />
      {/* Cylinder body — left face */}
      <path
        d="M40 56 L40 76 L50 82 L50 62 Z"
        fill="#141c35"
        stroke={`${color}40`}
        strokeWidth={0.8}
      />
      {/* Cylinder body — right face */}
      <path
        d="M60 56 L60 76 L50 82 L50 62 Z"
        fill="#181e3c"
        stroke={`${color}40`}
        strokeWidth={0.8}
      />
      {/* Antenna */}
      <line
        x1={50}
        y1={50}
        x2={50}
        y2={32}
        stroke="#a78bfa"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      <circle
        cx={50}
        cy={30}
        r={3}
        fill="#a78bfa"
        stroke="#c4b5fd"
        strokeWidth={1}
      />
      {/* Signal rings */}
      <path
        d="M44 36 Q50 30 56 36"
        fill="none"
        stroke="#a78bfa70"
        strokeWidth={1}
        strokeLinecap="round"
      />
      <path
        d="M40 40 Q50 30 60 40"
        fill="none"
        stroke="#a78bfa50"
        strokeWidth={1}
        strokeLinecap="round"
      />
      <path
        d="M36 44 Q50 30 64 44"
        fill="none"
        stroke="#a78bfa30"
        strokeWidth={1}
        strokeLinecap="round"
      />
      {/* Status LED */}
      <circle cx={50} cy={67} r={2} fill={color} />
      {/* Status glow ring — inner */}
      <ellipse
        cx={50}
        cy={89}
        rx={18}
        ry={7}
        fill="none"
        stroke={color}
        strokeWidth={selected ? 2.5 : 1.5}
        opacity={0.9}
        className={cn(isAlarm && 'animate-pulse')}
      />
      {/* Status glow ring — outer */}
      <ellipse
        cx={50}
        cy={89}
        rx={28}
        ry={11}
        fill="none"
        stroke={color}
        strokeWidth={5}
        opacity={isAlarm || isWarning ? 0.2 : 0.1}
        className={cn((isAlarm || isWarning) && 'animate-pulse')}
      />
    </g>
  )
}
```

- [ ] **Step 7: Create conveyor.tsx**

```tsx
// app/(default)/dashboard/components/machines/conveyor.tsx
import { STATUS_COLORS, type MachineSvgProps } from './status-colors'
import { cn } from '@/lib/utils'

export function ConveyorSvg({ status, selected = false }: MachineSvgProps) {
  const color = STATUS_COLORS[status]
  const isAlarm = status === 'alarm'
  const isWarning = status === 'warning'

  return (
    <g>
      {/* Belt — top face */}
      <path
        d="M18 58 L50 42 L82 58 L50 74 Z"
        fill="#122018"
        stroke={color}
        strokeWidth={1.5}
      />
      {/* Belt — left face */}
      <path
        d="M18 58 L18 68 L50 84 L50 74 Z"
        fill="#0c1810"
        stroke={`${color}40`}
        strokeWidth={0.8}
      />
      {/* Belt — right face */}
      <path
        d="M82 58 L82 68 L50 84 L50 74 Z"
        fill="#0f1e14"
        stroke={`${color}40`}
        strokeWidth={0.8}
      />
      {/* Belt texture lines */}
      <line
        x1={30}
        y1={58}
        x2={62}
        y2={44}
        stroke="#1a3020"
        strokeWidth={0.8}
      />
      <line
        x1={38}
        y1={62}
        x2={70}
        y2={48}
        stroke="#1a3020"
        strokeWidth={0.8}
      />
      <line
        x1={22}
        y1={60}
        x2={54}
        y2={46}
        stroke="#1a3020"
        strokeWidth={0.8}
      />
      {/* Left roller */}
      <path
        d="M14 52 L22 48 L22 66 L14 70 Z"
        fill="#163a20"
        stroke={color}
        strokeWidth={1.5}
      />
      <ellipse
        cx={18}
        cy={59}
        rx={4}
        ry={8}
        fill="#1a4025"
        stroke={color}
        strokeWidth={1}
      />
      {/* Right roller */}
      <path
        d="M78 48 L86 52 L86 70 L78 66 Z"
        fill="#163a20"
        stroke={color}
        strokeWidth={1.5}
      />
      <ellipse
        cx={82}
        cy={59}
        rx={4}
        ry={8}
        fill="#1a4025"
        stroke={color}
        strokeWidth={1}
      />
      {/* Items on belt */}
      <path
        d="M42 52 L50 48 L58 52 L50 56 Z"
        fill="#0e2818"
        stroke={`${color}50`}
        strokeWidth={0.8}
      />
      <path
        d="M28 58 L36 54 L44 58 L36 62 Z"
        fill="#0e2818"
        stroke={`${color}50`}
        strokeWidth={0.8}
      />
      {/* Status glow ring — inner */}
      <ellipse
        cx={50}
        cy={83}
        rx={36}
        ry={13}
        fill="none"
        stroke={color}
        strokeWidth={selected ? 2.5 : 1.5}
        opacity={0.7}
        className={cn(isAlarm && 'animate-pulse')}
      />
      {/* Status glow ring — outer */}
      <ellipse
        cx={50}
        cy={83}
        rx={50}
        ry={18}
        fill="none"
        stroke={color}
        strokeWidth={5}
        opacity={isAlarm || isWarning ? 0.2 : 0.08}
        className={cn((isAlarm || isWarning) && 'animate-pulse')}
      />
    </g>
  )
}
```

- [ ] **Step 8: Create controller.tsx**

```tsx
// app/(default)/dashboard/components/machines/controller.tsx
import { STATUS_COLORS, type MachineSvgProps } from './status-colors'
import { cn } from '@/lib/utils'

export function ControllerSvg({ status, selected = false }: MachineSvgProps) {
  const color = STATUS_COLORS[status]
  const isAlarm = status === 'alarm'
  const isWarning = status === 'warning'

  return (
    <g>
      {/* Cabinet base — top face */}
      <path
        d="M28 72 L50 60 L72 72 L50 84 Z"
        fill="#0d1520"
        stroke={`${color}30`}
        strokeWidth={1}
      />
      {/* Cabinet base — left face */}
      <path
        d="M28 72 L28 80 L50 92 L50 84 Z"
        fill="#081018"
        stroke={`${color}20`}
        strokeWidth={0.8}
      />
      {/* Cabinet base — right face */}
      <path
        d="M72 72 L72 80 L50 92 L50 84 Z"
        fill="#0a1420"
        stroke={`${color}20`}
        strokeWidth={0.8}
      />
      {/* Cabinet tall body — left face */}
      <path
        d="M28 36 L28 72 L50 84 L50 48 Z"
        fill="#0d1825"
        stroke={`${color}40`}
        strokeWidth={0.8}
      />
      {/* Cabinet tall body — right face */}
      <path
        d="M72 36 L72 72 L50 84 L50 48 Z"
        fill="#101e2c"
        stroke={`${color}40`}
        strokeWidth={0.8}
      />
      {/* Cabinet tall body — top face */}
      <path
        d="M28 36 L50 24 L72 36 L50 48 Z"
        fill="#132030"
        stroke={color}
        strokeWidth={1.5}
      />
      {/* HMI Screen face */}
      <path
        d="M30 38 L50 28 L70 38 L50 48 Z"
        fill="#0a1820"
        stroke="#38bdf8"
        strokeWidth={1}
      />
      {/* Screen content (graph) */}
      <path
        d="M36 39 L50 32 L64 39 L50 46 Z"
        fill="#061018"
        stroke="#38bdf8"
        strokeWidth={0.5}
      />
      <polyline
        points="39,43 43,40 47,42 51,38 55,41 59,39 63,42"
        fill="none"
        stroke="#38bdf8"
        strokeWidth={1}
        strokeLinecap="round"
      />
      {/* Control buttons on left face */}
      <circle
        cx={35}
        cy={55}
        r={2.5}
        fill="#22c55e"
        stroke="#4ade80"
        strokeWidth={0.5}
      />
      <circle
        cx={35}
        cy={62}
        r={2.5}
        fill="#1a2530"
        stroke="#38bdf840"
        strokeWidth={0.5}
      />
      <circle
        cx={35}
        cy={69}
        r={2.5}
        fill={color}
        stroke={`${color}80`}
        strokeWidth={0.5}
      />
      {/* LED strip on right face */}
      <rect x={62} y={52} width={4} height={2.5} rx={1} fill="#22c55e" />
      <rect x={62} y={57} width={4} height={2.5} rx={1} fill="#22c55e" />
      <rect x={62} y={62} width={4} height={2.5} rx={1} fill={color} />
      {/* Status glow ring — inner */}
      <ellipse
        cx={50}
        cy={91}
        rx={22}
        ry={8}
        fill="none"
        stroke={color}
        strokeWidth={selected ? 2.5 : 1.5}
        opacity={0.8}
        className={cn(isAlarm && 'animate-pulse')}
      />
      {/* Status glow ring — outer */}
      <ellipse
        cx={50}
        cy={91}
        rx={34}
        ry={13}
        fill="none"
        stroke={color}
        strokeWidth={5}
        opacity={isAlarm || isWarning ? 0.2 : 0.1}
        className={cn((isAlarm || isWarning) && 'animate-pulse')}
      />
    </g>
  )
}
```

- [ ] **Step 9: Run test — expect PASS**

```bash
pnpm --filter client test -- --testPathPattern=machines
```

Expected: 25 tests pass (5 components × 4 statuses + 5 selected tests).

- [ ] **Step 10: Commit**

```bash
git add apps/client/app/\(default\)/dashboard/components/machines/
git add apps/client/app/\(default\)/dashboard/components/__tests__/machines.test.tsx
git commit -m "feat(dashboard): add 5 isometric machine SVG components"
```

---

## Task 3: MachineNode Component

**Files:**

- Create: `app/(default)/dashboard/components/machine-node.tsx`
- Test: `app/(default)/dashboard/components/__tests__/machine-node.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// app/(default)/dashboard/components/__tests__/machine-node.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { MachineNode } from '../machine-node'

describe('MachineNode SVG picker', () => {
  const base = {
    label: 'TEST-01',
    isoX: 100,
    isoY: 100,
    selected: false,
    onClick: vi.fn(),
  }

  it('sensor type → renders SensorSvg (antenna path present)', () => {
    const { container } = render(
      <svg>
        <MachineNode {...base} type="sensor" icon={undefined} status="normal" />
      </svg>,
    )
    // SensorSvg has a unique arc path for signal rings
    const paths = container.querySelectorAll('path')
    expect(paths.length).toBeGreaterThan(0)
  })

  it('controller type → renders ControllerSvg (polyline graph present)', () => {
    const { container } = render(
      <svg>
        <MachineNode
          {...base}
          type="controller"
          icon={undefined}
          status="normal"
        />
      </svg>,
    )
    expect(container.querySelector('polyline')).not.toBeNull()
  })

  it('machine type + icon=arm → renders RobotArmSvg (lines for gripper present)', () => {
    const { container } = render(
      <svg>
        <MachineNode {...base} type="machine" icon="arm" status="warning" />
      </svg>,
    )
    const lines = container.querySelectorAll('line')
    expect(lines.length).toBeGreaterThan(0)
  })

  it('machine type + no icon → renders CncMachineSvg (polygon tool bit present)', () => {
    const { container } = render(
      <svg>
        <MachineNode {...base} type="machine" icon={undefined} status="alarm" />
      </svg>,
    )
    expect(container.querySelector('polygon')).not.toBeNull()
  })

  it('renders label text', () => {
    const { getByText } = render(
      <svg>
        <MachineNode {...base} type="sensor" icon={undefined} status="normal" />
      </svg>,
    )
    expect(getByText('TEST-01')).not.toBeNull()
  })

  it('selected node renders with larger font weight on label', () => {
    const { container } = render(
      <svg>
        <MachineNode
          {...base}
          selected
          type="sensor"
          icon={undefined}
          status="normal"
        />
      </svg>,
    )
    expect(container.querySelector('g')).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm --filter client test -- --testPathPattern=machine-node
```

Expected: `Cannot find module '../machine-node'`

- [ ] **Step 3: Implement**

```tsx
// app/(default)/dashboard/components/machine-node.tsx
import { CncMachineSvg } from './machines/cnc-machine'
import { RobotArmSvg } from './machines/robot-arm'
import { SensorSvg } from './machines/sensor'
import { ConveyorSvg } from './machines/conveyor'
import { ControllerSvg } from './machines/controller'
import { type NodeStatus } from './machines/status-colors'

interface MachineNodeProps {
  type: 'machine' | 'sensor' | 'controller'
  icon: string | undefined
  status: NodeStatus
  label: string
  isoX: number
  isoY: number
  selected: boolean
  onClick: () => void
}

function pickMachineSvg(
  type: MachineNodeProps['type'],
  icon: string | undefined,
  status: NodeStatus,
  selected: boolean,
) {
  if (type === 'sensor')
    return <SensorSvg status={status} selected={selected} />
  if (type === 'controller')
    return <ControllerSvg status={status} selected={selected} />
  if (icon === 'arm') return <RobotArmSvg status={status} selected={selected} />
  if (icon === 'conveyor')
    return <ConveyorSvg status={status} selected={selected} />
  return <CncMachineSvg status={status} selected={selected} />
}

export function MachineNode({
  type,
  icon,
  status,
  label,
  isoX,
  isoY,
  selected,
  onClick,
}: MachineNodeProps) {
  return (
    <g
      transform={`translate(${isoX - 50}, ${isoY - 70})`}
      onClick={onClick}
      style={{ cursor: 'pointer' }}
    >
      {pickMachineSvg(type, icon, status, selected)}
      <text
        x={50}
        y={100}
        textAnchor="middle"
        fontSize={selected ? 8 : 7}
        fontWeight={selected ? 700 : 600}
        fill={selected ? '#e2e8f0' : '#94a3b8'}
        fontFamily="monospace"
      >
        {label}
      </text>
    </g>
  )
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
pnpm --filter client test -- --testPathPattern=machine-node
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/client/app/\(default\)/dashboard/components/machine-node.tsx \
        apps/client/app/\(default\)/dashboard/components/__tests__/machine-node.test.tsx
git commit -m "feat(dashboard): add MachineNode SVG picker component"
```

---

## Task 4: IsometricMap Component

**Files:**

- Create: `app/(default)/dashboard/components/isometric-map.tsx`
- Test: `app/(default)/dashboard/components/__tests__/isometric-map.test.tsx`

Reference types used below — from `apps/client/types/index.ts` (`Workspace`) and `apps/client/services/canvas.ts` (`CanvasNode`).

- [ ] **Step 1: Write the failing test**

```tsx
// app/(default)/dashboard/components/__tests__/isometric-map.test.tsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { IsometricMap } from '../isometric-map'
import type { Workspace } from '@/types'
import type { CanvasNode } from '@/services/canvas'

const mockWorkspaces: Workspace[] = [
  {
    id: 'ws1',
    ownerId: 'u1',
    name: 'Zone A',
    color: 'blue',
    icon: 'building',
    createdAt: '',
    updatedAt: '',
    _count: { members: 1, models: 0 },
    modelsCount: 0,
  },
  {
    id: 'ws2',
    ownerId: 'u1',
    name: 'Zone B',
    color: 'emerald',
    icon: 'cpu',
    createdAt: '',
    updatedAt: '',
    _count: { members: 1, models: 0 },
    modelsCount: 0,
  },
]

const mockNodes: CanvasNode[] = [
  {
    id: 'n1',
    workspaceId: 'ws1',
    data: { name: 'CNC-001', type: 'machine', status: 'alarm', x: 100, y: 100 },
    models: [],
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'n2',
    workspaceId: 'ws1',
    data: {
      name: 'SENSOR-01',
      type: 'sensor',
      status: 'normal',
      x: 200,
      y: 200,
    },
    models: [],
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'n3',
    workspaceId: 'ws2',
    data: {
      name: 'CTRL-01',
      type: 'controller',
      status: 'normal',
      x: 100,
      y: 100,
    },
    models: [],
    createdAt: '',
    updatedAt: '',
  },
]

describe('IsometricMap', () => {
  it('renders an SVG element', () => {
    const { container } = render(
      <IsometricMap
        workspaces={mockWorkspaces}
        nodes={mockNodes}
        selectedWorkspaceId={null}
        selectedNodeId={null}
        onNodeClick={vi.fn()}
      />,
    )
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('renders a zone label for each workspace', () => {
    const { getByText } = render(
      <IsometricMap
        workspaces={mockWorkspaces}
        nodes={mockNodes}
        selectedWorkspaceId={null}
        selectedNodeId={null}
        onNodeClick={vi.fn()}
      />,
    )
    expect(getByText('Zone A')).not.toBeNull()
    expect(getByText('Zone B')).not.toBeNull()
  })

  it('renders a MachineNode for each node', () => {
    const { getByText } = render(
      <IsometricMap
        workspaces={mockWorkspaces}
        nodes={mockNodes}
        selectedWorkspaceId={null}
        selectedNodeId={null}
        onNodeClick={vi.fn()}
      />,
    )
    expect(getByText('CNC-001')).not.toBeNull()
    expect(getByText('SENSOR-01')).not.toBeNull()
    expect(getByText('CTRL-01')).not.toBeNull()
  })

  it('calls onNodeClick with nodeId when node is clicked', async () => {
    const onNodeClick = vi.fn()
    const { getByText } = render(
      <IsometricMap
        workspaces={mockWorkspaces}
        nodes={mockNodes}
        selectedWorkspaceId={null}
        selectedNodeId={null}
        onNodeClick={onNodeClick}
      />,
    )
    getByText('CNC-001')
      .closest('g')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onNodeClick).toHaveBeenCalledWith('n1')
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm --filter client test -- --testPathPattern=isometric-map
```

Expected: `Cannot find module '../isometric-map'`

- [ ] **Step 3: Implement**

```tsx
// app/(default)/dashboard/components/isometric-map.tsx
import { useMemo } from 'react'
import { MachineNode } from './machine-node'
import { projectToIso, getZoneOffset } from './project-coords'
import { workspaceColors } from '@/store/workspace'
import type { Workspace } from '@/types'
import type { CanvasNode } from '@/services/canvas'

const VIEWPORT_W = 700
const VIEWPORT_H = 420
const CX = VIEWPORT_W / 2
const CY = VIEWPORT_H / 2 - 20

interface IsometricMapProps {
  workspaces: Workspace[]
  nodes: CanvasNode[]
  selectedWorkspaceId: string | null
  selectedNodeId: string | null
  onNodeClick: (nodeId: string) => void
}

function getZoneFloorPath(offsetX: number, offsetY: number): string {
  // Isometric parallelogram zone floor from four corners at (±100, ±50) iso
  const corners = [
    [0, 0],
    [200, 0],
    [200, 100],
    [0, 100],
  ].map(([x, y]) => {
    const isoX = (x - y) * Math.cos(Math.PI / 6) + CX + offsetX * 0.7
    const isoY = (x + y) * Math.sin(Math.PI / 6) * 0.5 + CY + offsetY * 0.5
    return `${isoX},${isoY}`
  })
  return `M ${corners[0]} L ${corners[1]} L ${corners[2]} L ${corners[3]} Z`
}

export function IsometricMap({
  workspaces,
  nodes,
  selectedWorkspaceId,
  selectedNodeId,
  onNodeClick,
}: IsometricMapProps) {
  const nodesByWorkspace = useMemo(() => {
    const map = new Map<string, CanvasNode[]>()
    for (const node of nodes) {
      const arr = map.get(node.workspaceId) ?? []
      arr.push(node)
      map.set(node.workspaceId, arr)
    }
    return map
  }, [nodes])

  const projectedNodes = useMemo(() => {
    return workspaces.flatMap((ws, wsIndex) => {
      const wsNodes = nodesByWorkspace.get(ws.id) ?? []
      if (wsNodes.length === 0) return []

      const xs = wsNodes.map(n => n.data.x)
      const ys = wsNodes.map(n => n.data.y)
      const minX = Math.min(...xs)
      const maxX = Math.max(...xs)
      const minY = Math.min(...ys)
      const maxY = Math.max(...ys)

      const zoneOffset = getZoneOffset(wsIndex)

      return wsNodes.map(node => {
        const pt = projectToIso(
          node.data.x,
          node.data.y,
          minX,
          maxX,
          minY,
          maxY,
          zoneOffset.x,
          zoneOffset.y,
          CX,
          CY,
        )
        return { node, isoX: pt.x, isoY: pt.y, wsIndex }
      })
    })
  }, [workspaces, nodesByWorkspace])

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${VIEWPORT_W} ${VIEWPORT_H}`}
      className="w-full h-full"
      style={{
        background:
          'radial-gradient(ellipse at 50% 40%, #0e1520 0%, #080a0f 80%)',
      }}
    >
      {/* Zone floors */}
      {workspaces.map((ws, i) => {
        const zoneOffset = getZoneOffset(i)
        const accentColor =
          workspaceColors.find(c => c.id === ws.color)?.bg ?? 'bg-blue-500'
        // Extract hex-ish color from bg- class for SVG stroke — fallback to blue
        const strokeColor =
          selectedWorkspaceId === ws.id ? '#3b82f6' : '#1e2230'
        const floorPath = getZoneFloorPath(
          zoneOffset.x - VIEWPORT_W / 2,
          zoneOffset.y - VIEWPORT_H / 2 + 20,
        )

        return (
          <g key={ws.id}>
            <path
              d={floorPath}
              fill={
                selectedWorkspaceId === ws.id
                  ? 'rgba(59,130,246,0.05)'
                  : 'rgba(14,20,35,0.6)'
              }
              stroke={strokeColor}
              strokeWidth={selectedWorkspaceId === ws.id ? 2 : 1}
              strokeDasharray={selectedWorkspaceId === ws.id ? '0' : '8,5'}
            />
            {/* Zone label — positioned above the floor's top vertex */}
            <ZoneLabel ws={ws} zoneOffset={zoneOffset} />
          </g>
        )
      })}

      {/* Machine nodes — rendered after zones so they sit on top */}
      {projectedNodes.map(({ node, isoX, isoY }) => (
        <MachineNode
          key={node.id}
          type={node.data.type}
          icon={node.data.icon}
          status={node.data.status}
          label={node.data.name}
          isoX={isoX}
          isoY={isoY}
          selected={selectedNodeId === node.id}
          onClick={() => onNodeClick(node.id)}
        />
      ))}
    </svg>
  )
}

function ZoneLabel({
  ws,
  zoneOffset,
}: {
  ws: Workspace
  zoneOffset: { x: number; y: number }
}) {
  // Label sits above the floor's top vertex
  const labelX = CX + (zoneOffset.x - (VIEWPORT_W / 2 - 100)) * 0.4
  const labelY = CY + (zoneOffset.y - (VIEWPORT_H / 2 - 20)) * 0.3 - 20
  return (
    <text
      x={labelX}
      y={labelY}
      textAnchor="middle"
      fontSize={9}
      fontWeight={700}
      fill="#1e3a6e"
      letterSpacing={3}
      fontFamily="monospace"
      style={{ textTransform: 'uppercase' }}
    >
      {ws.name.toUpperCase()}
    </text>
  )
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
pnpm --filter client test -- --testPathPattern=isometric-map
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/client/app/\(default\)/dashboard/components/isometric-map.tsx \
        apps/client/app/\(default\)/dashboard/components/__tests__/isometric-map.test.tsx
git commit -m "feat(dashboard): add IsometricMap SVG canvas with zone floors and node placement"
```

---

## Task 5: WorkspaceSidebar Component

**Files:**

- Create: `app/(default)/dashboard/components/workspace-sidebar.tsx`
- Test: `app/(default)/dashboard/components/__tests__/workspace-sidebar.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// app/(default)/dashboard/components/__tests__/workspace-sidebar.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { WorkspaceSidebar } from '../workspace-sidebar'
import type { Workspace } from '@/types'

const mockWorkspaces: Workspace[] = [
  {
    id: 'ws1',
    ownerId: 'u1',
    name: 'Zone A',
    color: 'blue',
    icon: 'building',
    alarmCount: 2,
    status: 'alarm',
    nodeCount: 4,
    createdAt: '',
    updatedAt: '',
    _count: { members: 1, models: 0 },
    modelsCount: 0,
  },
  {
    id: 'ws2',
    ownerId: 'u1',
    name: 'Zone B',
    color: 'emerald',
    icon: 'cpu',
    alarmCount: 0,
    status: 'normal',
    nodeCount: 3,
    createdAt: '',
    updatedAt: '',
    _count: { members: 1, models: 0 },
    modelsCount: 0,
  },
]

describe('WorkspaceSidebar', () => {
  it('renders workspace names', () => {
    const { getByText } = render(
      <WorkspaceSidebar
        workspaces={mockWorkspaces}
        selectedWorkspaceId={null}
        onSelectWorkspace={vi.fn()}
        statusFilter={null}
        onStatusFilter={vi.fn()}
      />,
    )
    expect(getByText('Zone A')).not.toBeNull()
    expect(getByText('Zone B')).not.toBeNull()
  })

  it('calls onSelectWorkspace with workspace id on click', () => {
    const onSelect = vi.fn()
    const { getByText } = render(
      <WorkspaceSidebar
        workspaces={mockWorkspaces}
        selectedWorkspaceId={null}
        onSelectWorkspace={onSelect}
        statusFilter={null}
        onStatusFilter={vi.fn()}
      />,
    )
    fireEvent.click(getByText('Zone A').closest('[data-ws]')!)
    expect(onSelect).toHaveBeenCalledWith('ws1')
  })

  it('highlights selected workspace', () => {
    const { container } = render(
      <WorkspaceSidebar
        workspaces={mockWorkspaces}
        selectedWorkspaceId="ws1"
        onSelectWorkspace={vi.fn()}
        statusFilter={null}
        onStatusFilter={vi.fn()}
      />,
    )
    const items = container.querySelectorAll('[data-ws]')
    expect(items[0].className).toContain('border-primary')
  })

  it('calls onStatusFilter when alarm filter clicked', () => {
    const onFilter = vi.fn()
    const { getByText } = render(
      <WorkspaceSidebar
        workspaces={mockWorkspaces}
        selectedWorkspaceId={null}
        onSelectWorkspace={vi.fn()}
        statusFilter={null}
        onStatusFilter={onFilter}
      />,
    )
    fireEvent.click(getByText(/Alarm/))
    expect(onFilter).toHaveBeenCalledWith('alarm')
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm --filter client test -- --testPathPattern=workspace-sidebar
```

- [ ] **Step 3: Implement**

```tsx
// app/(default)/dashboard/components/workspace-sidebar.tsx
'use client'
import { cn } from '@/lib/utils'
import { workspaceColors, workspaceIcons } from '@/store/workspace'
import type { Workspace } from '@/types'
import type { NodeStatus } from './machines/status-colors'

const STATUS_DOT: Record<NonNullable<Workspace['status']>, string> = {
  alarm: 'bg-red-500 shadow-[0_0_6px_#ef4444]',
  warning: 'bg-amber-500 shadow-[0_0_6px_#f59e0b]',
  normal: 'bg-emerald-500',
  offline: 'bg-zinc-500',
}

const FILTER_ITEMS: { status: NodeStatus; label: string; dotClass: string }[] =
  [
    { status: 'alarm', label: 'Alarm', dotClass: 'bg-red-500' },
    { status: 'warning', label: 'Warning', dotClass: 'bg-amber-500' },
    { status: 'normal', label: 'Normal', dotClass: 'bg-emerald-500' },
  ]

interface WorkspaceSidebarProps {
  workspaces: Workspace[]
  selectedWorkspaceId: string | null
  onSelectWorkspace: (id: string) => void
  statusFilter: NodeStatus | null
  onStatusFilter: (status: NodeStatus | null) => void
}

export function WorkspaceSidebar({
  workspaces,
  selectedWorkspaceId,
  onSelectWorkspace,
  statusFilter,
  onStatusFilter,
}: WorkspaceSidebarProps) {
  const alarmCount = workspaces.reduce(
    (sum, ws) => sum + (ws.alarmCount ?? 0),
    0,
  )

  return (
    <aside className="flex w-40 flex-shrink-0 flex-col border-r border-border bg-[#0a0d14]">
      <div className="px-3 pt-3 pb-1 text-[8px] font-semibold uppercase tracking-widest text-muted-foreground/50">
        Workspaces
      </div>

      <div className="flex flex-col">
        {workspaces.map(ws => {
          const accentBg =
            workspaceColors.find(c => c.id === ws.color)?.bg ?? 'bg-blue-500'
          const IconComp = workspaceIcons.find(i => i.id === ws.icon)?.icon
          const isActive = selectedWorkspaceId === ws.id
          const dotClass = ws.status ? STATUS_DOT[ws.status] : 'bg-zinc-500'

          return (
            <div
              key={ws.id}
              data-ws={ws.id}
              onClick={() => onSelectWorkspace(ws.id)}
              className={cn(
                'flex cursor-pointer items-center gap-2 border-l-2 px-3 py-1.5 transition-colors',
                isActive
                  ? 'border-primary bg-primary/8'
                  : 'border-transparent hover:bg-muted/20',
              )}
            >
              <div
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px]',
                  accentBg,
                  'bg-opacity-20',
                )}
              >
                {IconComp && <IconComp className="h-3 w-3" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[10px] font-semibold text-foreground/80">
                  {ws.name}
                </div>
                <div className="text-[8px] text-muted-foreground">
                  {ws.nodeCount ?? 0} devices
                </div>
              </div>
              <span className={cn('h-2 w-2 shrink-0 rounded-full', dotClass)} />
            </div>
          )
        })}
      </div>

      <div className="mx-3 my-2 border-t border-border" />
      <div className="px-3 pb-1 text-[8px] text-muted-foreground/50">
        Filter by Status
      </div>

      {FILTER_ITEMS.map(({ status, label, dotClass }) => {
        const count = status === 'alarm' ? alarmCount : undefined
        const isActive = statusFilter === status
        return (
          <button
            key={status}
            onClick={() => onStatusFilter(isActive ? null : status)}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 text-left text-[9px] transition-colors',
              isActive
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground/70',
            )}
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', dotClass)} />
            {label}
            {count !== undefined && count > 0 && (
              <span className="ml-auto text-[8px] text-destructive">
                ({count})
              </span>
            )}
          </button>
        )
      })}

      <div className="flex-1" />
    </aside>
  )
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
pnpm --filter client test -- --testPathPattern=workspace-sidebar
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/client/app/\(default\)/dashboard/components/workspace-sidebar.tsx \
        apps/client/app/\(default\)/dashboard/components/__tests__/workspace-sidebar.test.tsx
git commit -m "feat(dashboard): add WorkspaceSidebar with workspace list and status filters"
```

---

## Task 6: NodeDetailPanel Component

**Files:**

- Create: `app/(default)/dashboard/components/node-detail-panel.tsx`
- Test: `app/(default)/dashboard/components/__tests__/node-detail-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// app/(default)/dashboard/components/__tests__/node-detail-panel.test.tsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { NodeDetailPanel } from '../node-detail-panel'
import type { CanvasNode } from '@/services/canvas'

const mockNode: CanvasNode = {
  id: 'n1',
  workspaceId: 'ws1',
  data: { name: 'CNC-001', type: 'machine', status: 'alarm', x: 100, y: 100 },
  models: [
    { id: 'm1', name: 'AnomalyDetect v2', data: null, nodesId: 'n1' },
    { id: 'm2', name: 'VibrationFFT', data: null, nodesId: 'n1' },
  ],
  createdAt: '2026-06-08T00:00:00Z',
  updatedAt: '2026-06-08T00:00:00Z',
}

describe('NodeDetailPanel', () => {
  it('shows empty state when no node selected', () => {
    const { getByText } = render(
      <NodeDetailPanel node={null} workspaceId={null} />,
    )
    expect(getByText(/select a device/i)).not.toBeNull()
  })

  it('shows node name when node selected', () => {
    const { getByText } = render(
      <NodeDetailPanel node={mockNode} workspaceId="ws1" />,
    )
    expect(getByText('CNC-001')).not.toBeNull()
  })

  it('shows AI model names', () => {
    const { getByText } = render(
      <NodeDetailPanel node={mockNode} workspaceId="ws1" />,
    )
    expect(getByText('AnomalyDetect v2')).not.toBeNull()
    expect(getByText('VibrationFFT')).not.toBeNull()
  })

  it('shows alarm status chip for alarm node', () => {
    const { getByText } = render(
      <NodeDetailPanel node={mockNode} workspaceId="ws1" />,
    )
    expect(getByText(/alarm/i)).not.toBeNull()
  })

  it('shows "View Details" CTA linking to workspace canvas', () => {
    const { container } = render(
      <NodeDetailPanel node={mockNode} workspaceId="ws1" />,
    )
    const link = container.querySelector('a[href*="ws1/canvas"]')
    expect(link).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm --filter client test -- --testPathPattern=node-detail-panel
```

- [ ] **Step 3: Implement**

```tsx
// app/(default)/dashboard/components/node-detail-panel.tsx
import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { CanvasNode } from '@/services/canvas'
import type { NodeStatus } from './machines/status-colors'

const STATUS_CHIP: Record<NodeStatus, string> = {
  normal: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
  warning: 'bg-amber-500/15 text-amber-400 border border-amber-500/30',
  alarm: 'bg-red-500/15 text-red-400 border border-red-500/30',
  offline: 'bg-zinc-500/15 text-zinc-400 border border-zinc-500/30',
}

// CanvasModel has no status field — models are shown by name only (assigned = active)

interface NodeDetailPanelProps {
  node: CanvasNode | null
  workspaceId: string | null
}

export function NodeDetailPanel({ node, workspaceId }: NodeDetailPanelProps) {
  if (!node) {
    return (
      <aside className="flex w-[200px] shrink-0 flex-col items-center justify-center border-l border-border bg-[#0a0d14] text-center">
        <p className="text-[11px] text-muted-foreground/40">
          Select a device on the map
        </p>
      </aside>
    )
  }

  const status = node.data.status as NodeStatus

  return (
    <aside className="flex w-[200px] shrink-0 flex-col border-l border-border bg-[#0a0d14]">
      {/* Header */}
      <div className="border-b border-border bg-[#0d1018] px-3.5 py-3">
        <div className="mb-0.5 text-[9px] text-muted-foreground/50">
          {node.data.type}
        </div>
        <div className="mb-2 text-sm font-bold text-foreground">
          {node.data.name}
        </div>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase',
            STATUS_CHIP[status],
          )}
        >
          {status}
        </span>
      </div>

      {/* AI Models */}
      <div className="border-b border-border/50 px-3.5 py-2.5">
        <div className="mb-1.5 text-[8px] font-semibold uppercase tracking-wider text-muted-foreground/40">
          AI Models
        </div>
        {node.models.length === 0 ? (
          <p className="text-[9px] text-muted-foreground/30">
            No models assigned
          </p>
        ) : (
          node.models.map(model => (
            <div key={model.id} className="flex items-center gap-1.5 py-1">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
              <span className="flex-1 truncate text-[9px] text-muted-foreground">
                {model.name}
              </span>
              <span className="text-[8px] text-emerald-400">active</span>
            </div>
          ))
        )}
      </div>

      {/* Last updated */}
      <div className="border-b border-border/50 px-3.5 py-2.5">
        <div className="mb-1 text-[8px] font-semibold uppercase tracking-wider text-muted-foreground/40">
          Last Updated
        </div>
        <div className="text-[9px] text-muted-foreground">
          {new Date(node.updatedAt).toLocaleString()}
        </div>
      </div>

      {/* CTAs */}
      <div className="mt-auto px-3.5 py-3">
        {workspaceId && (
          <Link
            href={`/workspaces/${workspaceId}/canvas`}
            className="mb-1.5 block rounded-md bg-primary py-2 text-center text-[10px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            View Details →
          </Link>
        )}
        <button
          className="block w-full rounded-md border border-border bg-muted/20 py-1.5 text-center text-[9px] text-muted-foreground transition-colors hover:text-foreground"
          disabled
        >
          Acknowledge Alarm
        </button>
      </div>
    </aside>
  )
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
pnpm --filter client test -- --testPathPattern=node-detail-panel
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/client/app/\(default\)/dashboard/components/node-detail-panel.tsx \
        apps/client/app/\(default\)/dashboard/components/__tests__/node-detail-panel.test.tsx
git commit -m "feat(dashboard): add NodeDetailPanel with AI models and CTA"
```

---

## Task 7: DashboardHeader + MachineLegend

**Files:**

- Create: `app/(default)/dashboard/components/dashboard-header.tsx`
- Create: `app/(default)/dashboard/components/machine-legend.tsx`
- Test: `app/(default)/dashboard/components/__tests__/dashboard-header.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// app/(default)/dashboard/components/__tests__/dashboard-header.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { DashboardHeader } from '../dashboard-header'

describe('DashboardHeader', () => {
  it('shows "All Systems Healthy" when alarmCount is 0', () => {
    const { getByText } = render(
      <DashboardHeader alarmCount={0} searchQuery="" onSearch={vi.fn()} />,
    )
    expect(getByText(/all systems healthy/i)).not.toBeNull()
  })

  it('shows alarm count when alarmCount > 0', () => {
    const { getByText } = render(
      <DashboardHeader alarmCount={3} searchQuery="" onSearch={vi.fn()} />,
    )
    expect(getByText(/3 active alarm/i)).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm --filter client test -- --testPathPattern=dashboard-header
```

- [ ] **Step 3: Create dashboard-header.tsx**

```tsx
// app/(default)/dashboard/components/dashboard-header.tsx
'use client'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DashboardHeaderProps {
  alarmCount: number
  searchQuery: string
  onSearch: (q: string) => void
}

export function DashboardHeader({
  alarmCount,
  searchQuery,
  onSearch,
}: DashboardHeaderProps) {
  const isHealthy = alarmCount === 0

  return (
    <header className="flex items-center gap-3 border-b border-border bg-[#0a0d14] px-4 py-2">
      <span className="text-[11px] font-extrabold uppercase tracking-widest text-primary">
        SoftSensor
      </span>

      <div className="flex max-w-[220px] flex-1 items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-1.5 text-[9px] text-muted-foreground">
        <Search className="h-3 w-3 shrink-0" />
        <input
          type="text"
          value={searchQuery}
          onChange={e => onSearch(e.target.value)}
          placeholder="Search devices, zones..."
          className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground/50"
        />
      </div>

      <div
        className={cn(
          'flex items-center gap-1.5 rounded-full border px-3 py-1 text-[9px] font-semibold',
          isHealthy
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
            : 'border-red-500/30 bg-red-500/10 text-red-400',
        )}
      >
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            isHealthy ? 'bg-emerald-500' : cn('bg-red-500', 'animate-pulse'),
          )}
        />
        {isHealthy
          ? 'All Systems Healthy'
          : `${alarmCount} Active Alarm${alarmCount > 1 ? 's' : ''}`}
      </div>

      <div className="ml-auto flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-primary to-violet-600 text-[9px] font-bold text-white">
        DT
      </div>
    </header>
  )
}
```

- [ ] **Step 4: Create machine-legend.tsx**

```tsx
// app/(default)/dashboard/components/machine-legend.tsx
import { cn } from '@/lib/utils'

const MACHINE_TYPES = [
  { label: 'CNC Machine', icon: '⚙' },
  { label: 'Robot Arm', icon: '🦾' },
  { label: 'Sensor', icon: '📡' },
  { label: 'Conveyor', icon: '▬' },
  { label: 'Controller', icon: '🖥' },
]

const STATUS_KEYS = [
  { status: 'Alarm', dotClass: 'bg-red-500' },
  { status: 'Warning', dotClass: 'bg-amber-500' },
  { status: 'Normal', dotClass: 'bg-emerald-500' },
  { status: 'Offline', dotClass: 'bg-zinc-500' },
]

export function MachineLegend() {
  return (
    <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border bg-[#0a0d14] px-4 py-2">
      {MACHINE_TYPES.map(({ label, icon }) => (
        <span
          key={label}
          className="flex items-center gap-1 text-[8px] text-muted-foreground/50"
        >
          <span>{icon}</span>
          {label}
        </span>
      ))}
      <div className="ml-auto flex items-center gap-3">
        {STATUS_KEYS.map(({ status, dotClass }) => (
          <span
            key={status}
            className="flex items-center gap-1 text-[8px] text-muted-foreground/50"
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', dotClass)} />
            {status}
          </span>
        ))}
      </div>
    </footer>
  )
}
```

- [ ] **Step 5: Run test — expect PASS**

```bash
pnpm --filter client test -- --testPathPattern=dashboard-header
```

Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/client/app/\(default\)/dashboard/components/dashboard-header.tsx \
        apps/client/app/\(default\)/dashboard/components/machine-legend.tsx \
        apps/client/app/\(default\)/dashboard/components/__tests__/dashboard-header.test.tsx
git commit -m "feat(dashboard): add DashboardHeader global status badge and MachineLegend"
```

---

## Task 8: useDashboardData Hook

**Files:**

- Create: `app/(default)/dashboard/components/use-dashboard-data.ts`
- Test: `app/(default)/dashboard/components/__tests__/use-dashboard-data.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// app/(default)/dashboard/components/__tests__/use-dashboard-data.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useDashboardData } from '../use-dashboard-data'

// Mock getNodes
vi.mock('@/services/canvas', () => ({
  getNodes: vi.fn(),
}))

// Mock workspacesAtom — return 2 workspaces
vi.mock('jotai', async () => {
  const actual = await vi.importActual<typeof import('jotai')>('jotai')
  return {
    ...actual,
    useAtomValue: vi.fn(() => [
      {
        id: 'ws1',
        name: 'Zone A',
        status: 'alarm',
        alarmCount: 1,
        nodeCount: 2,
      },
      {
        id: 'ws2',
        name: 'Zone B',
        status: 'normal',
        alarmCount: 0,
        nodeCount: 1,
      },
    ]),
  }
})

import { getNodes } from '@/services/canvas'

describe('useDashboardData', () => {
  beforeEach(() => {
    vi.mocked(getNodes).mockResolvedValue([])
  })

  it('calls getNodes for each workspace', async () => {
    renderHook(() => useDashboardData())
    await waitFor(() => {
      expect(getNodes).toHaveBeenCalledWith('ws1')
      expect(getNodes).toHaveBeenCalledWith('ws2')
    })
  })

  it('returns workspaces from atom', async () => {
    const { result } = renderHook(() => useDashboardData())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.workspaces).toHaveLength(2)
  })

  it('returns combined nodes from all workspaces', async () => {
    vi.mocked(getNodes).mockImplementation(async wsId => {
      if (wsId === 'ws1')
        return [
          {
            id: 'n1',
            workspaceId: 'ws1',
            data: {
              name: 'CNC-001',
              type: 'machine',
              status: 'alarm',
              x: 0,
              y: 0,
            },
            models: [],
            createdAt: '',
            updatedAt: '',
          },
        ]
      return []
    })
    const { result } = renderHook(() => useDashboardData())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.nodes).toHaveLength(1)
    expect(result.current.nodes[0].id).toBe('n1')
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm --filter client test -- --testPathPattern=use-dashboard-data
```

- [ ] **Step 3: Implement**

```ts
// app/(default)/dashboard/components/use-dashboard-data.ts
'use client'
import { useAtomValue } from 'jotai'
import { useEffect, useState } from 'react'
import { getNodes } from '@/services/canvas'
import { workspacesAtom } from '@/store/workspace'
import type { CanvasNode } from '@/services/canvas'
import type { Workspace } from '@/types'

interface DashboardData {
  workspaces: Workspace[]
  nodes: CanvasNode[]
  loading: boolean
  error: string | null
}

export function useDashboardData(): DashboardData {
  const workspaces = useAtomValue(workspacesAtom)
  const [nodes, setNodes] = useState<CanvasNode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (workspaces.length === 0) {
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)

    Promise.all(workspaces.map(ws => getNodes(ws.id)))
      .then(results => {
        if (cancelled) return
        setNodes(results.flat())
        setError(null)
      })
      .catch(() => {
        if (cancelled) return
        setError('Failed to load device data')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [workspaces])

  return { workspaces, nodes, loading, error }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
pnpm --filter client test -- --testPathPattern=use-dashboard-data
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/client/app/\(default\)/dashboard/components/use-dashboard-data.ts \
        apps/client/app/\(default\)/dashboard/components/__tests__/use-dashboard-data.test.ts
git commit -m "feat(dashboard): add useDashboardData hook for parallel workspace node fetching"
```

---

## Task 9: DashboardPage + Route Files

**Files:**

- Create: `app/(default)/dashboard/page.tsx`
- Create: `app/(default)/dashboard/loading.tsx`
- Create: `app/(default)/dashboard/error.tsx`
- Test: `app/(default)/dashboard/components/__tests__/dashboard-page.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// app/(default)/dashboard/components/__tests__/dashboard-page.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

// Mock the data hook so we don't need real API calls
vi.mock('../use-dashboard-data', () => ({
  useDashboardData: vi.fn(() => ({
    workspaces: [
      {
        id: 'ws1',
        name: 'Zone A',
        status: 'alarm',
        alarmCount: 1,
        nodeCount: 1,
        color: 'blue',
        icon: 'building',
        createdAt: '',
        updatedAt: '',
        _count: { members: 1, models: 0 },
        modelsCount: 0,
      },
    ],
    nodes: [
      {
        id: 'n1',
        workspaceId: 'ws1',
        data: {
          name: 'CNC-001',
          type: 'machine',
          status: 'alarm',
          x: 100,
          y: 100,
        },
        models: [],
        createdAt: '',
        updatedAt: '',
      },
    ],
    loading: false,
    error: null,
  })),
}))

// DashboardPage is in parent directory, import relatively
import DashboardPage from '../../page'

describe('DashboardPage', () => {
  it('renders without crashing', () => {
    const { container } = render(<DashboardPage />)
    expect(container.firstChild).not.toBeNull()
  })

  it('renders the sidebar', () => {
    const { getByText } = render(<DashboardPage />)
    expect(getByText('Zone A')).not.toBeNull()
  })

  it('renders the SVG map', () => {
    const { container } = render(<DashboardPage />)
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('renders empty detail panel state', () => {
    const { getByText } = render(<DashboardPage />)
    expect(getByText(/select a device/i)).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm --filter client test -- --testPathPattern=dashboard-page
```

- [ ] **Step 3: Create page.tsx**

```tsx
// app/(default)/dashboard/page.tsx
'use client'
import { useState, useMemo } from 'react'
import { DashboardHeader } from './components/dashboard-header'
import { WorkspaceSidebar } from './components/workspace-sidebar'
import { IsometricMap } from './components/isometric-map'
import { NodeDetailPanel } from './components/node-detail-panel'
import { MachineLegend } from './components/machine-legend'
import { useDashboardData } from './components/use-dashboard-data'
import type { NodeStatus } from './components/machines/status-colors'

export default function DashboardPage() {
  const { workspaces, nodes, loading, error } = useDashboardData()
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(
    null,
  )
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<NodeStatus | null>(null)

  const alarmCount = workspaces.reduce(
    (sum, ws) => sum + (ws.alarmCount ?? 0),
    0,
  )

  const selectedNode = useMemo(
    () => nodes.find(n => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  )

  const selectedNodeWorkspaceId = selectedNode?.workspaceId ?? null

  const filteredNodes = useMemo(() => {
    let result = nodes
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(n => n.data.name.toLowerCase().includes(q))
    }
    if (statusFilter) {
      result = result.filter(n => n.data.status === statusFilter)
    }
    if (selectedWorkspaceId) {
      result = result.filter(n => n.workspaceId === selectedWorkspaceId)
    }
    return result
  }, [nodes, searchQuery, statusFilter, selectedWorkspaceId])

  if (loading) return null // loading.tsx handles skeleton

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center text-destructive text-sm">
        {error}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <DashboardHeader
        alarmCount={alarmCount}
        searchQuery={searchQuery}
        onSearch={setSearchQuery}
      />
      <div className="flex flex-1 overflow-hidden">
        <WorkspaceSidebar
          workspaces={workspaces}
          selectedWorkspaceId={selectedWorkspaceId}
          onSelectWorkspace={id =>
            setSelectedWorkspaceId(prev => (prev === id ? null : id))
          }
          statusFilter={statusFilter}
          onStatusFilter={setStatusFilter}
        />
        <main className="flex-1 overflow-hidden">
          <IsometricMap
            workspaces={
              selectedWorkspaceId
                ? workspaces.filter(w => w.id === selectedWorkspaceId)
                : workspaces
            }
            nodes={filteredNodes}
            selectedWorkspaceId={selectedWorkspaceId}
            selectedNodeId={selectedNodeId}
            onNodeClick={id =>
              setSelectedNodeId(prev => (prev === id ? null : id))
            }
          />
        </main>
        <NodeDetailPanel
          node={selectedNode}
          workspaceId={selectedNodeWorkspaceId}
        />
      </div>
      <MachineLegend />
    </div>
  )
}
```

- [ ] **Step 4: Create loading.tsx**

```tsx
// app/(default)/dashboard/loading.tsx
export default function DashboardLoading() {
  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Header skeleton */}
      <div className="flex items-center gap-3 border-b border-border bg-[#0a0d14] px-4 py-2">
        <div className="h-4 w-20 animate-pulse rounded bg-muted/30" />
        <div className="h-7 w-48 animate-pulse rounded-md bg-muted/20" />
        <div className="h-6 w-36 animate-pulse rounded-full bg-muted/20" />
      </div>
      <div className="flex flex-1">
        {/* Sidebar skeleton */}
        <div className="w-40 shrink-0 border-r border-border bg-[#0a0d14] p-3 space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="flex items-center gap-2">
              <div className="h-6 w-6 animate-pulse rounded-md bg-muted/30" />
              <div className="flex-1 space-y-1">
                <div className="h-2.5 animate-pulse rounded bg-muted/30" />
                <div className="h-2 w-2/3 animate-pulse rounded bg-muted/20" />
              </div>
            </div>
          ))}
        </div>
        {/* Map skeleton */}
        <div className="flex-1 animate-pulse bg-[#080a0f]" />
        {/* Panel skeleton */}
        <div className="w-[200px] shrink-0 border-l border-border bg-[#0a0d14]" />
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Create error.tsx**

```tsx
// app/(default)/dashboard/error.tsx
'use client'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'

interface ErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function DashboardError({ error, reset }: ErrorProps) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-background">
      <p className="text-sm text-destructive">Failed to load dashboard</p>
      <Button variant="outline" size="sm" onClick={reset}>
        Try again
      </Button>
    </div>
  )
}
```

- [ ] **Step 6: Run test — expect PASS**

```bash
pnpm --filter client test -- --testPathPattern=dashboard-page
```

Expected: 4 tests pass.

- [ ] **Step 7: Format + build**

```bash
pnpm format && pnpm build
```

Expected: zero errors. Fix any TypeScript errors before proceeding.

- [ ] **Step 8: Commit**

```bash
git add apps/client/app/\(default\)/dashboard/
git commit -m "feat(dashboard): add 2.5D Digital Twin dashboard with isometric map, machine SVGs, and command center layout"
```

---

## Task 10: Verify End-to-End

- [ ] **Step 1: Start dev server**

```bash
pnpm --filter client dev
```

- [ ] **Step 2: Navigate to /dashboard as an authenticated user**

Open `http://localhost:3000/dashboard`. Verify:

- Left sidebar shows workspace list with status dots
- Center shows SVG isometric map with zone floors
- Machine nodes appear on the map (correct SVG per type)
- Alarm nodes have pulsating red glow rings
- Warning nodes have amber glow rings
- Normal nodes have green glow rings

- [ ] **Step 3: Click a workspace in sidebar**

Verify: that zone's floor highlights with blue dashed border. Non-selected zones dim.

- [ ] **Step 4: Click a machine node**

Verify: right detail panel shows node name, type, AI models list, last updated. "View Details →" link is present and navigates to the canvas route.

- [ ] **Step 5: Type in search bar**

Verify: only nodes whose names match the query remain visible on the map.

- [ ] **Step 6: Click a status filter (Alarm)**

Verify: only nodes with alarm status shown on map. Filter toggles off on second click.

- [ ] **Step 7: Run full test suite**

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 8: Final build check**

```bash
pnpm build
```

Expected: zero errors, zero warnings about types.
